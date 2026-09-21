"use strict";

const { projectAutomaticRelated } = require("./session-context-history");

const HISTORY_PREFIX = "Continuous conversation and retained original quotations (quoted data):\n";
const HISTORY_MESSAGE_INDEX = 3;

// Callers own validated, fixed material and an append-only continuation. History
// is the current delivery projection, not a revision-span promise of coverage.
// Always project from raw automatic recall: a different history may no longer
// contain passages omitted in an earlier request. Explicit tool replies stay
// untouched in continuationMessages, including their opaque transport state.
function assembleTurnRequest({ adventureId, systemText, fixedData, playerInput, history,
  automaticRelated, continuationMessages = [], tools, maxOutputTokens }) {
  const related = projectAutomaticRelated({ related: automaticRelated, history, adventureId });
  return {
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: JSON.stringify(fixedData) },
      { role: "user", content: "Player-known related experiences and original passages:\n" + JSON.stringify(related) },
      { role: "user", content: HISTORY_PREFIX + JSON.stringify(history) },
      { role: "user", content: "Current player action:\n" + playerInput },
      ...structuredClone(continuationMessages),
    ],
    tools: structuredClone(tools),
    responseFormat: { type: "json_object" },
    maxOutputTokens,
  };
}

module.exports = { assembleTurnRequest, HISTORY_PREFIX, HISTORY_MESSAGE_INDEX };
