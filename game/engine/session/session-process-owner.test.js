"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRecoveryVerifier } = require("./session-process-owner");

test("process ownership recovery distinguishes generations, creation identities and legacy retries", () => {
  const live = new Set([10, 11, 12, 13, 99]);
  const identities = new Map([[10, "darwin:Sun Sep 20 18:00:00 2026"], [11, "darwin:Sun Sep 20 18:10:00 2026"],
    [12, "darwin:Sun Sep 20 18:20:00 2026"], [13, null], [99, "darwin:Sun Sep 20 18:00:00 2026"]]);
  const recover = createRecoveryVerifier({ currentGeneration: "here", currentPid: 99,
    isAlive: (pid) => live.has(pid), readIdentity: (pid) => identities.get(pid) });
  assert.equal(recover({ owner_pid: 10, owner_generation: "here" }), false, "same runtime remains active");
  assert.equal(recover({ owner_pid: 10, owner_generation: "away", owner_process_identity: identities.get(10) }), false, "live external owner remains active");
  assert.equal(recover({ owner_pid: 11, owner_generation: "away", owner_process_identity: identities.get(10) }), true, "reused live PID creation differs");
  assert.equal(recover({ owner_pid: 99, owner_generation: "away", owner_process_identity: identities.get(10) }), true, "same PID with another runtime generation is stale");
  assert.equal(recover({ owner_pid: 13, owner_generation: "away", owner_process_identity: identities.get(10) }), false, "unknown identity never steals work");
  assert.equal(recover({ owner_pid: 12, owner_generation: null, owner_process_identity: null,
    updated_at: "2026-09-20T18:15:00.000Z" }), true, "legacy record recovers only when the live process began after this retry");
  assert.equal(recover({ owner_pid: 12, owner_generation: null, owner_process_identity: null,
    updated_at: "2026-09-20T18:25:00.000Z" }), false, "later legacy retry is preserved");
  assert.equal(recover({ owner_pid: 404, owner_generation: "away" }), true, "exited owner recovers");
});
