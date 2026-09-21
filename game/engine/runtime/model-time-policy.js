"use strict";

// A player action may include preparation, tools and bounded output repairs.
// Each request has its own deadline; all requests still share the owning job's
// total deadline. Connection probes and process lifecycle waits are separate.
const MODEL_REQUEST_TIMEOUT_MS = 3 * 60_000;
const PLAYER_ACTION_TIMEOUT_MS = 5 * 60_000;
const DERIVED_JOB_TIMEOUT_MS = 3 * 60_000;
const CONNECTION_TEST_TIMEOUT_MS = 45_000;

module.exports = {
  MODEL_REQUEST_TIMEOUT_MS,
  PLAYER_ACTION_TIMEOUT_MS,
  DERIVED_JOB_TIMEOUT_MS,
  CONNECTION_TEST_TIMEOUT_MS,
};
