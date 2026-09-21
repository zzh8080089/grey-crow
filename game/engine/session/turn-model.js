"use strict";

// This module validates structure and deterministic state changes, not whether
// narration truthfully describes those changes. Attributes on visible entities
// are public; secrets must belong to hidden entities until field-level knowledge
// is explicitly modelled.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const QUANTITY_LIMIT = 1_000_000_000;
const COLLECTION_LIMIT = 10_000;
const conditions = require("./session-character-conditions");

function reject(path, reason, category = "INVALID_TURN_STRUCTURE") {
  const issue = `${path}: ${reason}`;
  const error = new Error(issue);
  error.code = "TURN_VALIDATION_FAILED";
  error.reason = category;
  error.issues = [issue];
  throw error;
}

function plainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject(path, "must be an object");
  }
}

// Clone before validation so callers cannot mutate accepted data afterwards.
// Do not invoke toJSON or getters supplied by an untrusted candidate.
function jsonCopy(value, path, budget = { nodes: 0, characters: 0 }, depth = 0) {
  if (++budget.nodes > 200_000 || depth > 16) reject(path, "JSON is too large or deeply nested");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.characters += value.length;
    if (budget.characters > 4_000_000) reject(path, "JSON text exceeds the size limit");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(path, "number must be finite");
    return value;
  }
  if (typeof value !== "object") reject(path, "must contain only JSON values");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) reject(path, "array has an unsupported prototype");
    if (value.length > COLLECTION_LIMIT) reject(path, "array is too large");
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) reject(path, "array must be dense without extra properties");
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        reject(`${path}[${index}]`, "array must contain ordinary JSON values");
      }
      result.push(jsonCopy(descriptor.value, `${path}[${index}]`, budget, depth + 1));
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) reject(path, "unsupported object prototype");
  const keys = Reflect.ownKeys(value);
  if (keys.length > COLLECTION_LIMIT) reject(path, "object has too many fields");
  const result = {};
  for (const key of keys) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) reject(path, "unsafe object key");
    budget.characters += key.length;
    if (key.length > 512 || budget.characters > 4_000_000) reject(path, "JSON object key exceeds the size limit");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      reject(`${path}.${key}`, "must be an enumerable data field");
    }
    result[key] = jsonCopy(descriptor.value, `${path}.${key}`, budget, depth + 1);
  }
  return result;
}

function fields(value, required, optional, path) {
  plainObject(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reject(`${path}.${key}`, "unknown field");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) reject(`${path}.${key}`, "required field is missing");
  }
}

function id(value, path) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN_KEYS.has(value)) reject(path, "invalid ID");
}

function text(value, path, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    reject(path, `must be nonempty text of at most ${max} characters`);
  }
}

function integer(value, path, minimum = 0, maximum = QUANTITY_LIMIT) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(path, `must be an integer from ${minimum} to ${maximum}`);
  }
}

function oneOf(value, choices, path) {
  if (!choices.includes(value)) reject(path, `must be one of ${choices.join(", ")}`);
}

function array(value, path, maximum = COLLECTION_LIMIT, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    reject(path, `must be an array with ${minimum} to ${maximum} entries`);
  }
}

function distinctStrings(values, path, check, maximum, minimum = 0) {
  array(values, path, maximum, minimum);
  const seen = new Set();
  values.forEach((value, index) => {
    check(value, `${path}[${index}]`);
    if (seen.has(value)) reject(`${path}[${index}]`, "duplicate value");
    seen.add(value);
  });
}

function attributes(value, path) {
  plainObject(value, path);
  if (Object.keys(value).length > 128) reject(path, "too many attributes");
}

function writableAttributes(value, path, kind) {
  attributes(value, path);
  if (kind === "character") {
    for (const key of [...conditions.LEGACY_CHARACTER_CONDITION_KEYS, "conditionRecords"]) {
      if (Object.hasOwn(value, key)) reject(`${path}.${key}`, "character conditions must be written through condition events");
    }
  }
  if (Object.hasOwn(value, "status")) {
    text(value.status, `${path}.status`, 512);
  }
}

function aliases(value, path) {
  distinctStrings(value, path, (entry, entryPath) => text(entry, entryPath, 256), 64);
}

function entity(value, path) {
  fields(value, ["id", "kind", "name", "aliases", "visibility", "attributes"], ["conditionRecords"], path);
  id(value.id, `${path}.id`);
  oneOf(value.kind, ["character", "location", "item"], `${path}.kind`);
  text(value.name, `${path}.name`, 512);
  aliases(value.aliases, `${path}.aliases`);
  oneOf(value.visibility, ["player", "hidden"], `${path}.visibility`);
  attributes(value.attributes, `${path}.attributes`);
  if (Object.hasOwn(value, "conditionRecords")) {
    if (value.kind !== "character" || conditions.hasLegacyConditions(value)) reject(path, "condition records require a character without legacy condition attributes");
    conditions.validateConditionRecords(value.conditionRecords, { characterId: value.id, path: `${path}.conditionRecords` });
  }
}

function reference(state, value, path, kind) {
  id(value, path);
  if (!Object.hasOwn(state.entities, value)) reject(path, "entity does not exist");
  if (kind && state.entities[value].kind !== kind) reject(path, `must reference a ${kind}`);
}

function commitment(state, value, path) {
  fields(value, ["id", "debtorId", "creditorId", "itemId", "quantity", "due", "status"], [], path);
  id(value.id, `${path}.id`);
  reference(state, value.debtorId, `${path}.debtorId`, "character");
  reference(state, value.creditorId, `${path}.creditorId`, "character");
  reference(state, value.itemId, `${path}.itemId`, "item");
  integer(value.quantity, `${path}.quantity`, 1);
  text(value.due, `${path}.due`);
  oneOf(value.status, ["open", "fulfilled", "cancelled"], `${path}.status`);
}

function validateState(state) {
  fields(state, ["entities", "inventory", "commitments", "situation"], ["opening", "finale", "memoryFragments"], "state");
  if (state.opening?.proposal?.initialState && Object.hasOwn(state.opening.proposal.initialState, "finale")) {
    reject("state.opening.proposal.initialState", "opening candidate cannot contain finale metadata");
  }
  if (state.opening?.proposal?.initialState && Object.hasOwn(state.opening.proposal.initialState, "memoryFragments")) {
    reject("state.opening.proposal.initialState", "opening candidate cannot set optional fragment progress or capability");
  }
  require("./session-finale-model").validateFinale(state);
  require("./session-memory-fragments").validateMemoryFragments(state);
  if (state.opening !== undefined) {
    require("./session-opening").validateOpening(state, { validateReadyState: validateInitialState });
  }
  plainObject(state.entities, "state.entities");
  for (const [key, value] of Object.entries(state.entities)) {
    id(key, `state.entities.${key}`);
    entity(value, `state.entities.${key}`);
    if (value.id !== key) reject(`state.entities.${key}.id`, "must match the entity key");
  }
  array(state.inventory, "state.inventory");
  const holdings = new Set();
  state.inventory.forEach((entry, index) => {
    const path = `state.inventory[${index}]`;
    fields(entry, ["ownerId", "itemId", "quantity"], [], path);
    reference(state, entry.ownerId, `${path}.ownerId`);
    reference(state, entry.itemId, `${path}.itemId`, "item");
    integer(entry.quantity, `${path}.quantity`);
    const key = `${entry.ownerId}:${entry.itemId}`;
    if (holdings.has(key)) reject(path, "duplicate inventory holding");
    holdings.add(key);
  });
  state.inventory = state.inventory.filter((entry) => entry.quantity > 0);
  plainObject(state.commitments, "state.commitments");
  for (const [key, value] of Object.entries(state.commitments)) {
    id(key, `state.commitments.${key}`);
    commitment(state, value, `state.commitments.${key}`);
    if (value.id !== key) reject(`state.commitments.${key}.id`, "must match the commitment key");
  }
  fields(state.situation, ["playerId", "locationId", "day"], [], "state.situation");
  if (!state.opening || state.opening.phase === "ready") {
    reference(state, state.situation.playerId, "state.situation.playerId", "character");
    reference(state, state.situation.locationId, "state.situation.locationId", "location");
  }
  integer(state.situation.day, "state.situation.day");
  return state;
}

function validateInitialState(state) {
  return validateState(jsonCopy(state, "state"));
}

function sourceReferences(values, validIds, path) {
  distinctStrings(values, path, (value, entryPath) => {
    id(value, entryPath);
    if (!validIds.has(value)) reject(entryPath, "reference is not in this turn");
  }, 256, 1);
}

function fragmentComparableText(value) {
  // Keep word separation in languages such as English ("not able" is not
  // "notable"). Chinese/Japanese characters and sentence punctuation may be
  // separated by paragraph layout without changing the quoted characters.
  return value.replace(/\s+/gu, " ").trim()
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？；：「」『』（）《》〈〉【】]) | (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？；：「」『』（）《》〈〉【】])/gu, "");
}

function changeHolding(state, ownerId, itemId, delta, path) {
  const entry = state.inventory.find((holding) => holding.ownerId === ownerId && holding.itemId === itemId);
  const quantity = (entry ? entry.quantity : 0) + delta;
  if (quantity < 0) reject(path, "insufficient inventory", "INSUFFICIENT_INVENTORY");
  integer(quantity, path);
  if (entry) {
    entry.quantity = quantity;
  } else if (quantity > 0) {
    state.inventory.push({ ownerId, itemId, quantity });
  }
  state.inventory = state.inventory.filter((holding) => holding.quantity > 0);
}

function applyEvent(state, event, path, context) {
  if (typeof event.type === "string" && event.type.startsWith("memory_fragment.")) {
    return require("./session-memory-fragments").applyMemoryFragmentEvent(state, event, context);
  }
  if (typeof event.type === "string" && /^(finale|extreme)\./.test(event.type)) {
    return require("./session-finale-model").applyFinaleEvent(state, event, context);
  }
  if (typeof event.type === "string" && event.type.startsWith("opening.")) {
    const next = require("./session-opening").applyOpeningEvent(state, event, {
      ...context, validateReadyState: validateInitialState,
    });
    // Validate only a newly supplied proposal. Reads and confirmation of an
    // already committed proposal keep their original snapshot unchanged.
    if (event.type === "opening.propose") {
      for (const entity of Object.values(next.opening.proposal.initialState.entities)) {
        if (entity.kind === "character") writableAttributes(entity.attributes,
          `${path}.data.initialState.entities.${entity.id}.attributes`, entity.kind);
      }
    }
    return next;
  }
  if (state.opening && state.opening.phase !== "ready") reject(path, "formal events require confirmed opening");
  if (typeof event.type === "string" && event.type.startsWith("condition.")) {
    return conditions.applyCharacterConditionEvent(state, event, { ...context, path });
  }
  const data = event.data;
  const dataPath = `${path}.data`;
  switch (event.type) {
    case "entity.create":
      fields(data, ["entity"], [], dataPath);
      if (Object.hasOwn(data.entity || {}, "conditionRecords")) reject(`${dataPath}.entity.conditionRecords`, "condition records are engine-owned");
      entity(data.entity, `${dataPath}.entity`);
      writableAttributes(data.entity.attributes, `${dataPath}.entity.attributes`, data.entity.kind);
      if (Object.hasOwn(state.entities, data.entity.id)) reject(dataPath, "entity already exists");
      state.entities[data.entity.id] = jsonCopy(data.entity, `${dataPath}.entity`);
      conditions.initializeCharacterConditions(state.entities[data.entity.id], { path: `${dataPath}.entity` });
      break;
    case "entity.update": {
      fields(data, ["id"], ["name", "aliases", "attributes", "removeAttributes", "visibility"], dataPath);
      reference(state, data.id, `${dataPath}.id`);
      if (Object.keys(data).length === 1) reject(dataPath, "must update at least one field");
      if (Object.hasOwn(data, "name")) text(data.name, `${dataPath}.name`, 512);
      if (Object.hasOwn(data, "aliases")) aliases(data.aliases, `${dataPath}.aliases`);
      if (Object.hasOwn(data, "attributes")) writableAttributes(data.attributes, `${dataPath}.attributes`, state.entities[data.id].kind);
      if (Object.hasOwn(data, "visibility")) oneOf(data.visibility, ["player", "hidden"], `${dataPath}.visibility`);
      const previousAttributes = state.entities[data.id].attributes;
      if (Object.hasOwn(data, "removeAttributes")) {
        distinctStrings(data.removeAttributes, `${dataPath}.removeAttributes`, (key, keyPath) => {
          if (typeof key !== "string" || key.length > 512 || FORBIDDEN_KEYS.has(key)) reject(keyPath, "invalid attribute key");
          if (state.entities[data.id].kind === "character"
            && [...conditions.LEGACY_CHARACTER_CONDITION_KEYS, "conditionRecords"].includes(key)) {
            reject(keyPath, "legacy character condition attributes are read-only");
          }
          if (!Object.hasOwn(previousAttributes, key)) reject(keyPath, "attribute does not exist");
          if (Object.hasOwn(data.attributes || {}, key)) reject(keyPath, "attribute cannot be updated and removed together");
        }, 128);
      }
      // An attribute update must not erase identity or unrelated descriptions.
      // Merge top-level keys only; each supplied value replaces that key's
      // whole JSON value. Deletion requires an explicit existing-key list.
      if (Object.hasOwn(data, "attributes") || Object.hasOwn(data, "removeAttributes")) {
        const updatedAttributes = { ...previousAttributes, ...data.attributes };
        for (const key of data.removeAttributes || []) delete updatedAttributes[key];
        attributes(updatedAttributes, `${dataPath}.attributes`);
        state.entities[data.id].attributes = jsonCopy(updatedAttributes, `${dataPath}.attributes`);
      }
      for (const key of Object.keys(data)) {
        if (!["id", "attributes", "removeAttributes"].includes(key)) state.entities[data.id][key] = jsonCopy(data[key], `${dataPath}.${key}`);
      }
      break;
    }
    case "inventory.transfer":
      fields(data, ["fromId", "toId", "itemId", "quantity"], [], dataPath);
      reference(state, data.fromId, `${dataPath}.fromId`);
      reference(state, data.toId, `${dataPath}.toId`);
      reference(state, data.itemId, `${dataPath}.itemId`, "item");
      integer(data.quantity, `${dataPath}.quantity`, 1);
      if (data.fromId === data.toId) reject(dataPath, "transfer owners must differ");
      changeHolding(state, data.fromId, data.itemId, -data.quantity, dataPath);
      changeHolding(state, data.toId, data.itemId, data.quantity, dataPath);
      break;
    case "inventory.adjust":
      fields(data, ["ownerId", "itemId", "delta"], [], dataPath);
      reference(state, data.ownerId, `${dataPath}.ownerId`);
      reference(state, data.itemId, `${dataPath}.itemId`, "item");
      integer(data.delta, `${dataPath}.delta`, -QUANTITY_LIMIT);
      if (data.delta === 0) reject(`${dataPath}.delta`, "must change the quantity");
      changeHolding(state, data.ownerId, data.itemId, data.delta, dataPath);
      break;
    case "commitment.create":
      fields(data, ["commitment"], [], dataPath);
      commitment(state, data.commitment, `${dataPath}.commitment`);
      if (data.commitment.status !== "open") reject(dataPath, "new commitment must be open");
      if (Object.hasOwn(state.commitments, data.commitment.id)) reject(dataPath, "commitment already exists");
      state.commitments[data.commitment.id] = jsonCopy(data.commitment, `${dataPath}.commitment`);
      break;
    case "commitment.resolve":
      fields(data, ["id", "status"], [], dataPath);
      id(data.id, `${dataPath}.id`);
      oneOf(data.status, ["fulfilled", "cancelled"], `${dataPath}.status`);
      if (!Object.hasOwn(state.commitments, data.id)) reject(dataPath, "commitment does not exist");
      if (state.commitments[data.id].status !== "open") reject(dataPath, "commitment is already resolved");
      state.commitments[data.id].status = data.status;
      break;
    case "situation.update":
      fields(data, [], ["locationId", "day"], dataPath);
      if (Object.keys(data).length === 0) reject(dataPath, "must update at least one field");
      if (Object.hasOwn(data, "locationId")) reference(state, data.locationId, `${dataPath}.locationId`, "location");
      if (Object.hasOwn(data, "day")) integer(data.day, `${dataPath}.day`);
      Object.assign(state.situation, data);
      break;
    default:
      reject(`${path}.type`, "unsupported event type");
  }
  return state;
}

function turnOptions(options) {
  plainObject(options, "options");
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) reject("options", "unsupported object prototype");
  const copy = {};
  for (const key of Reflect.ownKeys(options)) {
    if (!["baseRevision", "terminalReservation", "adventureId", "memoryFragmentsEnabled"].includes(key)) reject("options", "unknown field");
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject("options", "must contain ordinary data fields");
    // Options remain optional for ordinary non-lifecycle events. Explicit
    // undefined is equivalent to omission, without invoking any accessor.
    if (descriptor.value !== undefined) copy[key] = jsonCopy(descriptor.value, `options.${key}`);
  }
  if (copy.memoryFragmentsEnabled !== undefined && typeof copy.memoryFragmentsEnabled !== "boolean") reject("options.memoryFragmentsEnabled", "must be a boolean");
  if (copy.adventureId !== undefined) id(copy.adventureId, "options.adventureId");
  return copy;
}

function validatePlayerVisibility(priorState, state, events) {
  // Creation has its own confirmation contract. Apply this only to new free
  // play candidates, never when reading an existing snapshot or system boundary.
  if (priorState.opening && priorState.opening.phase !== "ready") return;
  const playerId = state.situation.playerId;
  let lastVisibilityIndex = -1;
  events.forEach((event, index) => {
    if (event.type === "entity.update" && event.data.id === playerId && Object.hasOwn(event.data, "visibility")) {
      lastVisibilityIndex = index;
    }
  });
  if (state.entities[playerId]?.visibility !== "player") {
    reject(lastVisibilityIndex === -1 ? "bundle.events" : `bundle.events[${lastVisibilityIndex}].data.visibility`,
      "current player must remain player-visible");
  }
}

function applyTurnBundle(initialState, candidate, options = {}) {
  const { baseRevision, terminalReservation, adventureId, memoryFragmentsEnabled = false } = turnOptions(options);
  const priorState = validateInitialState(initialState);
  if (priorState.finale?.phase === "confirmed") reject("state.finale", "confirmed finale cannot accept another turn");
  let state = validateInitialState(priorState);
  const bundle = jsonCopy(candidate, "bundle");
  fields(bundle, ["narration", "events", "experiences"], [], "bundle");
  array(bundle.narration, "bundle.narration", 256, 1);
  const segmentIds = new Set();
  bundle.narration.forEach((segment, index) => {
    const path = `bundle.narration[${index}]`;
    fields(segment, ["id", "text"], [], path);
    id(segment.id, `${path}.id`);
    text(segment.text, `${path}.text`, 200_000);
    if (segmentIds.has(segment.id)) reject(`${path}.id`, "duplicate segment ID");
    segmentIds.add(segment.id);
  });
  array(bundle.events, "bundle.events", 256);
  const eventIds = new Set();
  let finaleEvents = 0;
  let terminalConsumed = false;
  let fragmentDayFloor = null;
  let fragmentChoices = 0;
  const conditionTargets = new Set();
  bundle.events.forEach((event, index) => {
    const path = `bundle.events[${index}]`;
    fields(event, ["id", "type", "sourceSegmentIds", "data"], [], path);
    id(event.id, `${path}.id`);
    if (eventIds.has(event.id)) reject(`${path}.id`, "duplicate event ID");
    eventIds.add(event.id);
    sourceReferences(event.sourceSegmentIds, segmentIds, `${path}.sourceSegmentIds`);
    if (typeof event.type === "string" && /^(finale|extreme)\./.test(event.type)) {
      finaleEvents += 1;
      if (finaleEvents > 1) reject(path, "only one finale event is allowed per turn");
      const extremeTerminal = event.type === "extreme.confirm" && priorState.finale?.candidate?.kind === "extreme"
        && priorState.finale.candidate.confirmations.length === 2;
      if ((event.type === "finale.confirm" || extremeTerminal) && index !== bundle.events.length - 1) reject(path, "finale confirmation must be the last event");
      if (extremeTerminal) terminalConsumed = true;
    }
    if (event.type === "memory_fragment.resolve" && ++fragmentChoices > 1) reject(path, "only one fragment choice is allowed per turn");
    state = applyEvent(state, event, path, { priorState, baseRevision, segmentIds, terminalReservation, adventureId, memoryFragmentsEnabled,
      conditionTargets, narration: bundle.narration });
    if (event.type === "memory_fragment.record") {
      // The fragment panel may quote only the recollection actually delivered
      // in its linked prose. Normalize paragraph layout while retaining word
      // boundaries, every other character and narration order. This checks
      // textual presence, not whether the recollection is true or well written.
      const linked = new Set(event.sourceSegmentIds);
      const sourceText = fragmentComparableText(bundle.narration.filter((segment) => linked.has(segment.id))
        .map((segment) => segment.text).join("\n"));
      if (!sourceText.includes(fragmentComparableText(event.data.content))) {
        reject(`${path}.data.content`, "fragment content must appear in its referenced narration");
      }
      fragmentDayFloor = state.situation.day;
    }
    // A fragment-bearing turn cannot advance, consume another day's allowance,
    // and then rewind its clock. Ordinary date corrections remain supported.
    if (fragmentDayFloor !== null && state.situation.day < fragmentDayFloor) reject(path, "cannot rewind the day after recording a fragment");
  });
  if (terminalReservation !== undefined && !terminalConsumed) reject("terminalReservation", "reservation requires a third extreme confirmation");
  validatePlayerVisibility(priorState, state, bundle.events);
  array(bundle.experiences, "bundle.experiences", 256);
  if (state.opening && state.opening.phase !== "ready" && bundle.experiences.length) {
    reject("bundle.experiences", "formal experiences require confirmed opening");
  }
  const experienceIds = new Set();
  bundle.experiences.forEach((experience, index) => {
    const path = `bundle.experiences[${index}]`;
    fields(experience, ["id", "entityIds", "eventIds", "sourceSegmentIds", "kind", "knownBy"], ["supersedes", "text"], path);
    id(experience.id, `${path}.id`);
    if (experienceIds.has(experience.id)) reject(`${path}.id`, "duplicate experience ID");
    experienceIds.add(experience.id);
    // New memories index the original passages without a second synopsis.
    // Preserve valid older candidates verbatim; omission is not a blank story.
    if (Object.hasOwn(experience, "text")) text(experience.text, `${path}.text`, 16_000);
    oneOf(experience.kind, ["event", "claim", "belief"], `${path}.kind`);
    sourceReferences(experience.sourceSegmentIds, segmentIds, `${path}.sourceSegmentIds`);
    distinctStrings(experience.entityIds, `${path}.entityIds`, (value, entryPath) => reference(state, value, entryPath), 256);
    distinctStrings(experience.knownBy, `${path}.knownBy`, (value, entryPath) => reference(state, value, entryPath, "character"), 256);
    distinctStrings(experience.eventIds, `${path}.eventIds`, (value, entryPath) => {
      id(value, entryPath);
      if (!eventIds.has(value)) reject(entryPath, "event reference is not in this turn");
    }, 256);
    if (Object.hasOwn(experience, "supersedes")) {
      array(experience.supersedes, `${path}.supersedes`, 256);
      const replaced = new Set();
      experience.supersedes.forEach((source, sourceIndex) => {
        const sourcePath = `${path}.supersedes[${sourceIndex}]`;
        fields(source, ["revision", "experienceId"], [], sourcePath);
        integer(source.revision, `${sourcePath}.revision`, 1, Number.MAX_SAFE_INTEGER);
        id(source.experienceId, `${sourcePath}.experienceId`);
        const key = `${source.revision}:${source.experienceId}`;
        if (replaced.has(key)) reject(sourcePath, "duplicate superseded experience");
        replaced.add(key);
      });
    }
  });
  // The resulting state must satisfy the same JSON size limits as a reopened
  // state, including entities and attributes introduced by this turn.
  return { state: validateInitialState(state), bundle };
}

function projectPlayerState(initialState) {
  const state = validateInitialState(initialState);
  const visible = (entityId) => state.entities[entityId]?.visibility === "player";
  const entities = Object.fromEntries(Object.entries(state.entities).filter(([entityId]) => visible(entityId)));
  const playerId = state.situation.playerId;
  return {
    entities,
    inventory: state.inventory.filter((entry) => entry.ownerId === playerId && visible(playerId) && visible(entry.itemId)),
    commitments: Object.fromEntries(Object.entries(state.commitments).filter(([, entry]) =>
      (entry.debtorId === playerId || entry.creditorId === playerId)
      && visible(entry.debtorId) && visible(entry.creditorId) && visible(entry.itemId))),
    situation: {
      playerId: visible(playerId) ? playerId : null,
      locationId: visible(state.situation.locationId) ? state.situation.locationId : null,
      day: state.situation.day,
    },
    // Every fragment is the player's uncertain recollection. Consumers should
    // page this ledger for display and use only progress in permanent prompts.
    ...(state.memoryFragments ? { memoryFragments: state.memoryFragments } : {}),
    ...(state.opening ? { opening: {
      phase: state.opening.phase, draft: state.opening.draft,
      proposal: state.opening.proposal ? {
        proposalId: state.opening.proposal.proposalId,
        summary: state.opening.proposal.summary,
      } : null,
      ...(state.opening.confirmation ? { confirmation: state.opening.confirmation } : {}),
    } } : {}),
    // Candidate rationale may include host-only reasoning. The player sees the
    // actual asking/closing passages, plus only these safe lifecycle references.
    ...(state.finale ? { finale: {
      phase: state.finale.phase,
      candidate: state.finale.candidate ? { candidateId: state.finale.candidate.candidateId,
        proposal: state.finale.candidate.proposal } : null,
      // The engine-owned extreme result is private until the dedicated finale
      // projection verifies a committed terminal receipt. Never expose it here.
      confirmation: state.finale.confirmation ? Object.fromEntries(
        ["candidateId", "proposalRevision", "proposalSegmentIds", "revision", "sourceSegmentIds"]
          .filter((key) => Object.hasOwn(state.finale.confirmation, key)).map((key) => [key, state.finale.confirmation[key]])) : null,
    } } : {}),
  };
}

module.exports = { validateInitialState, applyTurnBundle, projectPlayerState };
