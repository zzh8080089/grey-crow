"use strict";

const path = require("node:path");
const { createSpeechInputService, cleanupSpeechRecordings, failure } = require("./service");

const CHANNELS = Object.freeze({
  status: "grey-crow:speech-input-status",
  install: "grey-crow:speech-input-install",
  remove: "grey-crow:speech-input-remove",
  cancel: "grey-crow:speech-input-cancel",
  transcribe: "grey-crow:speech-input-transcribe",
});

function registerSpeechInput({ ipcMain, assertTrustedSender, getSettings, getContext, getDataRoot, runtimeRoot, bundledModelRoot = null, fetchImpl,
  createService = createSpeechInputService, cleanupRecordings = cleanupSpeechRecordings }) {
  let service = null, generation = 0, startupError = null, cleanupRetry = null;
  const speechRoot = path.join(getDataRoot(), "speech-input");
  // Crash recovery runs even when speech is disabled; it never loads a model.
  let retiring = Promise.resolve().then(() => cleanupRecordings(speechRoot)).catch(error => { startupError = error; });
  async function ready() {
    await retiring;
    if (startupError) {
      cleanupRetry ||= Promise.resolve().then(() => cleanupRecordings(speechRoot))
        .then(() => { startupError = null; }).finally(() => { cleanupRetry = null; });
      await cleanupRetry;
    }
  }
  const requests = new Map();
  const getService = () => service ||= createService({ root: path.join(getDataRoot(), "speech-input"), runtimeRoot, bundledModelRoot, getSettings, fetchImpl });
  const sameBinding = (a, b) => a.adventureId === b.adventureId && a.sessionId === b.sessionId;
  async function cancel(payload = {}) {
    if (payload.requestId) {
      const request = requests.get(payload.requestId);
      if (request) request.cancelled = true;
    } else generation += 1;
    return service ? service.cancel(payload) : { ok: true };
  }
  async function dispose() {
    generation += 1;
    const previous = service;
    service = null;
    retiring = Promise.allSettled([retiring, cleanupRetry, previous?.dispose()]).then(() => undefined);
    await retiring;
  }
  async function resourceOperation(kind) {
    const capturedGeneration = generation;
    await ready();
    if (capturedGeneration !== generation) return failure({ code: "SPEECH_CANCELLED" });
    return getService()[kind]();
  }
  const handlers = {
    status: () => resourceOperation("status"),
    install: () => resourceOperation("install"),
    remove: () => resourceOperation("remove"),
    cancel: (payload) => cancel(payload),
    async transcribe(payload = {}) {
      const context = getContext();
      const test = payload.test === true;
      if (!test && (!context.ready || !sameBinding(payload, context))) return failure({ code: "SPEECH_STALE" });
      if (test && (payload.adventureId != null || payload.sessionId != null)) return failure({ code: "SPEECH_AUDIO_INVALID" });
      const capturedGeneration = generation;
      if (requests.has(payload.requestId)) return failure({ code: "SPEECH_BUSY" });
      const request = { cancelled: false };
      requests.set(payload.requestId, request);
      try {
        await ready();
        if (request.cancelled || capturedGeneration !== generation) return failure({ code: "SPEECH_CANCELLED" });
        const result = await getService().transcribe(payload);
        const current = getContext();
        if (request.cancelled || capturedGeneration !== generation || (!test && (!current.ready || !sameBinding(context, current)))) {
          return failure({ code: "SPEECH_STALE" });
        }
        return result;
      } finally { if (requests.get(payload.requestId) === request) requests.delete(payload.requestId); }
    },
  };
  for (const [key, channel] of Object.entries(CHANNELS)) {
    ipcMain.handle(channel, async (event, payload) => {
      assertTrustedSender(event);
      try { return await handlers[key](payload); } catch (error) { return failure(error); }
    });
  }
  return {
    cancel, dispose,
    async settingsChanged(previous, next) {
      if (JSON.stringify(previous.audio?.input) !== JSON.stringify(next.audio?.input)) await cancel();
    },
  };
}

function installSpeechInputPermissions({ webContents, trustedUrl, getSettings }) {
  const trusted = (sender, details) => sender === webContents && !webContents.isDestroyed()
    && webContents.getURL() === trustedUrl && details?.isMainFrame === true
    && details.requestingUrl === trustedUrl;
  webContents.session.setPermissionCheckHandler((sender, permission, _origin, details) =>
    trusted(sender, details) && (permission === "clipboard-sanitized-write" || permission === "fullscreen"
      || (permission === "media" && details.mediaType === "audio" && getSettings()?.audio?.input?.enabled === true)));
  webContents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    const audioOnly = Array.isArray(details?.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === "audio";
    callback(trusted(sender, details) && (permission === "clipboard-sanitized-write" || permission === "fullscreen"
      || (permission === "media" && audioOnly && getSettings()?.audio?.input?.enabled === true)));
  });
}

module.exports = { registerSpeechInput, installSpeechInputPermissions, CHANNELS };
