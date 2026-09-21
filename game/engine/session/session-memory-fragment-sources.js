"use strict";

const { mapSessionSource } = require("./session-lineage");
const verifiedByConnection = new WeakMap();

// Fragment provenance points at the original committed event, including an
// ancestor's event copied into a continuation. This reader never repairs data.
function validateMemoryFragmentSources(db, state, timeline) {
  const memory = state.memoryFragments;
  const identity = `${timeline.adventureId}:${timeline.revision}`;
  const fingerprint = JSON.stringify(memory ?? null);
  const verified = verifiedByConnection.get(db) || new Map();
  // App-owned committed rows are immutable. Reuse only successful proofs on
  // this connection and identical ledger, never across reopen or a new turn.
  if (verified.get(identity) === fingerprint) return;
  const remember = () => {
    verified.set(identity, fingerprint);
    if (verified.size > 8) verified.delete(verified.keys().next().value);
    verifiedByConnection.set(db, verified);
  };
  const rows = new Map();
  const fail = () => { throw Object.assign(new Error("MEMORY_FRAGMENT_SOURCE_INVALID"), { code: "MEMORY_FRAGMENT_SOURCE_INVALID" }); };
  // An absent ledger is valid only if no fragment event was ever committed.
  let recorded; let latestChoice;
  try {
    recorded = db.prepare(`SELECT t.revision,e.value AS event_json FROM turns t,json_each(t.events_json) e
      WHERE t.revision<=? AND json_extract(e.value,'$.type')='memory_fragment.record'
      ORDER BY t.revision,CAST(e.key AS INTEGER) LIMIT 31`).all(timeline.revision);
    latestChoice = db.prepare(`SELECT t.revision,e.value AS event_json FROM turns t,json_each(t.events_json) e
      WHERE t.revision<=? AND json_extract(e.value,'$.type')='memory_fragment.resolve'
      ORDER BY t.revision DESC,CAST(e.key AS INTEGER) DESC LIMIT 1`).get(timeline.revision);
  } catch { fail(); }
  if (recorded.length !== (memory?.fragments.length ?? 0) || recorded.length > 30
    || (!latestChoice && memory?.decision != null)) fail();
  if (!memory) { remember(); return; }
  recorded.forEach((row, index) => {
    const event = JSON.parse(row.event_json);
    const source = memory.fragments[index].source;
    if (row.revision !== source.revision || event.id !== source.eventId) fail();
  });
  if (latestChoice && (!memory.decision || latestChoice.revision !== memory.decision.source.revision
    || JSON.parse(latestChoice.event_json).id !== memory.decision.source.eventId)) fail();
  function sourceEvent(source, type) {
    if (!source || source.revision > timeline.revision) fail();
    let origin;
    try { origin = mapSessionSource(timeline, source.revision); } catch { fail(); }
    if (origin.adventureId !== source.adventureId) fail();
    if (!rows.has(source.revision)) {
      const row = db.prepare("SELECT narration_json,events_json FROM turns WHERE revision=?").get(source.revision);
      if (!row) fail();
      const before = db.prepare("SELECT state_json FROM turns WHERE revision=?").get(source.revision - 1);
      if (!before) fail();
      rows.set(source.revision, { narration: JSON.parse(row.narration_json), events: JSON.parse(row.events_json),
        initialDay: JSON.parse(before.state_json).situation?.day });
    }
    const row = rows.get(source.revision);
    const event = row.events.find((entry) => entry.id === source.eventId);
    if (!event || event.type !== type || JSON.stringify(event.sourceSegmentIds) !== JSON.stringify(source.sourceSegmentIds)
      || source.sourceSegmentIds.some((id) => !row.narration.some((segment) => segment.id === id))) fail();
    let gameDay = row.initialDay;
    for (const previous of row.events) {
      if (previous === event) break;
      if (previous.type === "situation.update" && Object.hasOwn(previous.data, "day")) gameDay = previous.data.day;
    }
    return { event, gameDay };
  }
  for (const fragment of memory.fragments) {
    const { event, gameDay } = sourceEvent(fragment.source, "memory_fragment.record");
    if (fragment.gameDay !== gameDay) fail();
    for (const key of ["discoveryMode", "dimension", "trigger", "content"]) if (event.data[key] !== fragment[key]) fail();
  }
  if (memory.unlockedAt) sourceEvent(memory.unlockedAt, "memory_fragment.record");
  if (memory.decision && sourceEvent(memory.decision.source, "memory_fragment.resolve").event.data.choice !== memory.decision.choice) fail();
  remember();
}

module.exports = { validateMemoryFragmentSources };
