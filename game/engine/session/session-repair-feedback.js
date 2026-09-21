"use strict";

// Model repair data is compiled from fixed validator categories. It is never a
// copy of an exception, rejected value, entity map key, or upstream diagnostic.
const REPAIR_FEEDBACK_LIMITS = Object.freeze({ issues: 4, bytes: 2400, pathCharacters: 200 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FIELDS = new Set(("bundle state narration events experiences id text type sourceSegmentIds data entity entities inventory commitments situation kind name aliases visibility attributes removeAttributes fromId toId ownerId itemId quantity delta commitment debtorId creditorId due status condition health injuries hunger thirst fatigue localizedStatus localized_status playerId locationId day entityIds eventIds knownBy supersedes revision experienceId opening draft initialState proposalId finale phase candidate candidateId closureReason closedThreads intentionalOpenThreads finaleTone proposal segmentIds lastDeclined decision confirmation proposalRevision proposalSegmentIds memoryFragments fragments discoveryMode dimension trigger content choice certainty gameDay source revelationStatus unlockedAt conditionRecords format items basis sources predecessor recordId evidence quote start end totalCharacters characterId initialConditions adventureId reason segmentId terminalIntent fictionalContext intentReason").split(" "));
const ATTRIBUTE_FIELDS = new Set("status condition health injuries hunger thirst fatigue localizedStatus localized_status conditionRecords".split(" "));
FIELDS.add("event");
const ENUMS = new Set([
  "character, location, item", "player, hidden", "open, fulfilled, cancelled", "fulfilled, cancelled",
  "event, claim, belief", "observed, self_report", "resolved, retracted",
]);
const LIMITS = new Set([0, 1, 3, 4, 8, 10, 12, 16, 24, 32, 64, 120, 128, 240, 256, 512,
  800, 1000, 1600, 2000, 4000, 8000, 10000, 12000, 16000, 100000, 200000, 4000000, 1000000000, Number.MAX_SAFE_INTEGER]);

function own(value, key) {
  if (!value || typeof value !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
function arrayValues(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const out = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    out.push(descriptor.value);
  }
  return out;
}
function safePath(value) {
  if (typeof value !== "string" || value.length > 2048) return "bundle";
  const parts = value.split(".").slice(0, 20);
  const result = parts.map((part, index) => {
    // A valid protocol word can also be an arbitrary entity/attribute map key.
    if (["entities", "commitments"].includes(parts[index - 1])) return "entry";
    if (parts[index - 1] === "attributes" && !ATTRIBUTE_FIELDS.has(part)) return "field";
    const match = /^([A-Za-z_]+)(?:\[(\d+)\])?$/.exec(part);
    if (!match || !FIELDS.has(match[1])) return "field";
    if (match[2] === undefined) return match[1];
    const position = Number(match[2]);
    return `${match[1]}[${Number.isSafeInteger(position) && position >= 0 && position < 10000 ? position : ""}]`;
  }).join(".");
  return result.length <= REPAIR_FEEDBACK_LIMITS.pathCharacters ? result : "bundle";
}
function diagnostic(code, path, issue, expected, repair) { return { code, path, issue, expected: structuredClone(expected), repair }; }
function bounded(issues) {
  const result = [];
  for (const issue of issues) {
    if (result.length === REPAIR_FEEDBACK_LIMITS.issues) break;
    if (Buffer.byteLength(JSON.stringify([...result, issue])) > REPAIR_FEEDBACK_LIMITS.bytes) break;
    result.push(issue);
  }
  return result;
}
const FIXED = new Map();
function category(reasons, code, expected, repair) {
  for (const reason of reasons) FIXED.set(reason, { code, expected, repair });
}
category(["required field is missing"], "FIELD_REQUIRED", "required protocol field", "Add the missing field using the declared schema; do not invent a story fact.");
category(["unknown field", "unknown or non-data field"], "FIELD_NOT_ALLOWED", "only declared data fields", "Remove the unsupported field. A path named field is redacted, not a literal field to add.");
category(["must be an object"], "OBJECT_REQUIRED", "JSON object", "Use an object with the required protocol fields, not an array, scalar or null.");
category(["invalid ID"], "ID_INVALID", "1..96 ASCII letters, digits, underscore or hyphen; first character alphanumeric; no reserved object keys", "Copy a supplied identifier for references; create a distinct valid identifier only for a new object.");
category(["unsupported event type", "unsupported condition event"], "EVENT_TYPE_INVALID", "an exact event type declared in this request", "Use a supported event type and its matching data schema. Do not invent an event name or use an unavailable narrative module.");
category(["must match the entity key", "must match the commitment key"], "MAP_ID_MISMATCH", "the same ID as this object's map key", "Make this object's id agree with its key and update references consistently; do not invent another identity.");
category(["number must be finite"], "FINITE_NUMBER_REQUIRED", "finite JSON number", "Use a finite number allowed by this field; do not use NaN or Infinity.");
category(["must be a boolean"], "BOOLEAN_REQUIRED", [true, false], "Use a JSON boolean, not a string or number.");
category(["duplicate value", "duplicate segment ID", "duplicate event ID", "duplicate experience ID"], "DUPLICATE_VALUE", "unique values in this collection", "Remove duplicates or assign distinct new IDs, then update this candidate's references consistently.");
category(["entity does not exist", "condition target must be an existing character"], "ENTITY_REFERENCE_INVALID", "existing entity of the required kind", "Use an identifier already supplied or introduced by an earlier valid event in this candidate; do not guess hidden entities.");
category(["entity already exists", "commitment already exists"], "ID_ALREADY_EXISTS", "a new unused identifier for creation", "Update the existing object when intended; do not recreate it under the same identifier.");
category(["reference is not in this turn", "event reference is not in this turn"], "TURN_REFERENCE_INVALID", "ID declared in this candidate's referenced collection", "Copy an ID from this candidate's narration or events, as required by the field; do not use a prior turn's ID.");
category(["insufficient inventory"], "INSUFFICIENT_INVENTORY", "nonnegative inventory after the proposed change", "Reconcile the proposed amount with the supplied state; revise or remove the unsupported consequence and its narration together.");
category(["transfer owners must differ"], "TRANSFER_OWNERS_IDENTICAL", "different fromId and toId", "Remove a no-op transfer or correct its owners using the supplied state.");
category(["commitment does not exist", "commitment is already resolved"], "COMMITMENT_REFERENCE_INVALID", "an existing open commitment", "Use a currently open commitment from the supplied state; do not reopen an already resolved promise.");
category(["new commitment must be open"], "COMMITMENT_STATUS_INVALID", "open", "Create a new commitment with status open; resolve an existing commitment through commitment.resolve.");
category(["character conditions must be written through condition events", "new character conditions require condition events"], "CONDITION_EVENT_REQUIRED", "condition.add, condition.replace or condition.remove", "Move the bodily condition out of entity attributes and use a condition event with current narration evidence.");
category(["condition records are engine-owned"], "ENGINE_OWNED_FIELD", "no direct conditionRecords write", "Remove direct conditionRecords data; submit condition events and let the engine create record IDs and provenance.");
category(["legacy character conditions cannot be converted by condition events", "legacy character condition attributes are read-only"], "LEGACY_CONDITION_READ_ONLY", "unchanged legacy condition fields", "Keep the legacy fields unchanged; do not convert or overwrite them in this candidate.");
category(["invalid condition basis"], "CONDITION_BASIS_INVALID", ["observed", "self_report"], "Use observed for observable evidence or self_report for an attributed report; retain uncertainty in the wording.");
category(["invalid condition removal reason"], "CONDITION_REMOVAL_REASON_INVALID", ["resolved", "retracted"], "Use resolved for a condition that ended, or retracted to withdraw a mistaken earlier interpretation.");
category(["condition evidence must reference this event's current narration"], "CONDITION_SOURCE_INVALID", "current narration ID also listed in this event's sourceSegmentIds", "Copy a sourceSegmentId from this event and ensure it identifies exactly one current narration segment.");
category(["condition quote must match current narration exactly once"], "CONDITION_QUOTE_INVALID", "one exact, unambiguous substring of the referenced current narration", "Copy the exact original wording; do not paraphrase. Use a longer unique excerpt if the quote repeats.");
category(["duplicate condition evidence"], "CONDITION_EVIDENCE_DUPLICATE", "distinct source excerpts", "Remove the repeated excerpt from this condition event's evidence.");
category(["condition evidence exceeds total text limit"], "CONDITION_EVIDENCE_TOO_LONG", { maxCharacters: 8000 }, "Keep only necessary exact excerpts while preserving qualifiers and uncertainty.");
category(["condition replacement or removal requires an unchanged record from the turn's initial state"], "CONDITION_RECORD_INVALID", "an unchanged condition record present at the starting revision", "Copy a starting condition record ID, and replace or remove that record at most once in this turn.");
category(["duplicate condition record"], "CONDITION_RECORD_DUPLICATE", "a distinct condition interpretation", "Do not add the same condition and evidence twice; keep only one corresponding event.");
category(["fragment content must appear in its referenced narration"], "FRAGMENT_NARRATION_MISMATCH", "the full fragment content in its referenced current narration", "Make the event content and player-visible passage agree. If removing the fragment event, remove its uncommitted fragment passage too.");
category(["must update at least one field", "must change the quantity"], "EMPTY_CHANGE", "at least one actual change", "Remove the no-op event or provide the intended supported change.");
category(["attribute does not exist", "attribute cannot be updated and removed together"], "ATTRIBUTE_CHANGE_INVALID", "an existing attribute removed at most once and not also updated", "Use the supplied starting attributes; do not remove a missing attribute or both update and remove it.");
category(["current player must remain player-visible"], "PLAYER_VISIBILITY_INVALID", "player", "Keep the current player's visibility as player.");
category(["formal events require confirmed opening", "formal experiences require confirmed opening"], "OPENING_NOT_CONFIRMED", "opening events only before confirmation", "Continue the opening protocol; do not apply formal gameplay facts before the player confirms the proposal.");
category(["finale confirmation must be the last event"], "FINALE_EVENT_ORDER_INVALID", "confirmation as the final event", "Place supported ordinary consequences before the finale confirmation.");
category(["only one finale event is allowed per turn", "only one fragment choice is allowed per turn"], "TOO_MANY_DECISIONS", "at most one decision of this kind per turn", "Keep only the decision authorized by the current player input.");

function issueFeedback(issue) {
  const separator = issue.lastIndexOf(": ");
  const path = safePath(separator < 0 ? "bundle" : issue.slice(0, separator));
  const reason = separator < 0 ? "" : issue.slice(separator + 2);
  const fixed = FIXED.get(reason);
  if (fixed) return diagnostic(fixed.code, path, reason, fixed.expected, fixed.repair);
  let match = /^must be nonempty(?: well-formed)? text of at most (\d+) characters$/.exec(reason);
  if (match && LIMITS.has(Number(match[1]))) return diagnostic("TEXT_CONSTRAINT", path, reason,
    { type: "string", minCharacters: 1, maxCharacters: Number(match[1]), nonWhitespace: true,
      ...(reason.includes("well-formed") ? { wellFormed: true } : {}) }, path.includes("sourceSegmentIds")
      ? "Shorten the referenced current narration segment while preserving its qualifications, or select appropriate shorter segments. Do not add quote fields to sourceSegmentIds."
      : "Provide nonempty readable text within the length limit.");
  match = /^must be an integer from (-?\d+) to (\d+)$/.exec(reason);
  if (match && LIMITS.has(Math.abs(Number(match[1]))) && LIMITS.has(Number(match[2]))) return diagnostic("INTEGER_RANGE", path, reason,
    { type: "integer", minimum: Number(match[1]), maximum: Number(match[2]) }, "Use an integer within the declared range, consistent with the supplied state.");
  match = /^must be an array with (\d+) to (\d+) entries$/.exec(reason);
  if (match && LIMITS.has(Number(match[1])) && LIMITS.has(Number(match[2]))) return diagnostic("COLLECTION_SIZE", path, reason,
    { type: "array", minItems: Number(match[1]), maxItems: Number(match[2]) }, "Use an array and correct its number of entries; keep references consistent.");
  match = /^must be one of (.+)$/.exec(reason);
  if (match && ENUMS.has(match[1])) return diagnostic("ENUM_VALUE", path, reason, match[1].split(", "), "Use one of these exact protocol values.");
  match = /^must reference a (character|item|location)$/.exec(reason);
  if (match) return diagnostic("ENTITY_KIND_INVALID", path, reason, match[1], "Copy an identifier of this kind from the supplied state.");
  return diagnostic("STRUCTURE_INVALID", path, "invalid type, value, reference, or size", "the declared protocol schema",
    "Check this field against the supplied schema and starting state. Do not invent missing facts or expose repair details in narration.");
}

function safeFeedback(value) {
  if (own(value, "code") !== "TURN_VALIDATION_FAILED") return [];
  const issues = arrayValues(own(value, "issues"), 64);
  if (!issues) return [];
  return bounded(issues.filter(issue => typeof issue === "string" && issue.length <= 4096).map(issueFeedback));
}

function jsonSyntaxFeedback(error, text) {
  const message = own(error, "message");
  const result = { code: "JSON_SYNTAX", path: "$", repair: "Return one complete valid JSON object. Check commas, double-quoted keys, string escaping and matching brackets; do not append a second object or commentary." };
  if (typeof message !== "string" || typeof text !== "string") return result;
  const match = /\bat position (\d+)(?:\s|[.(]|$)/.exec(message.slice(0, 2048));
  const position = match ? Number(match[1]) : /^(?:Unexpected end of JSON input|Unterminated string in JSON)/.test(message) ? text.length : NaN;
  if (!Number.isSafeInteger(position) || position < 0 || position > text.length || position > 4000000) return result;
  const preceding = text.slice(0, position);
  return { ...result, position, line: preceding.split("\n").length, column: position - preceding.lastIndexOf("\n") };
}

function toolArgumentsFeedback(toolName, argsOrJson, context = {}) {
  let args = argsOrJson;
  if (typeof args === "string") {
    if (args.length > 65536) return [diagnostic("ARGUMENTS_TOO_LARGE", "arguments", "tool arguments exceed the size limit", "one compact arguments object", "Use only this tool's declared fields and keep its query concise.")];
    try { args = JSON.parse(args); }
    catch (error) { return [{ ...jsonSyntaxFeedback(error, args), path: "arguments" }]; }
  }
  const issues = [];
  const add = (code, field, expected, repair) => issues.push(diagnostic(code, `arguments${field ? `.${field}` : ""}`,
    "tool argument does not satisfy its declared constraint", expected, repair));
  if (!args || typeof args !== "object" || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
    add("OBJECT_REQUIRED", "", "JSON object", "Supply one object containing this tool's declared arguments."); return issues;
  }
  const schemas = { read_entity: ["entityId", "conditionRecordId", "sourceCursor"],
    recall_memory: ["query", "entityIds", "order", "beforeRevision", "afterRevision"],
    read_memory_fragments: ["cursor", "limit"], read_narrative_module: ["module"] };
  if (!Object.hasOwn(schemas, toolName)) {
    add("TOOL_NOT_AVAILABLE", "", "a tool declared in this request", "Use a currently available tool by its exact name."); return issues;
  }
  const allowed = schemas[toolName];
  const descriptors = Object.getOwnPropertyDescriptors(args);
  if (Reflect.ownKeys(descriptors).some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], "value"))) {
    add("FIELD_NOT_ALLOWED", "", allowed, "Remove undeclared fields; arguments must contain ordinary JSON data only.");
  }
  const get = key => own(args, key);
  const has = key => Object.hasOwn(descriptors, key);
  const validId = value => typeof value === "string" && ID.test(value);
  if (toolName === "read_narrative_module") {
    if (get("module") !== "memory_fragments") add("ENUM_VALUE", "module", ["memory_fragments"], "Use the exact available module name.");
  } else if (toolName === "read_entity") {
    if (!validId(get("entityId"))) add("ID_INVALID", "entityId", "a supplied player-visible entity ID", "Copy the entity ID from the current context; do not guess an identity.");
    if (has("conditionRecordId") && !validId(get("conditionRecordId"))) add("ID_INVALID", "conditionRecordId", "a supplied condition record ID", "Copy a current record ID or a predecessor ID returned by this reader.");
    if (has("sourceCursor") && (!get("conditionRecordId") || typeof get("sourceCursor") !== "string" || !get("sourceCursor").length || get("sourceCursor").length > 2048)
      || context.cursorInvalid === true) add("CURSOR_INVALID", "sourceCursor", "the exact nextCursor returned for this condition record", "Omit sourceCursor on the first read; afterwards copy nextCursor unchanged and keep the same conditionRecordId.");
    if (context.conditionRecordInvalid === true) add("CONDITION_RECORD_INVALID", "conditionRecordId", "a current or reader-supplied predecessor record ID", "Read a record actually supplied for this character; do not construct record IDs.");
  } else if (toolName === "recall_memory") {
    const ids = arrayValues(get("entityIds"), 12);
    if (typeof get("query") !== "string" || get("query").length > 2000 || (!get("query").trim() && !ids?.length)) {
      add("QUERY_INVALID", "query", { type: "string", maxCharacters: 2000, emptyOnlyWithEntityIds: true }, "Provide a concise query; an empty query requires at least one supplied player-visible entity ID.");
    }
    const visible = arrayValues(context.visibleEntityIds, 10000);
    if (has("entityIds") && (!ids || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || visible && !visible.includes(id)))) {
      add("ENTITY_REFERENCES_INVALID", "entityIds", "0..12 distinct player-visible entity IDs", "Copy only player-visible IDs already supplied in this request, or omit entityIds. Unavailable and unknown IDs are treated identically.");
    }
    if (has("order") && !["relevance", "earliest", "latest"].includes(get("order"))) add("ENUM_VALUE", "order", ["relevance", "earliest", "latest"], "Use one of these exact values or omit order for relevance.");
    for (const [key, minimum] of [["beforeRevision", 1], ["afterRevision", 0]]) {
      const value = get(key);
      if (has(key) && (!Number.isSafeInteger(value) || value < minimum || Number.isSafeInteger(context.baseRevision) && value > context.baseRevision)) {
        add("REVISION_BOUND_INVALID", key, { type: "integer", minimum, maximum: "current starting revision" }, "Use an existing revision bound from the current adventure, or omit this optional filter.");
      }
    }
    if (Number.isSafeInteger(get("beforeRevision")) && Number.isSafeInteger(get("afterRevision")) && get("afterRevision") >= get("beforeRevision")) {
      add("REVISION_RANGE_INVALID", "afterRevision", "afterRevision < beforeRevision; both bounds exclusive", "Use a nonempty chronological interval or omit one bound.");
    }
  } else if (toolName === "read_memory_fragments") {
    if (has("limit") && (!Number.isSafeInteger(get("limit")) || get("limit") < 1 || get("limit") > 10)) add("INTEGER_RANGE", "limit", { type: "integer", minimum: 1, maximum: 10 }, "Use 1..10 or omit limit for the default of 10.");
    const cursor = get("cursor");
    const badCursor = has("cursor") && (!cursor || typeof cursor !== "object" || Array.isArray(cursor)
      || Object.keys(cursor).length !== 3 || !["adventureId", "revision", "afterIndex"].every(key => Object.hasOwn(cursor, key))
      || !validId(own(cursor, "adventureId")) || !Number.isSafeInteger(own(cursor, "revision"))
      || Number.isSafeInteger(context.baseRevision) && own(cursor, "revision") !== context.baseRevision
      || !Number.isSafeInteger(own(cursor, "afterIndex")) || own(cursor, "afterIndex") < 1);
    if (badCursor || context.cursorInvalid === true || has("cursor") && !issues.length) add("CURSOR_INVALID", "cursor", "the exact non-null nextCursor returned by this tool", "For the first page omit cursor. For the next page copy nextCursor unchanged; do not fabricate adventureId, revision or afterIndex.");
  }
  if (!issues.length) add("ARGUMENTS_INVALID", "", allowed, "Recheck this tool's declared argument constraints; copy supplied identifiers and cursors instead of guessing them.");
  return bounded(issues);
}

module.exports = { REPAIR_FEEDBACK_LIMITS, safeFeedback, jsonSyntaxFeedback, toolArgumentsFeedback };
