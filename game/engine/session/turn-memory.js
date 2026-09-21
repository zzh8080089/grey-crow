"use strict";

const { projectPlayerState } = require("./turn-model");
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDS = new Intl.Segmenter("und", { granularity: "word" });
const STOP_WORDS = new Set(["我", "你", "他", "她", "它", "的", "了", "是", "在", "和", "与", "请", "什么", "怎么", "之前", "当时", "记得", "我们", "这个", "那个", "the", "a", "an", "i", "you", "it", "to", "of", "and", "was", "is", "what", "は", "が", "を", "に", "の", "と", "です", "ます"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalize(value) { return value.normalize("NFKC").toLocaleLowerCase("und"); }
function size(value) { return JSON.stringify(value).length; }

function terms(value) {
  const result = new Set();
  for (const part of WORDS.segment(normalize(value))) {
    if (!part.isWordLike || STOP_WORDS.has(part.segment)) continue;
    result.add(part.segment);
    if (CJK.test(part.segment) && [...part.segment].length > 2) {
      const characters = [...part.segment];
      for (let index = 0; index < characters.length - 1; index += 1) result.add(characters.slice(index, index + 2).join(""));
    }
    if (result.size >= 128) break;
  }
  return result;
}

function includesTerm(haystack, term) {
  const start = haystack.indexOf(term);
  if (start < 0) return false;
  if (CJK.test(term)) return true;
  // Latin aliases such as Ann must not match unrelated words such as manner.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(haystack);
}

function excerpt(value, maximum, queryTerms) {
  if (value.length <= maximum) return { text: value, start: 0, end: value.length, truncated: false };
  const haystack = normalize(value);
  let match = -1;
  for (const term of queryTerms) {
    const index = haystack.indexOf(term);
    if (index >= 0 && (match < 0 || index < match)) match = index;
  }
  // Normalization can change offsets. A snippet remains an exact slice of the
  // original even when that approximate search position is imperfect.
  let start = Math.max(0, Math.min(value.length - maximum, Math.max(0, match) - Math.floor(maximum / 3)));
  if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start])) start -= 1;
  let end = Math.min(value.length, start + maximum);
  if (end < value.length && /[\uDC00-\uDFFF]/.test(value[end])) end -= 1;
  return { text: value.slice(start, end), start, end, truncated: true };
}

function currentFacts(state, experience) {
  const ids = new Set(experience.entityIds);
  return {
    entities: Object.fromEntries(Object.entries(state.entities).filter(([entityId]) => ids.has(entityId))),
    inventory: state.inventory.filter((entry) => ids.has(entry.itemId) || ids.has(entry.ownerId)),
    commitments: Object.fromEntries(Object.entries(state.commitments).filter(([, value]) =>
      ids.has(value.itemId) || ids.has(value.debtorId) || ids.has(value.creditorId))),
  };
}

function boundedResult(record, state, maximum, queryTerms, outputMode) {
  const annotated = record.recordType !== "story_source";
  const facts = outputMode === "full" && annotated ? currentFacts(state, record.experience) : null;
  const supporting = record.supportingPassages || [];
  const result = {
    // Records and passages still come from this store's independent local copy.
    // Lineage changes provenance identity, never the database or viewer scope.
    source: { adventureId: record.source?.adventureId ?? record.adventureId, revision: record.revision, actionId: record.actionId,
      ...(annotated ? { experienceId: record.experience.id } : {}),
      segmentIds: annotated ? [...record.experience.sourceSegmentIds] : record.passages.map(passage => passage.id) },
    ...(annotated ? { experience: structuredClone(record.experience) } : { recordType: "story_source" }),
    passages: [],
    ...(supporting.length ? { supportingPassages: [], supportingPassagesOmitted: 0 } : {}),
    ...(facts ? { currentFacts: { entities: {}, inventory: [], commitments: {}, omitted: { entities: 0, inventory: 0, commitments: 0 } } } : {}),
  };
  if (annotated) result.experience.knownBy = result.experience.knownBy.filter((entityId) => Object.hasOwn(state.entities, entityId));
  // The generator supplies complete current facts once at this fixed revision.
  // Its recall packet spends its budget on source text, not legacy synopses or
  // repeated state. Full recall preserves stored synopses only for audit.
  if (outputMode === "model" && annotated) delete result.experience.text;
  let truncated = false;
  // Preserve the source identity even if descriptive text or current facts are
  // larger than a context packet. Omission is explicit; it is not a zero value.
  if (facts && Object.hasOwn(result.experience, "text") && size(result) > Math.floor(maximum * 0.6)) {
    const chosen = excerpt(result.experience.text, Math.max(0, Math.floor(maximum / 4)), queryTerms);
    result.experience.text = chosen.text;
    result.experience.textTruncated = chosen.truncated;
    result.experience.textRange = { start: chosen.start, end: chosen.end };
    truncated = chosen.truncated;
  }
  if (size(result) > maximum) return null;
  const add = (apply, undo) => {
    apply();
    if (size(result) <= maximum) return true;
    undo();
    truncated = true;
    return false;
  };
  // Current commitments take priority over decorative entity attributes: an
  // old promise must be paired with its current fulfilled/cancelled status.
  for (const [commitmentId, value] of facts ? Object.entries(facts.commitments) : []) {
    if (!add(() => { result.currentFacts.commitments[commitmentId] = value; }, () => { delete result.currentFacts.commitments[commitmentId]; })) result.currentFacts.omitted.commitments += 1;
  }
  for (const entry of facts ? facts.inventory : []) {
    if (!add(() => result.currentFacts.inventory.push(entry), () => result.currentFacts.inventory.pop())) result.currentFacts.omitted.inventory += 1;
  }
  const sources = [
    ...(Object.hasOwn(record, "playerInput") ? [{ text: record.playerInput, metadata: { kind: "player_input" }, target: "playerInput" }] : []),
    ...record.passages.map(({ id, text }) => ({ text, metadata: { id }, target: "passages" })),
    ...supporting.map(({ text, ...metadata }) => ({ text, metadata, target: "supportingPassages" })),
  ];
  const insert = (source, chosen) => {
    const value = { ...source.metadata, ...chosen };
    if (source.target === "playerInput") result.playerInput = value;
    else result[source.target].push(value);
    return value;
  };
  const resetSources = () => {
    delete result.playerInput;
    result.passages = [];
    if (supporting.length) { result.supportingPassages = []; result.supportingPassagesOmitted = 0; }
  };
  // Raw text length is a lower bound: do not serialize a huge source group just
  // to discover that it cannot fit. If it can fit, preserve every role's full
  // paragraph before considering snippets; there is no fixed per-source cap.
  let completeSources = false;
  if (sources.reduce((total, source) => total + source.text.length, 0) <= maximum - size(result)) {
    for (const source of sources) insert(source, { text: source.text, start: 0, end: source.text.length, truncated: false });
    completeSources = size(result) <= maximum;
    if (!completeSources) resetSources();
  }
  if (!completeSources) {
    truncated = true;
    if (supporting.length) result.supportingPassagesOmitted = supporting.length;
    const selected = [];
    let minimumText = 0;
    const attempted = new Set();
    const reserve = (source) => {
      attempted.add(source);
      // Reserve the largest possible coordinate fields and enough encoded text
      // for a code point. A long first source cannot consume every later slot.
      const value = insert(source, { text: "", start: source.text.length, end: source.text.length, truncated: false });
      // Two UTF-16 units cost at most twelve JSON characters; a complete short
      // source can cost less and must remain usable at the exact budget edge.
      const minimum = source.text.length < 12 ? Math.min(12, JSON.stringify(source.text).length - 2) : 12;
      if (size(result) + minimumText + minimum > maximum) {
        if (source.target === "playerInput") delete result.playerInput;
        else result[source.target].pop();
        return false;
      }
      if (source.target === "supportingPassages") result.supportingPassagesOmitted -= 1;
      selected.push({ ...source, value }); minimumText += minimum;
      return true;
    };
    // Reserve one usable original before input metadata. If a paragraph's long
    // source identity cannot fit, try the next; merely trying the first does
    // not guarantee any original survives. Afterwards use the normal order so
    // multiple narrative paragraphs do not crowd out the player's own words.
    if (outputMode === "model") {
      for (const source of [...sources.filter((value) => value.target === "passages"),
        ...sources.filter((value) => value.target === "supportingPassages")]) {
        if (reserve(source)) break;
      }
    }
    for (const source of sources) if (!attempted.has(source)) reserve(source);
    let available = maximum - size(result);
    // Share serialized text space equally, releasing short complete sources'
    // unused space to longer ones. JSON escapes count against the same budget.
    let pending = selected.map((source) => ({ ...source,
      fullCost: source.text.length <= available ? JSON.stringify(source.text).length - 2 : Infinity }));
    while (pending.length) {
      const share = Math.floor(available / pending.length);
      const complete = pending.filter((source) => source.fullCost <= share);
      if (complete.length) {
        for (const source of complete) {
          Object.assign(source.value, { text: source.text, start: 0, end: source.text.length, truncated: false });
          available -= source.fullCost;
        }
        pending = pending.filter((source) => source.fullCost > share);
        continue;
      }
      for (const source of pending) {
        let low = 0, high = Math.min(source.text.length, share);
        let chosen = excerpt(source.text, 0, queryTerms);
        while (low <= high) {
          const length = Math.floor((low + high) / 2);
          const candidate = excerpt(source.text, length, queryTerms);
          if (JSON.stringify(candidate.text).length - 2 <= share) { chosen = candidate; low = length + 1; }
          else high = length - 1;
        }
        Object.assign(source.value, chosen);
      }
      break;
    }
  }
  for (const [entityId, value] of facts ? Object.entries(facts.entities) : []) {
    if (!add(() => { result.currentFacts.entities[entityId] = value; }, () => { delete result.currentFacts.entities[entityId]; })) result.currentFacts.omitted.entities += 1;
  }
  if (outputMode === "model" && !result.passages.some((passage) => passage.text.length)
    && !result.supportingPassages?.some((passage) => passage.text.length)) return null;
  return { result, truncated };
}

function createTurnMemory({ store, maxScannedRecords = 4096 }) {
  if (typeof store?.listExperienceRecords !== "function" || typeof store?.readModelState !== "function") throw new TypeError("A turn store with experience paging is required");
  if (!Number.isSafeInteger(maxScannedRecords) || maxScannedRecords < 1 || maxScannedRecords > 100_000) throw new RangeError("maxScannedRecords must be between 1 and 100000");

  function recall({ query, entityIds = [], viewerId, revision, limit = 6, maxCharacters = 12000, outputMode = "full",
    order = "relevance", beforeRevision, afterRevision } = {}) {
    if (typeof query !== "string" || query.length > 100_000 || !Array.isArray(entityIds) || entityIds.length > 256
      || entityIds.some((value) => typeof value !== "string" || !ID.test(value)) || new Set(entityIds).size !== entityIds.length
      || typeof viewerId !== "string" || !ID.test(viewerId)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 20
      || !Number.isSafeInteger(maxCharacters) || maxCharacters < 256 || maxCharacters > 64_000
      || !["full", "model"].includes(outputMode) || !["relevance", "earliest", "latest"].includes(order)
      || (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1))
      || (afterRevision !== undefined && (!Number.isSafeInteger(afterRevision) || afterRevision < 0))
      || (beforeRevision !== undefined && afterRevision !== undefined && afterRevision >= beforeRevision)) fail("MEMORY_QUERY_INVALID");
    const sourceBounds = { ...(beforeRevision === undefined ? {} : { beforeRevision }),
      ...(afterRevision === undefined ? {} : { afterRevision }) };
    const queryTerms = terms(query);
    const hasStoryLane = queryTerms.size > 0 && typeof store.listUnindexedStoryRecords === "function";
    // With room for at least two candidates, reserve a first opportunity for
    // each source channel. A one-candidate allowance prioritizes the index.
    let pageLimit = Math.min(32, hasStoryLane ? Math.max(1, Math.floor(maxScannedRecords / 2)) : maxScannedRecords);
    let page;
    try { page = store.listExperienceRecords({ revision, viewerId, cursor: 0, limit: pageLimit, ...sourceBounds }); }
    catch (error) {
      if (error?.code === "ACTION_INPUT_INVALID" && Object.keys(sourceBounds).length) fail("MEMORY_QUERY_INVALID");
      throw error;
    }
    const targetRevision = page.revision;
    // These exclusive bounds narrow source records, never the state or viewer
    // used for knowledge/correction checks at the fixed requested revision.
    if ((beforeRevision !== undefined && beforeRevision > targetRevision)
      || (afterRevision !== undefined && afterRevision > targetRevision)) fail("MEMORY_QUERY_INVALID");
    const formal = store.readModelState({ revision: targetRevision });
    if (viewerId !== formal.situation.playerId || formal.entities[viewerId]?.kind !== "character") fail("MEMORY_ACCESS_DENIED");
    const state = projectPlayerState(formal);
    if (entityIds.some((entityId) => !Object.hasOwn(state.entities, entityId))) fail("MEMORY_QUERY_INVALID");
    const selectedIds = new Set(entityIds);
    const queryText = normalize(query.trim());
    const namedIds = new Set();
    const matchedNames = [];
    for (const value of Object.values(state.entities)) {
      for (const name of [value.name, ...value.aliases]) {
        if (includesTerm(queryText, normalize(name))) { selectedIds.add(value.id); namedIds.add(value.id); matchedNames.push(normalize(name)); }
      }
    }
    const topicTerms = [...queryTerms].filter((term) => !matchedNames.some((name) => includesTerm(name, term)));
    const candidates = [];
    const rank = (left, right) => (order === "earliest" ? left.record.revision - right.record.revision
      : order === "latest" ? right.record.revision - left.record.revision : 0)
      || right.score - left.score || right.record.revision - left.record.revision || left.key.localeCompare(right.key);
    const scoreRecord = (record) => {
      const original = normalize([...record.passages, ...(record.supportingPassages || [])].map((passage) => passage.text).join("\n"));
      const playerInput = normalize(record.playerInput ?? "");
      // Time ordering must first match the requested topic. A name occurring
      // in a source (or its entity tags) alone cannot fill the earliest/latest
      // page ahead of the topic. Relevance keeps low-weight alias fallback.
      if (order !== "relevance" && topicTerms.length
        && !topicTerms.some((term) => includesTerm(original, term) || includesTerm(playerInput, term))) return 0;
      let score = 0;
      // Count each term once at its strongest source. Later player questions
      // remain searchable without outweighing an earlier original passage.
      // Model-written synopses never contribute relevance or admission.
      for (const term of queryTerms) score += includesTerm(original, term) ? 3
        : includesTerm(playerInput, term) ? 1 : 0;
      if (queryText.length > 1 && original.includes(queryText)) score += 4;
      const recordIds = record.experience?.entityIds ?? [];
      const entityMatch = recordIds.some((id) => selectedIds.has(id));
      // Entity hints are bounded and are not an admission pass for unrelated
      // text queries, including when time ordering is requested. Empty or
      // entity-name-only queries can still list matching entity records.
      // An explicitly mentioned complete name/alias is itself a text match,
      // unlike a caller-supplied ID hint. Keep alias-only historical recall.
      if (!score) return (!queryTerms.size && entityMatch) || recordIds.some((id) => namedIds.has(id)) ? 1 : 0;
      return score + (entityMatch ? 1 : 0);
    };
    const keep = (candidate) => {
      if (!candidate.score) return;
      candidates.push(candidate); candidates.sort(rank);
      if (candidates.length > limit * 2) { candidates.pop(); truncated = true; }
    };
    let scanned = 0;
    let truncated = false;
    // Independent source indexes share one scan allowance. Alternate bounded
    // pages so a long experience history cannot consume the whole allowance
    // before any unindexed source is considered. No extra model tool is used.
    const lanes = [{ kind: "experience", read: args => store.listExperienceRecords(args), cursor: 0, page, pageLimit }];
    if (hasStoryLane) {
      lanes.push({ kind: "story_source", read: args => store.listUnindexedStoryRecords(args), cursor: 0 });
    }
    while (lanes.length) {
      if (scanned >= maxScannedRecords) { truncated = true; break; }
      const lane = lanes.shift();
      pageLimit = lane.pageLimit ?? Math.min(32, maxScannedRecords - scanned);
      page = lane.page ?? lane.read({ revision: targetRevision, viewerId, cursor: lane.cursor, limit: pageLimit, ...sourceBounds });
      if (page.revision !== targetRevision) fail("MEMORY_REVISION_MISMATCH");
      if (!Array.isArray(page.records)) fail("MEMORY_SCAN_INVALID");
      const pageScanned = page.scannedRecords ?? page.records.length;
      if (!Number.isSafeInteger(pageScanned) || pageScanned < page.records.length || pageScanned > pageLimit
        || (pageScanned === 0 && page.nextCursor !== null)) fail("MEMORY_SCAN_INVALID");
      scanned += pageScanned;
      for (const record of page.records) {
        if (record.source !== undefined && (!record.source || typeof record.source.adventureId !== "string"
          || !ID.test(record.source.adventureId) || record.source.revision !== record.revision)) fail("MEMORY_SOURCE_UNAVAILABLE");
        const playerInput = Object.getOwnPropertyDescriptor(record, "playerInput");
        if (playerInput && (!Object.hasOwn(playerInput, "value") || typeof playerInput.value !== "string")) fail("MEMORY_SOURCE_UNAVAILABLE");
        if ((beforeRevision !== undefined && record.revision >= beforeRevision)
          || (afterRevision !== undefined && record.revision <= afterRevision)) continue;
        if (lane.kind === "story_source") {
          // These are source quotations, not inferred events or knowledge tags.
          // The store has excluded every indexed paragraph and every source
          // turn restricted by an existing experience or visible correction.
          if (record.recordType !== "story_source" || Object.hasOwn(record, "experience")
            || Object.hasOwn(record, "supportingPassages") || !record.source || !ID.test(record.actionId || "")
            || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > targetRevision
            || !Array.isArray(record.passages) || !record.passages.length || record.passages.length > 256
            || record.passages.some(passage => !passage || !ID.test(passage.id || "") || typeof passage.text !== "string"
              || !passage.text.trim() || Object.keys(passage).some(key => !["id", "text"].includes(key)))
            || new Set(record.passages.map(passage => passage.id)).size !== record.passages.length) fail("MEMORY_SOURCE_UNAVAILABLE");
          keep({ record, key: `story:${record.source.adventureId}:${record.revision}`, score: scoreRecord(record) });
          continue;
        }
        const experience = record.experience;
        // Permission filtering precedes tokenization, ranking, and result limits.
        if (!experience.knownBy.includes(viewerId)
          || experience.entityIds.some((entityId) => !Object.hasOwn(state.entities, entityId))) continue;
        // Only the store's verified opening-summary relationship is accepted.
        // Auxiliary evidence retains its own historical identity and never
        // replaces the experience's original confirmation-scene source.
        if (record.supportingPassages !== undefined && (!Array.isArray(record.supportingPassages)
          || record.supportingPassages.length > 256 || record.supportingPassages.some((passage) => !passage
            || passage.kind !== "opening_summary" || passage.adventureId !== (record.source?.adventureId ?? record.adventureId)
            || !Number.isSafeInteger(passage.revision) || passage.revision < 1 || passage.revision >= record.revision
            || passage.revision > targetRevision || !ID.test(passage.actionId || "") || !ID.test(passage.segmentId || "")
            || typeof passage.text !== "string" || !passage.text.trim()
            || Object.keys(passage).some((key) => !["kind", "adventureId", "revision", "actionId", "segmentId", "text"].includes(key))))) fail("MEMORY_SOURCE_UNAVAILABLE");
        keep({ record, key: experience.id, score: scoreRecord(record) });
      }
      if (page.nextCursor !== null) {
        if (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= lane.cursor) fail("MEMORY_CURSOR_INVALID");
        lanes.push({ kind: lane.kind, read: lane.read, cursor: page.nextCursor });
      }
    }
    candidates.sort(rank);
    const output = { revision: targetRevision, results: [], truncated };
    for (const candidate of candidates) {
      if (output.results.length >= limit) { output.truncated = true; break; }
      const remaining = maxCharacters - size(output) - (output.results.length ? 1 : 0);
      const bounded = boundedResult(candidate.record, state, remaining, queryTerms, outputMode);
      if (!bounded) { output.truncated = true; continue; }
      output.results.push(bounded.result);
      output.truncated ||= bounded.truncated;
      if (size(output) > maxCharacters) { output.results.pop(); output.truncated = true; }
    }
    return output;
  }
  return Object.freeze({ recall });
}

module.exports = { createTurnMemory };
