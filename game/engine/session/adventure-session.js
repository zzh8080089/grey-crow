"use strict";

const { createHash } = require("node:crypto");
const { createTurnStore } = require("./turn-store");
const { createTurnCoordinator } = require("./turn-coordinator");
const { createTurnMemory } = require("./turn-memory");
const { createTurnGenerator } = require("./turn-generator");
const { createSessionChapters } = require("./session-chapters");
const { createSessionFinale } = require("./session-finale");
const { createSessionCompaction } = require("./session-compaction");
const { normalizeNarrationPreferences, normalizeSessionContextPolicy } = require("./session-context");
const { PLAYER_ACTION_TIMEOUT_MS, DERIVED_JOB_TIMEOUT_MS } = require("../runtime/model-time-policy");

// This entry point serves explicit adventure files. The desktop process owns
// content selection and credentials; this session owns one formal story.
function createAdventureSession(options = {}) {
  if (typeof options.provider?.generate !== "function") throw new TypeError("provider.generate is required");
  for (const key of ["hostText", "worldText"]) {
    if (typeof options[key] !== "string" || !options[key].trim()) throw new TypeError(`${key} is required`);
  }
  if (options.openingText !== undefined && typeof options.openingText !== "string") throw new TypeError("openingText must be text");
  if (options.finaleText !== undefined && typeof options.finaleText !== "string") throw new TypeError("finaleText must be text");
  if (options.extremeText !== undefined && typeof options.extremeText !== "string") throw new TypeError("extremeText must be text");
  if (options.memoryFragmentText !== undefined && typeof options.memoryFragmentText !== "string") throw new TypeError("memoryFragmentText must be text");
  for (const [key, max] of Object.entries({ maxAttempts: 8, maxChapterModelCalls: 32, maxCompactionModelCalls: 32, timeoutMs: 2_147_483_647,
    maxModelCalls: 32, maxToolCalls: 64, maxContextCharacters: 4_000_000, maxOutputTokens: 32768 })) {
    const minimum = key === "maxToolCalls" ? 0 : 1;
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] < minimum || options[key] > max)) {
      throw new RangeError(`${key} is outside the session budget`);
    }
  }
  const narrationPreferences = options.narrationPreferences === undefined ? undefined : normalizeNarrationPreferences(options.narrationPreferences);
  const contextPolicy = options.contextPolicy === undefined ? undefined : normalizeSessionContextPolicy(options.contextPolicy);
  const store = createTurnStore({
    databasePath: options.databasePath, adventureId: options.adventureId,
    locale: options.locale, contentVersion: options.contentVersion,
    memoryFragmentsEnabled: Boolean(options.memoryFragmentText?.trim()),
    ...(options.initialState === undefined ? {} : { initialState: options.initialState }),
  });
  let generator;
  let coordinator;
  let chapters;
  let finale;
  let compaction;
  const preparations = new Map();
  try {
    const memory = createTurnMemory({ store });
    generator = createTurnGenerator({
      store, memory, adventureId: options.adventureId, provider: options.provider, hostText: options.hostText, worldText: options.worldText,
      compactionAvailable: true,
      openingText: options.openingText ?? "",
      finaleText: options.finaleText ?? "",
      extremeText: options.extremeText ?? "",
      memoryFragmentText: options.memoryFragmentText ?? "",
      ...(narrationPreferences === undefined ? {} : { narrationPreferences }),
      ...(contextPolicy === undefined ? {} : { contextPolicy }),
      ...(options.maxModelCalls === undefined ? {} : { maxModelCalls: options.maxModelCalls }),
      ...(options.maxToolCalls === undefined ? {} : { maxToolCalls: options.maxToolCalls }),
      ...(options.maxContextCharacters === undefined ? {} : { maxContextCharacters: options.maxContextCharacters }),
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
    });
    compaction = createSessionCompaction({ store, generator, provider: options.provider,
      maxModelCalls: options.maxCompactionModelCalls ?? 8,
      ...(narrationPreferences === undefined ? {} : { narrationPreferences }),
      ...(contextPolicy === undefined ? {} : { contextPolicy }),
      ...(options.maxContextCharacters === undefined ? {} : { maxContextCharacters: options.maxContextCharacters }),
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      timeoutMs: options.timeoutMs ?? DERIVED_JOB_TIMEOUT_MS,
    });
    coordinator = createTurnCoordinator({ store, generateTurn: async (args) => {
      let preparation = preparations.get(args.attemptId);
      if (!preparation) {
        preparation = { requestId: null, result: null };
        preparations.set(args.attemptId, preparation);
        preparation.compact = async (context, generationAttemptId) => {
          // The initial threshold and a later tool/repair overflow share one
          // preparation budget. Never rerun prior tools or restart generation.
          if (preparation.requestId) return false;
          preparation.requestId = "auto-" + createHash("sha256").update(JSON.stringify({ adventureId: options.adventureId,
            actionId: args.request.actionId, revision: args.request.baseRevision, settingsIdentity: context.settingsIdentity })).digest("hex");
          // A failed automatic job belongs to this same immutable action.
          // Only an explicit action retry may restart it; repair passes reuse
          // this attempt's one preparation and never start it again.
          preparation.result = await compaction.compact({ requestId: preparation.requestId, revision: args.request.baseRevision,
            input: args.request.input, trigger: "auto" }, { signal: args.signal, retry: args.retry === true,
            ownerActionId: args.request.actionId, ownerAttemptId: args.attemptId,
            ...(generationAttemptId === undefined ? {} : { generationAttemptId }) });
          if (!["reduced", "no_benefit", "not_needed"].includes(preparation.result.status)) {
            const code = preparation.result.status === "baseline_too_large" ? "CONTEXT_BUDGET_EXCEEDED"
              : preparation.result.error?.code || "COMPACTION_INTERRUPTED";
            throw Object.assign(new Error(code), { code, retryable: preparation.result.error?.retryable !== false });
          }
          return preparation.result.status === "reduced";
        };
        preparation.done = (async () => {
          const context = await generator.readContextUsage({ revision: args.request.baseRevision, input: args.request.input });
          preparation.context = context;
          if (!context.compactionAvailable || context.latestEstimate.safetyInputTokens < context.policy.autoCompactLimit) return;
          await preparation.compact(context);
        })();
      }
      await preparation.done;
      return generator.generateTurn({ ...args, recoverContext: () => preparation.compact(preparation.context, args.attemptId) });
    },
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      timeoutMs: options.timeoutMs ?? PLAYER_ACTION_TIMEOUT_MS,
    });
    chapters = createSessionChapters({ store, provider: options.provider,
      maxModelCalls: options.maxChapterModelCalls ?? 8,
      ...(contextPolicy === undefined ? {} : { contextPolicy }),
      ...(options.maxContextCharacters === undefined ? {} : { maxContextCharacters: options.maxContextCharacters }),
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      timeoutMs: options.timeoutMs ?? DERIVED_JOB_TIMEOUT_MS,
    });
    finale = createSessionFinale({ store, chapters });
  } catch (error) {
    store.close();
    throw error;
  }

  async function runAction(request, controls) {
    const result = await coordinator.runAction(request, controls);
    const generationPasses = result.modelCalls;
    // A duplicate receipt causes no calls in this invocation. Usage below is
    // measured only for execution owned by this call, not estimated after restart.
    const measured = generationPasses > 0 ? generator.readUsage(result.executionAttemptId) : null;
    const preparation = preparations.get(result.executionAttemptId);
    const compactUsage = preparation?.result || compaction.readUsage(preparation?.requestId);
    preparations.delete(result.executionAttemptId);
    if (preparation?.requestId) compaction.releaseUsage(preparation.requestId);
    const usage = measured?.usage || compactUsage?.usage ? {} : null;
    let accountingValid = true;
    for (const source of [measured?.usage, compactUsage?.usage]) {
      for (const [key, value] of Object.entries(source || {})) {
        const sum = (usage[key] || 0) + value;
        if (Number.isSafeInteger(sum) && sum >= 0) usage[key] = sum;
        else accountingValid = false;
      }
    }
    if (generationPasses > 0) generator.releaseAttempt(result.executionAttemptId);
    // Deliver the durable story before derived work. Final chapters are started
    // explicitly through finalize(), with their own cancellation and accounting.
    return { ...result,
      generationPasses, modelCalls: (measured?.modelCalls ?? 0) + (compactUsage?.modelCalls ?? 0),
      ...(preparation?.result ? { compaction: preparation.result } : {}),
      compactionModelCalls: compactUsage?.modelCalls ?? 0, compactionUsage: compactUsage?.usage ?? null,
      toolCalls: measured?.toolCalls ?? 0, usage,
      contextUsage: measured?.contextUsage ?? null,
      usageComplete: (measured?.usageComplete ?? generationPasses === 0) && (compactUsage?.usageComplete ?? true) && accountingValid };
  }

  async function close() {
    // Persist interruption before waking execution. Shutdown is never a player
    // cancellation; a reopened session can explicitly retry an interrupted input.
    try { store.close(); }
    finally { coordinator.shutdown(); await Promise.allSettled([chapters.shutdown(), compaction.shutdown()]); }
  }

  function cancelAction(actionId) {
    const receipt = coordinator.cancelAction(actionId);
    if (!receipt) return receipt;
    // Cancellation reports durable outcome. Only runAction owns complete
    // invocation accounting; a generation pass may contain several model calls.
    const { modelCalls, ...outcome } = receipt;
    return outcome;
  }

  async function readContextUsage(request) {
    const result = await generator.readContextUsage(request);
    if (result?.adventureId !== options.adventureId || result.revision !== request.revision
      || result.scope !== "next_request" || result.actionId !== null) {
      throw Object.assign(new Error("CONTEXT_SOURCE_UNAVAILABLE"), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
    }
    const pending = store.readCompactionState({ revision: request.revision }).pendingJob;
    return { ...result, pendingCompaction: pending ? { requestId: pending.requestId, revision: pending.revision,
      input: pending.input, status: pending.status, settingsIdentity: pending.settingsIdentity,
      ...(pending.error ? { error: pending.error } : {}) } : null };
  }

  return Object.freeze({ runAction, close,
    cancelAction,
    readAction: coordinator.readAction,
    readPendingAction: store.readPendingAction,
    readDiagnostics: store.readDiagnostics,
    readView: coordinator.readView,
    readHistory: store.readHistory,
    saveChapter: chapters.saveChapter,
    readChapters: store.readChapters,
    readPlayerState: store.readPlayerState,
    readMemoryFragments: store.readMemoryFragments,
    readContextUsage,
    compactContext: compaction.compact,
    readContextCompaction: compaction.readCompaction,
    readFinale: store.readFinale,
    recoverFinale: finale.recoverFinale,
    finalize: finale.finalize,
  });
}

module.exports = { createAdventureSession };
