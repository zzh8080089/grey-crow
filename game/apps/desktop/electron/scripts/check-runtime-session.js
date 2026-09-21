#!/usr/bin/env node
"use strict";

const { createRuntimeOperationRegistry, resetRuntimeSessionState } = require("../runtime-session");

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

async function main() {
  const bridge = { runTurn() {} };
  const save = { id: "save_runtime", title: "Runtime" };
  const reset = resetRuntimeSessionState({
    activeBridge: bridge,
    keyVerified: true,
    gameStarted: true,
    activeSaveId: "save_runtime",
    activeSaveSummary: save,
    unrelated: "kept",
  });

  assert(reset.activeBridge === null, "runtime reset should clear active bridge.");
  assert(reset.keyVerified === false, "runtime reset should clear key verification.");
  assert(reset.gameStarted === false, "runtime reset should stop active game.");
  assert(reset.activeSaveId === null, "runtime reset should clear active save id.");
  assert(reset.activeSaveSummary === null, "runtime reset should clear active save summary.");
  assert(reset.unrelated === "kept", "runtime reset should preserve unrelated fields.");

  const operations = createRuntimeOperationRegistry();
  const first = operations.begin("run-turn");
  assert(first.isCurrent(), "new runtime operation should be current.");
  assert(operations.activeCount() === 1, "runtime operation registry should track active operations.");
  const second = operations.begin("run-turn");
  assert(!first.isCurrent() && first.signal.aborted, "starting a replacement operation should abort the previous one.");
  assert(second.isCurrent() && operations.activeCount() === 1, "replacement operation should become current.");
  operations.abortAll("runtime_reset");
  assert(!second.isCurrent() && second.signal.aborted, "abortAll should cancel active runtime operations.");
  assert(operations.activeCount() === 0, "abortAll should clear the operation registry.");
  assert(operations.pendingCount() === 2, "aborted operations must remain pending until their handlers finish.");
  first.finish();
  second.finish();
  assert(operations.pendingCount() === 0, "finished operations must leave the pending registry.");

  const maintenance = operations.begin("save-maintenance");
  const resetWriter = operations.begin("run-turn");
  operations.abortAll("settings_changed", { excludeKinds: ["save-maintenance"] });
  assert(maintenance.isCurrent() && !maintenance.signal.aborted, "ordinary runtime reset must preserve active save maintenance.");
  assert(resetWriter.signal.aborted && !resetWriter.isCurrent(), "ordinary runtime reset must still cancel non-maintenance operations.");
  assert(operations.has("save-maintenance"), "preserved save maintenance must continue blocking new Adventure lifecycle work.");
  resetWriter.finish();
  maintenance.finish();
  assert(operations.pendingCount() === 0, "preserved maintenance must leave the registry after its handler finishes.");

  const quittingMaintenance = operations.begin("save-maintenance");
  operations.abortAll("before_quit");
  assert(quittingMaintenance.signal.aborted && !quittingMaintenance.isCurrent(), "application quit must retain the original full cancellation semantics.");
  quittingMaintenance.finish();

  const writer = operations.begin("run-turn");
  let quiescenceResolved = false;
  const quiescencePromise = operations.abortAndWaitAll(
    ["run-turn", "manual-save", "context-compaction", "adventure-lifecycle"],
    "delete_current_adventure",
    { timeoutMs: 1000 }
  ).then((result) => {
    quiescenceResolved = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert(writer.signal.aborted, "delete quiescence must abort an active Adventure writer.");
  assert(!quiescenceResolved, "delete quiescence must wait for the aborted handler to finish.");
  writer.finish();
  const quiescence = await quiescencePromise;
  assert(quiescence.settled === true && quiescence.timedOutKinds.length === 0, "delete quiescence must settle only after all Adventure writers finish.");
  assert(operations.pendingCount() === 0, "delete quiescence must not leave completed writer operations pending.");

  const detachedWriter = operations.begin("run-turn");
  operations.abort("run-turn", "context_compaction_replaced_turn");
  let detachedWaitResolved = false;
  const detachedWait = operations.abortAndWaitAll(
    ["run-turn", "manual-save", "context-compaction", "adventure-lifecycle"],
    "delete_current_adventure",
    { timeoutMs: 1000 }
  ).then((result) => {
    detachedWaitResolved = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert(detachedWriter.signal.aborted, "a detached writer fixture must already be aborted.");
  assert(!detachedWaitResolved, "delete quiescence must also wait for previously aborted writer handlers.");
  detachedWriter.finish();
  assert((await detachedWait).settled === true, "previously aborted writers must settle after their handlers finish.");

  const stuckWriter = operations.begin("manual-save");
  const timedOut = await operations.abortAndWaitAll(
    ["run-turn", "manual-save", "context-compaction", "adventure-lifecycle"],
    "delete_current_adventure",
    { timeoutMs: 10 }
  );
  assert(timedOut.settled === false, "delete quiescence must report an unfinished writer instead of pretending deletion is safe.");
  assert(timedOut.timedOutKinds.includes("manual-save"), "delete quiescence must report the writer kind that timed out.");
  stuckWriter.finish();
  assert(operations.pendingCount() === 0, "timed-out writers must leave the pending registry when their handlers eventually finish.");

  process.stdout.write("runtime session checks passed\n");
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
