"use strict";

// The confirmed story already exists in its ordinary turn. This service only
// completes the derived chapter and seals its archive; it never runs a turn.
const CODES = new Set(["FINALE_INPUT_INVALID", "FINALE_NOT_CONFIRMED", "FINALE_IDENTITY_MISMATCH",
  "FINALE_CHAPTER_NOT_READY", "FINALE_REVISION_CONFLICT", "FINALE_STATE_UNAVAILABLE", "FINALE_CONFIRMED",
  "CHAPTER_INTERRUPTED", "CHAPTER_TIMEOUT", "CHAPTER_BUSY", "CHAPTER_COMMIT_OUTCOME_UNKNOWN",
  "CHAPTER_SOURCE_UNAVAILABLE", "CHAPTER_STATE_UNAVAILABLE", "STORE_BUSY", "STORE_CLOSED",
  "VIEW_REVISION_UNAVAILABLE"]);
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get;

function failure(code) { return Object.assign(new Error(code), { code }); }
function fields(value, allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure("FINALE_INPUT_INVALID");
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("FINALE_INPUT_INVALID");
    copy[key] = descriptor.value;
  }
  return copy;
}
function safeProblem(error) {
  return { code: CODES.has(error?.code) ? error.code : "FINALE_STATE_UNAVAILABLE", retryable: true };
}

function createSessionFinale({ store, chapters } = {}) {
  if (typeof store?.readFinale !== "function" || typeof store?.sealFinale !== "function"
    || typeof chapters?.saveChapter !== "function") throw new TypeError("Finale store and chapter service are required");

  function request(input) {
    const checked = fields(input, ["revision"]);
    if (checked.revision !== undefined && (!Number.isSafeInteger(checked.revision) || checked.revision < 0)) {
      throw failure("FINALE_INPUT_INVALID");
    }
    return checked;
  }
  function result(finale, chapterWork = null, error) {
    const status = finale?.archive?.status === "closed" ? "closed"
      : finale?.decision?.phase !== "confirmed" ? "not_confirmed"
        : finale?.chapterJob?.status === "running" ? "finalizing" : "recovery_required";
    return { status, finale, chapterWork,
      ...(error ? { error: safeProblem(error) } : {}) };
  }
  function unknown(finale, chapterWork = null) {
    return { status: "unknown", finale, chapterWork,
      error: { code: "FINALE_OUTCOME_UNKNOWN", retryable: true } };
  }
  function sealIfReady(finale, chapterWork = null) {
    if (finale.archive?.status === "closed" || finale.decision?.phase !== "confirmed") return result(finale, chapterWork);
    if (!finale.archive || finale.chapterJob?.status !== "committed") return result(finale, chapterWork);
    try {
      return result(store.sealFinale({ finaleId: finale.archive.finaleId, chapterId: finale.chapterJob.chapterId }), chapterWork);
    } catch (error) {
      // A post-commit failure is a receipt problem. Read its durable result and
      // never ask the chapter service to generate again just to recover it.
      let latest;
      try { latest = store.readFinale({ revision: finale.revision }); }
      catch { return unknown(finale, chapterWork); }
      if (latest.archive?.status === "closed") return result(latest, chapterWork);
      return result(latest, chapterWork, error);
    }
  }

  function recoverFinale(input = {}) {
    // Explicit adventure recovery may finish a metadata transaction when its
    // chapter is already committed. It never starts/resumes a model request.
    return sealIfReady(store.readFinale(request(input)));
  }

  async function finalize(input = {}, options = {}) {
    const checked = request(input);
    const { retry = false, signal } = fields(options, ["retry", "signal"]);
    if (typeof retry !== "boolean") throw failure("FINALE_INPUT_INVALID");
    if (signal !== undefined) {
      try { aborted.call(signal); } catch { throw failure("FINALE_INPUT_INVALID"); }
    }
    const initial = store.readFinale(checked);
    if (initial.decision?.phase !== "confirmed") return result(initial);
    if (!initial.archive) return result(initial, null, failure("FINALE_STATE_UNAVAILABLE"));
    if (initial.archive.status === "closed" || initial.chapterJob?.status === "committed") return sealIfReady(initial);
    let chapterWork;
    try {
      chapterWork = await chapters.saveChapter({ targetRevision: initial.archive.confirmationRevision },
        { retry, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      let latest;
      try { latest = store.readFinale({ revision: initial.revision }); }
      catch { return unknown(initial); }
      if (latest.chapterJob?.status === "committed") return sealIfReady(latest);
      return result(latest, null, error);
    }
    let latest;
    try { latest = store.readFinale({ revision: initial.revision }); }
    catch { return unknown(initial, chapterWork); }
    if (chapterWork.chapterStatus === "unknown" && latest.archive?.status !== "closed") return unknown(latest, chapterWork);
    const sealed = sealIfReady(latest, chapterWork);
    return chapterWork.error && sealed.status !== "closed"
      ? { ...sealed, error: safeProblem(chapterWork.error) } : sealed;
  }

  return Object.freeze({ finalize, recoverFinale });
}

module.exports = { createSessionFinale };
