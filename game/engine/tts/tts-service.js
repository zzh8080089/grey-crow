"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  TtsUtterancePlanError,
  planTtsUtterance,
} = require("./utterance-planner");

const DEFAULT_CACHE_LIMIT = 40;
const DEFAULT_UTTERANCE_CACHE_LIMIT = 20;
const MAX_UTTERANCE_CACHE_BYTES = 500 * 1024 * 1024;
const UTTERANCE_CACHE_SCHEMA_VERSION = "grey-crow-tts-utterance-cache-v1";
const UTTERANCE_MANIFEST_DIRECTORY = "utterances";
const SUPPORTED_UTTERANCE_CACHE_LIMITS = new Set([10, 20, 40]);
// Provider requests stay small even when a complete utterance is much longer:
// the utterance planner flattens the source into bounded playback units first.
const MAX_TTS_TEXT_CHARS = 1000;
const DEFAULT_KOKORO_VOICE = "zm_010";
const SUPPORTED_TTS_PROVIDER_IDS = new Set([
  "kokoro-original-local",
]);

class TtsError extends Error {
  constructor(code, message, { retryable = false, cause = null } = {}) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.retryable = retryable;
    if (cause) {
      this.cause = cause;
    }
  }
}

function createTtsService({
  cacheRoot,
  providers = {},
  unavailableProviders = {},
  cacheLimit = DEFAULT_CACHE_LIMIT,
  cacheByteLimit = MAX_UTTERANCE_CACHE_BYTES,
} = {}) {
  const resolvedCacheRoot = requireAbsolutePath(cacheRoot, "cacheRoot");
  const safeCacheLimit = normalizeCacheLimit(cacheLimit);
  const safeCacheByteLimit = normalizeCacheByteLimit(cacheByteLimit);
  const inFlight = new Map();
  const activeAudioUsers = new Map();
  const utterances = new Map();
  let activeUtteranceId = null;

  const service = {
    getStatus(settings = {}) {
      const tts = settings?.audio?.tts && typeof settings.audio.tts === "object" ? settings.audio.tts : {};
      const providerId = tts.enabled ? normalizeProvider(tts.provider) : "disabled";
      const provider = providers[providerId] || null;
      const unavailable = unavailableProviders[providerId] || null;
      return {
        ok: Boolean(provider) && !unavailable,
        provider: providerId,
        voiceId: normalizeVoiceId(tts.voiceId) || provider?.defaultVoiceId || DEFAULT_KOKORO_VOICE,
        cacheFileLimit: safeCacheLimit,
        cacheUtteranceLimit: normalizeUtteranceCacheLimit(tts.cacheUtteranceLimit),
        cacheByteLimit: safeCacheByteLimit,
        online: provider ? Boolean(provider.online) : false,
        experimental: provider ? Boolean(provider.experimental) : false,
        ...(unavailable ? { errorCode: unavailable.code || "TTS_PROVIDER_UNAVAILABLE" } : {}),
      };
    },

    async synthesize({ text, settings = {} } = {}) {
      const audio = await synthesizeAudio({ text, settings }, { pruneLegacy: true });
      return audio.result;
    },
    getCacheStatus(settings = {}) {
      return inspectUtteranceCache(
        resolvedCacheRoot,
        normalizeUtteranceCacheLimit(settings?.audio?.tts?.cacheUtteranceLimit),
        safeCacheByteLimit
      );
    },
    applyCachePolicy(settings = {}) {
      return pruneUtteranceCache(
        resolvedCacheRoot,
        normalizeUtteranceCacheLimit(settings?.audio?.tts?.cacheUtteranceLimit),
        safeCacheByteLimit
      );
    },
    async startUtterance({ text, settings = {} } = {}) {
      cancelActiveUtterance();

      let plan;
      try {
        plan = planTtsUtterance(text);
      } catch (error) {
        throw normalizeUtterancePlanError(error);
      }

      const providerId = normalizeProvider(settings?.audio?.tts?.provider);
      assertProviderAvailable(providerId);
      const settingsSnapshot = createTtsSettingsSnapshot(settings, providers[providerId]);
      const utteranceId = crypto.randomUUID();
      const session = {
        id: utteranceId,
        abortController: new AbortController(),
        cacheKey: createUtteranceCacheKey(plan, settingsSnapshot),
        cacheFiles: [],
        cacheUtteranceLimit: normalizeUtteranceCacheLimit(settingsSnapshot.audio.tts.cacheUtteranceLimit),
        sourceHash: plan.sourceHash,
        planVersion: plan.version,
        units: flattenPlaybackUnits(plan),
        cursor: 0,
        busy: false,
        canceled: false,
        completed: false,
        settings: settingsSnapshot,
      };
      touchUtteranceManifest(resolvedCacheRoot, session.cacheKey);
      utterances.set(utteranceId, session);
      activeUtteranceId = utteranceId;

      try {
        return await synthesizeNextUnit(session);
      } catch (error) {
        closeUtterance(session);
        throw error;
      }
    },
    async continueUtterance({ utteranceId } = {}) {
      const session = requireUtterance(utteranceId);
      return synthesizeNextUnit(session);
    },
    cancelUtterance({ utteranceId } = {}) {
      const id = normalizeUtteranceId(utteranceId);
      const session = id ? utterances.get(id) : null;
      if (!session) {
        return { ok: true, canceled: false, not_model_visible: true };
      }
      session.canceled = true;
      session.abortController.abort();
      closeUtterance(session);
      return { ok: true, canceled: true, not_model_visible: true };
    },
    async dispose() {
      for (const session of utterances.values()) {
        session.canceled = true;
        session.abortController.abort();
        cleanupIncompleteUtterance(resolvedCacheRoot, session, isCacheFileInUse);
      }
      utterances.clear();
      activeUtteranceId = null;
      await Promise.allSettled(
        Object.values(providers).map((provider) => provider?.dispose?.()).filter(Boolean)
      );
    },
  };

  return service;

  async function synthesizeAudio(
    { text, settings = {} } = {},
    { pruneLegacy = false, signal = null } = {}
  ) {
      const providerId = normalizeProvider(settings?.audio?.tts?.provider);
      assertProviderAvailable(providerId);
      const provider = providers[providerId];
      if (!provider) {
        throw new TtsError("TTS_PROVIDER_DISABLED", "朗读系统尚未启用。", { retryable: false });
      }
      const request = normalizeTtsRequest({ text, settings, provider });

      fs.mkdirSync(resolvedCacheRoot, { recursive: true });
      const cacheKey = createCacheKey(request);
      const fileExtension = normalizeFileExtension(provider.fileExtension);
      const mimeType = normalizeMimeType(provider.mimeType, fileExtension);
      const outputFile = path.join(resolvedCacheRoot, `${cacheKey}.${fileExtension}`);
      assertInsideRoot(resolvedCacheRoot, outputFile);
      retainAudioUse(outputFile);

      try {
        let cacheHit = false;
        if (!fs.existsSync(outputFile)) {
          let generation = inFlight.get(outputFile);
          if (!generation) {
            const controller = new AbortController();
            generation = {
              abortTimer: null,
              consumers: new Set(),
              controller,
              settled: false,
              promise: null,
            };
            generation.promise = generateAudioFile({
              provider,
              request,
              outputFile,
              fileExtension,
              cacheRoot: resolvedCacheRoot,
              signal: controller.signal,
            });
            inFlight.set(outputFile, generation);
            generation.promise.finally(() => {
              generation.settled = true;
              if (generation.abortTimer) {
                clearImmediate(generation.abortTimer);
              }
              if (inFlight.get(outputFile) === generation) {
                inFlight.delete(outputFile);
              }
            }).catch(() => {});
          }
          await waitForGeneration(generation, signal);
        } else {
          throwIfAborted(signal);
          cacheHit = true;
          touchFile(outputFile);
        }

        if (pruneLegacy) {
          await pruneCache(resolvedCacheRoot, safeCacheLimit);
        }
        const bytes = fs.readFileSync(outputFile);
        return {
          cacheFileName: path.basename(outputFile),
          byteLength: bytes.length,
          result: {
            ok: true,
            provider: request.provider,
            voiceId: request.voiceId,
            cacheHit,
            mimeType,
            dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
            not_model_visible: true,
          },
        };
      } finally {
        releaseAudioUse(outputFile);
      }
  }

  function assertProviderAvailable(providerId) {
    const unavailable = unavailableProviders[providerId];
    if (unavailable) {
      throw new TtsError(
        unavailable.code || "TTS_PROVIDER_UNAVAILABLE",
        unavailable.message || "本地语音包尚未安装。",
        { retryable: false }
      );
    }
  }

  function retainAudioUse(filePath) {
    activeAudioUsers.set(filePath, (activeAudioUsers.get(filePath) || 0) + 1);
  }

  function releaseAudioUse(filePath) {
    const remaining = (activeAudioUsers.get(filePath) || 1) - 1;
    if (remaining > 0) {
      activeAudioUsers.set(filePath, remaining);
    } else {
      activeAudioUsers.delete(filePath);
    }
  }

  function isCacheFileInUse(fileName) {
    return (activeAudioUsers.get(path.join(resolvedCacheRoot, fileName)) || 0) > 0;
  }

  function cancelActiveUtterance() {
    if (!activeUtteranceId) {
      return;
    }
    const session = utterances.get(activeUtteranceId);
    if (session) {
      session.canceled = true;
      session.abortController.abort();
      closeUtterance(session);
    }
  }

  function requireUtterance(value) {
    const utteranceId = normalizeUtteranceId(value);
    const session = utteranceId ? utterances.get(utteranceId) : null;
    if (!session || session.canceled) {
      throw new TtsError("TTS_UTTERANCE_NOT_FOUND", "本次朗读已经结束，请重新生成。", {
        retryable: false,
      });
    }
    return session;
  }

  async function synthesizeNextUnit(session) {
    if (session.busy) {
      throw new TtsError("TTS_UTTERANCE_BUSY", "朗读片段仍在生成，请稍后继续。", {
        retryable: true,
      });
    }
    const unit = session.units[session.cursor];
    if (!unit) {
      closeUtterance(session);
      throw new TtsError("TTS_UTTERANCE_COMPLETE", "本次朗读已经完成。", {
        retryable: false,
      });
    }

    session.busy = true;
    try {
      const audio = await synthesizeAudio({
        text: unit.text,
        settings: session.settings,
      }, { pruneLegacy: false, signal: session.abortController.signal });
      session.cacheFiles.push({ name: audio.cacheFileName, bytes: audio.byteLength });
      if (session.canceled || utterances.get(session.id) !== session) {
        cleanupIncompleteUtterance(resolvedCacheRoot, session, isCacheFileInUse);
        throw new TtsError("TTS_UTTERANCE_CANCELLED", "本次朗读已取消。", {
          retryable: false,
        });
      }

      const segmentIndex = session.cursor;
      session.cursor += 1;
      const hasMore = session.cursor < session.units.length;
      const result = {
        ok: true,
        utteranceId: session.id,
        segmentId: unit.id,
        segmentIndex,
        segmentCount: session.units.length,
        segmentKind: unit.kind,
        provider: audio.result.provider,
        voiceId: audio.result.voiceId,
        cacheHit: audio.result.cacheHit,
        mimeType: audio.result.mimeType,
        dataUrl: audio.result.dataUrl,
        hasMore,
        not_model_visible: true,
      };
      if (!hasMore) {
        session.completed = true;
        try {
          commitUtteranceManifest(resolvedCacheRoot, session, safeCacheByteLimit);
        } catch (_error) {
          // Cache maintenance is optional and must not fail successful playback.
        }
        closeUtterance(session, { completed: true });
      }
      return result;
    } finally {
      session.busy = false;
    }
  }

  function closeUtterance(session, { completed = session.completed } = {}) {
    if (!completed && !session.abortController.signal.aborted) {
      session.abortController.abort();
    }
    if (utterances.get(session.id) === session) {
      utterances.delete(session.id);
    }
    if (activeUtteranceId === session.id) {
      activeUtteranceId = null;
    }
    if (!completed) {
      cleanupIncompleteUtterance(resolvedCacheRoot, session, isCacheFileInUse);
    }
  }

  function waitForGeneration(generation, signal) {
    const consumer = Symbol("tts-generation-consumer");
    generation.consumers.add(consumer);
    if (generation.abortTimer) {
      clearImmediate(generation.abortTimer);
      generation.abortTimer = null;
    }

    return new Promise((resolve, reject) => {
      let finished = false;
      const onAbort = () => finish(reject, createUtteranceCanceledError());
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      generation.promise.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );

      function finish(settle, value) {
        if (finished) {
          return;
        }
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        releaseGenerationConsumer(generation, consumer);
        settle(value);
      }
    });
  }

  function releaseGenerationConsumer(generation, consumer) {
    generation.consumers.delete(consumer);
    if (generation.settled || generation.consumers.size > 0 || generation.abortTimer) {
      return;
    }
    generation.abortTimer = setImmediate(() => {
      generation.abortTimer = null;
      if (!generation.settled && generation.consumers.size === 0) {
        generation.controller.abort();
      }
    });
  }
}

function flattenPlaybackUnits(plan) {
  return plan.segments.flatMap((segment) => {
    if (segment.kind !== "tail") {
      return [{ id: segment.id, kind: segment.kind, text: segment.text }];
    }
    return segment.blocks.map((block) => ({
      id: block.id,
      kind: "tail",
      text: block.text,
    }));
  });
}

function createTtsSettingsSnapshot(settings = {}, providerConfig = null) {
  const tts = settings?.audio?.tts && typeof settings.audio.tts === "object"
    ? settings.audio.tts
    : {};
  return {
    audio: {
      tts: {
        enabled: Boolean(tts.enabled),
        provider: typeof tts.provider === "string" ? tts.provider : "disabled",
        voiceId: typeof tts.voiceId === "string" ? tts.voiceId : "",
        rate: typeof tts.rate === "string" ? tts.rate : "+0%",
        pitch: typeof tts.pitch === "string" ? tts.pitch : "+0Hz",
        cacheUtteranceLimit: normalizeUtteranceCacheLimit(tts.cacheUtteranceLimit),
        cacheVersion: normalizeProviderCacheVersion(providerConfig?.cacheVersion),
      },
    },
  };
}

function normalizeUtteranceId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-f0-9-]{16,80}$/i.test(text) ? text : "";
}

function normalizeUtterancePlanError(error) {
  if (error instanceof TtsUtterancePlanError) {
    return new TtsError(error.code, error.message, { retryable: false, cause: error });
  }
  return error;
}

async function generateAudioFile({ provider, request, outputFile, fileExtension, cacheRoot, signal = null }) {
  const tempFile = path.join(
    cacheRoot,
    `${path.basename(outputFile, `.${fileExtension}`)}.${process.pid}.${crypto.randomUUID()}.${fileExtension}`
  );
  assertInsideRoot(cacheRoot, tempFile);
  try {
    await provider.synthesizeToFile({
      text: request.text,
      voiceId: request.voiceId,
      rate: request.rate,
      pitch: request.pitch,
      outputFile: tempFile,
      signal,
    });
    throwIfAborted(signal);
    const stat = fs.statSync(tempFile);
    if (!stat.isFile() || stat.size <= 0) {
      throw new TtsError("TTS_EMPTY_AUDIO", "本地朗读没有生成有效音频。", { retryable: true });
    }
    fs.renameSync(tempFile, outputFile);
  } catch (error) {
    if (error instanceof TtsError) {
      throw error;
    }
    throw normalizeProviderError(error);
  } finally {
    safeUnlink(tempFile);
  }
}

function normalizeProviderError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "KOKORO_REQUEST_CANCELLED" || code === "TTS_UTTERANCE_CANCELLED") {
    return createUtteranceCanceledError(error);
  }
  if ([
    "KOKORO_MODEL_MISSING",
    "KOKORO_DEPENDENCY_MISSING",
    "INVALID_KOKORO_OUTPUT",
    "KOKORO_PROVIDER_DISPOSED",
  ].includes(code)) {
    return new TtsError(code, "本地朗读资源不完整，请重新安装或修复游戏。", {
      retryable: false,
      cause: error,
    });
  }
  return new TtsError(code || "TTS_SYNTHESIS_FAILED", "朗读生成失败，请稍后重试。", {
    retryable: true,
    cause: error,
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createUtteranceCanceledError();
  }
}

function createUtteranceCanceledError(cause = null) {
  return new TtsError("TTS_UTTERANCE_CANCELLED", "本次朗读已取消。", {
    retryable: false,
    cause,
  });
}

function normalizeTtsRequest({ text, settings = {}, provider: providerConfig = null } = {}) {
  const tts = settings?.audio?.tts && typeof settings.audio.tts === "object" ? settings.audio.tts : {};
  const providerId = normalizeProvider(tts.provider);
  if (providerId === "disabled" || !tts.enabled) {
    throw new TtsError("TTS_PROVIDER_DISABLED", "朗读系统尚未启用。", { retryable: false });
  }

  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    throw new TtsError("INVALID_TTS_INPUT", "没有可朗读文本。", { retryable: false });
  }
  if (normalizedText.length > MAX_TTS_TEXT_CHARS) {
    throw new TtsError("TTS_TEXT_TOO_LONG", "本段文字过长，暂时不能朗读。", { retryable: false });
  }

  return {
    provider: providerId,
    cacheVersion: normalizeProviderCacheVersion(providerConfig?.cacheVersion),
    text: normalizedText,
    voiceId: normalizeVoiceId(tts.voiceId) || providerConfig?.defaultVoiceId || DEFAULT_KOKORO_VOICE,
    rate: normalizeProsodyValue(tts.rate, "+0%"),
    pitch: normalizeProsodyValue(tts.pitch, "+0Hz"),
  };
}

function normalizeProvider(value) {
  const provider = typeof value === "string" ? value.trim() : "";
  if (SUPPORTED_TTS_PROVIDER_IDS.has(provider)) {
    return provider;
  }
  return "disabled";
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVoiceId(value) {
  const voiceId = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{3,80}$/.test(voiceId) ? voiceId : "";
}

function normalizeProsodyValue(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^(?:default|[-+]\d{1,3}%|[-+]\d{1,4}Hz)$/.test(text)) {
    return text;
  }
  return fallback;
}

function createCacheKey(request) {
  const identity = {
    provider: request.provider,
    voiceId: request.voiceId,
    rate: request.rate,
    pitch: request.pitch,
    text: request.text,
  };
  if (request.cacheVersion) {
    identity.cacheVersion = request.cacheVersion;
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
}

function createUtteranceCacheKey(plan, settings = {}) {
  const tts = settings?.audio?.tts || {};
  const identity = {
    schemaVersion: UTTERANCE_CACHE_SCHEMA_VERSION,
    planVersion: plan.version,
    locale: plan.locale,
    sourceHash: plan.sourceHash,
    provider: tts.provider,
    voiceId: tts.voiceId,
    rate: tts.rate,
    pitch: tts.pitch,
  };
  if (tts.cacheVersion) {
    identity.cacheVersion = tts.cacheVersion;
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
}

function normalizeProviderCacheVersion(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._:-]{1,120}$/.test(text) ? text : "";
}

function commitUtteranceManifest(cacheRoot, session, byteLimit) {
  const manifestRoot = getUtteranceManifestRoot(cacheRoot);
  fs.mkdirSync(manifestRoot, { recursive: true });
  const files = uniqueCacheFiles(session.cacheFiles).filter((entry) => {
    const filePath = path.join(cacheRoot, entry.name);
    return isSafeAudioFileName(entry.name) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  });
  if (!files.length) {
    return;
  }

  const existing = readUtteranceManifest(cacheRoot, session.cacheKey);
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: UTTERANCE_CACHE_SCHEMA_VERSION,
    cacheKey: session.cacheKey,
    sourceHash: session.sourceHash,
    planVersion: session.planVersion,
    segmentCount: session.units.length,
    createdAt: existing?.createdAt || now,
    lastAccess: now,
    files,
  };
  writeJsonAtomic(getUtteranceManifestPath(cacheRoot, session.cacheKey), manifest);
  pruneUtteranceCache(cacheRoot, session.cacheUtteranceLimit, byteLimit);
}

function touchUtteranceManifest(cacheRoot, cacheKey) {
  const manifest = readUtteranceManifest(cacheRoot, cacheKey);
  if (!manifest) {
    return false;
  }
  manifest.lastAccess = new Date().toISOString();
  writeJsonAtomic(getUtteranceManifestPath(cacheRoot, cacheKey), manifest);
  for (const entry of manifest.files) {
    const filePath = path.join(cacheRoot, entry.name);
    if (fs.existsSync(filePath)) {
      touchFile(filePath);
    }
  }
  return true;
}

function inspectUtteranceCache(cacheRoot, utteranceLimit, byteLimit) {
  const manifests = readUtteranceManifests(cacheRoot);
  const references = collectManifestReferences(manifests);
  let bytes = 0;
  for (const name of references) {
    const filePath = path.join(cacheRoot, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        bytes += stat.size;
      }
    } catch (_error) {
      // Missing cache files are treated as evicted and can be regenerated.
    }
  }
  return {
    ok: true,
    utteranceCount: manifests.length,
    bytes,
    utteranceLimit: normalizeUtteranceCacheLimit(utteranceLimit),
    byteLimit: normalizeCacheByteLimit(byteLimit),
    not_model_visible: true,
  };
}

function pruneUtteranceCache(cacheRoot, utteranceLimit, byteLimit) {
  const safeLimit = normalizeUtteranceCacheLimit(utteranceLimit);
  const safeByteLimit = normalizeCacheByteLimit(byteLimit);
  const manifests = readUtteranceManifests(cacheRoot)
    .sort((left, right) => Date.parse(right.lastAccess) - Date.parse(left.lastAccess));
  const retained = [];
  const retainedFiles = new Set();
  const evicted = [];
  let retainedBytes = 0;

  for (const manifest of manifests) {
    let incrementalBytes = 0;
    const newFiles = [];
    for (const entry of manifest.files) {
      if (retainedFiles.has(entry.name)) {
        continue;
      }
      const filePath = path.join(cacheRoot, entry.name);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          incrementalBytes += stat.size;
          newFiles.push(entry.name);
        }
      } catch (_error) {
        // A manifest with missing audio remains regenerable but contributes no bytes.
      }
    }
    if (retained.length < safeLimit && retainedBytes + incrementalBytes <= safeByteLimit) {
      retained.push(manifest);
      retainedBytes += incrementalBytes;
      newFiles.forEach((name) => retainedFiles.add(name));
    } else {
      evicted.push(manifest);
    }
  }

  for (const manifest of evicted) {
    safeUnlink(getUtteranceManifestPath(cacheRoot, manifest.cacheKey));
  }
  for (const manifest of evicted) {
    for (const entry of manifest.files) {
      if (!retainedFiles.has(entry.name)) {
        safeUnlink(path.join(cacheRoot, entry.name));
      }
    }
  }
  return inspectUtteranceCache(cacheRoot, safeLimit, safeByteLimit);
}

function cleanupIncompleteUtterance(cacheRoot, session, isProtected = () => false) {
  if (!session || session.completed || !Array.isArray(session.cacheFiles)) {
    return;
  }
  const referenced = collectManifestReferences(readUtteranceManifests(cacheRoot));
  for (const entry of uniqueCacheFiles(session.cacheFiles)) {
    if (!referenced.has(entry.name) && !isProtected(entry.name)) {
      safeUnlink(path.join(cacheRoot, entry.name));
    }
  }
}

function readUtteranceManifests(cacheRoot) {
  const manifestRoot = getUtteranceManifestRoot(cacheRoot);
  if (!fs.existsSync(manifestRoot)) {
    return [];
  }
  const manifests = [];
  for (const entry of fs.readdirSync(manifestRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
      continue;
    }
    const cacheKey = entry.name.slice(0, -5);
    const manifest = readUtteranceManifest(cacheRoot, cacheKey);
    if (manifest) {
      manifests.push(manifest);
    }
  }
  return manifests;
}

function readUtteranceManifest(cacheRoot, cacheKey) {
  if (!/^[a-f0-9]{64}$/.test(String(cacheKey || ""))) {
    return null;
  }
  const manifestPath = getUtteranceManifestPath(cacheRoot, cacheKey);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (
      manifest?.schemaVersion !== UTTERANCE_CACHE_SCHEMA_VERSION ||
      manifest.cacheKey !== cacheKey ||
      !Number.isFinite(Date.parse(manifest.lastAccess)) ||
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      manifest.files.some((entry) => !isSafeAudioFileName(entry?.name))
    ) {
      safeUnlink(manifestPath);
      return null;
    }
    manifest.files = uniqueCacheFiles(manifest.files);
    if (manifest.files.some((entry) => {
      try {
        return !fs.statSync(path.join(cacheRoot, entry.name)).isFile();
      } catch (_error) {
        return true;
      }
    })) {
      safeUnlink(manifestPath);
      return null;
    }
    return manifest;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      safeUnlink(manifestPath);
    }
    return null;
  }
}

function collectManifestReferences(manifests) {
  const references = new Set();
  for (const manifest of manifests) {
    for (const entry of manifest.files || []) {
      if (isSafeAudioFileName(entry.name)) {
        references.add(entry.name);
      }
    }
  }
  return references;
}

function uniqueCacheFiles(files = []) {
  const unique = new Map();
  for (const entry of files) {
    if (!isSafeAudioFileName(entry?.name)) {
      continue;
    }
    unique.set(entry.name, {
      name: entry.name,
      bytes: Number.isFinite(entry.bytes) && entry.bytes >= 0 ? Math.floor(entry.bytes) : 0,
    });
  }
  return [...unique.values()];
}

function getUtteranceManifestRoot(cacheRoot) {
  const target = path.join(cacheRoot, UTTERANCE_MANIFEST_DIRECTORY);
  assertInsideRoot(cacheRoot, target);
  return target;
}

function getUtteranceManifestPath(cacheRoot, cacheKey) {
  const target = path.join(getUtteranceManifestRoot(cacheRoot), `${cacheKey}.json`);
  assertInsideRoot(cacheRoot, target);
  return target;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    safeUnlink(tempPath);
  }
}

function isSafeAudioFileName(value) {
  return /^[a-f0-9]{64}\.(?:mp3|wav)$/.test(String(value || ""));
}

async function pruneCache(cacheRoot, limit) {
  const protectedFiles = collectManifestReferences(readUtteranceManifests(cacheRoot));
  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSafeAudioFileName(entry.name) && !protectedFiles.has(entry.name))
    .map((entry) => {
      const filePath = path.join(cacheRoot, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries.slice(limit)) {
    safeUnlink(entry.filePath);
  }
}

function normalizeFileExtension(value) {
  return value === "wav" ? "wav" : "mp3";
}

function normalizeMimeType(value, fileExtension) {
  if (typeof value === "string" && /^audio\/[a-z0-9.+-]+$/i.test(value)) {
    return value;
  }
  return fileExtension === "wav" ? "audio/wav" : "audio/mpeg";
}

function touchFile(filePath) {
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizeCacheLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= 200 ? value : DEFAULT_CACHE_LIMIT;
}

function normalizeUtteranceCacheLimit(value) {
  const number = Number(value);
  return SUPPORTED_UTTERANCE_CACHE_LIMITS.has(number) ? number : DEFAULT_UTTERANCE_CACHE_LIMIT;
}

function normalizeCacheByteLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 2 * 1024 * 1024 * 1024
    ? number
    : MAX_UTTERANCE_CACHE_BYTES;
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TtsError("INVALID_TTS_CACHE_ROOT", `${label} is invalid.`, { retryable: false });
  }
  return path.resolve(value);
}

function assertInsideRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TtsError("INVALID_TTS_CACHE_PATH", "朗读缓存路径无效。", { retryable: false });
  }
}

module.exports = {
  DEFAULT_CACHE_LIMIT,
  DEFAULT_UTTERANCE_CACHE_LIMIT,
  DEFAULT_KOKORO_VOICE,
  MAX_TTS_TEXT_CHARS,
  MAX_UTTERANCE_CACHE_BYTES,
  TtsError,
  createTtsService,
};
