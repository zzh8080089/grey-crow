"use strict";

const { createHash } = require("node:crypto");
const { normalizeContextWindowPolicy } = require("../runtime/context-window-policy");

const MAX_CONTEXT_BYTES = 8_000_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const TARGETS = { short: 200, standard: 300, detailed: 400 };
const ADAPTIVE_NARRATION_GUIDE = Object.freeze({
  measurement: "visible_unicode_characters",
  zhCN: Object.freeze({ ordinarySoftUpperCharacters: 600, consequentialSoftUpperCharacters: 800 }),
  otherLocales: "Use a comparable natural reading scope in the adventure locale; do not mechanically match Chinese character counts.",
});

function fail(code = "CONTEXT_OPTIONS_INVALID") { throw Object.assign(new Error(code), { code }); }
function fields(value, allowed, required = [], code = "CONTEXT_OPTIONS_INVALID") {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  if (required.some((key) => !Object.hasOwn(value, key))) fail(code);
  for (const key of Reflect.ownKeys(value)) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !item?.enumerable || !Object.hasOwn(item, "value")) fail(code);
  }
}
function positive(value, max) { return Number.isSafeInteger(value) && value > 0 && value <= max; }
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function normalizeNarrationPreferences(value = {}) {
  fields(value, ["lengthPreset", "customTargetChars"]);
  const lengthPreset = value.lengthPreset === undefined ? "standard" : value.lengthPreset;
  if (!["short", "standard", "detailed", "adaptive", "custom"].includes(lengthPreset)) fail();
  const customTargetChars = value.customTargetChars ?? null;
  if (customTargetChars !== null && (!Number.isSafeInteger(customTargetChars) || customTargetChars < 120 || customTargetChars > 800)) fail();
  if (lengthPreset === "custom" && customTargetChars === null) fail();
  return freeze({ lengthPreset, customTargetChars: lengthPreset === "custom" ? customTargetChars : null });
}

function normalizeSessionContextPolicy(value = {}) {
  fields(value, ["configuredContextWindow", "providerContextLimit", "autoCompactRatio"]);
  if ((value.configuredContextWindow !== undefined && !positive(value.configuredContextWindow, 4_000_000))
    || (value.providerContextLimit != null && !positive(value.providerContextLimit, 4_000_000))
    || (value.autoCompactRatio !== undefined && (!Number.isFinite(value.autoCompactRatio) || value.autoCompactRatio < 0.5 || value.autoCompactRatio > 0.85))) fail();
  return freeze({ configuredContextWindow: value.configuredContextWindow ?? 256_000,
    providerContextLimit: value.providerContextLimit ?? null, autoCompactRatio: value.autoCompactRatio ?? 0.75 });
}

function normalizeSessionContextOptions(options = {}) {
  fields(options, ["narrationPreferences", "contextPolicy", "maxContextCharacters", "maxOutputTokens"]);
  const narrationPreferences = normalizeNarrationPreferences(options.narrationPreferences);
  const configured = normalizeSessionContextPolicy(options.contextPolicy);
  const maxOutputTokens = options.maxOutputTokens === undefined ? 4096 : options.maxOutputTokens;
  if (!positive(maxOutputTokens, 32768)) fail();
  const policy = normalizeContextWindowPolicy({ ...configured, maxOutputTokens });
  const maxContextCharacters = options.maxContextCharacters === undefined ? (options.contextPolicy === undefined
    ? 48_000 : Math.min(4_000_000, policy.effectiveContextWindow * 4)) : options.maxContextCharacters;
  if (!positive(maxContextCharacters, 10_000_000)) fail();
  const normalized = { narrationPreferences, policy, maxContextCharacters, maxContextBytes: MAX_CONTEXT_BYTES };
  const settingsIdentity = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return freeze({ ...normalized, settingsIdentity });
}

function narrationPreferenceMessage(settings) {
  const preference = settings.narrationPreferences;
  if (preference.lengthPreset === "adaptive") {
    return "PLAYER NARRATION PREFERENCE: " + JSON.stringify({ lengthPreset: "adaptive", adaptiveGuide: ADAPTIVE_NARRATION_GUIDE,
      scope: "player_narration_only" })
      + ". In the fixed adventure locale, choose a natural visible narration length from the scene's established complexity and consequence, never from the player's input length. Simple acknowledgements or low-stakes exchanges may be very brief. For complex or consequential actions, give enough immediate, observable consequence to make the situation clear, then stop before choosing the player's next action. The Chinese guide is normally up to 600 visible characters and up to 800 only when the action is consequential; both are soft upper guides, never minimums or hard cutoffs. Do not invent events, add a planning call, use numerical adjudication, truncate a formal bundle, omit required state changes, or alter facts merely to meet this preference.";
  }
  const targetCharacters = preference.lengthPreset === "custom" ? preference.customTargetChars : TARGETS[preference.lengthPreset];
  return "PLAYER NARRATION PREFERENCE: " + JSON.stringify({ lengthPreset: preference.lengthPreset,
    targetCharacters, unit: "characters", scope: "player_narration_only" })
    + ". In the fixed adventure locale, aim for approximately this many visible Unicode characters across narration paragraphs. This is a soft prose preference, not a limit on JSON, events or experiences. Prioritize coherent consequences and complete sentences. Never truncate the bundle, omit required state changes, or alter facts to satisfy a length target.";
}

function serializePayload(value) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 1_000_000 || depth > 64) fail("CONTEXT_INPUT_INVALID");
    if (item === null || ["string", "boolean"].includes(typeof item) || (typeof item === "number" && Number.isFinite(item))) return;
    if (!item || typeof item !== "object" || ancestors.has(item)
      || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) fail("CONTEXT_INPUT_INVALID");
    ancestors.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === "length") continue;
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || !field?.enumerable || !Object.hasOwn(field, "value")) fail("CONTEXT_INPUT_INVALID");
      visit(field.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail("CONTEXT_INPUT_INVALID");
    ancestors.delete(item);
  }
  visit(value, 0);
  return JSON.stringify(value);
}

// These are estimates of the complete normalized request, not tokenizer counts
// or Provider usage. UTF-8 bytes supply a deliberately conservative guard; the
// protocol margin separately reserves room for the Provider's wire framing.
function countContextText(text) {
  if (typeof text !== "string") fail("CONTEXT_INPUT_INVALID");
  let ascii = 0, other = 0;
  for (const character of text) { if (character.codePointAt(0) <= 127) ascii++; else other++; }
  return { ascii, other, characters: text.length, bytes: Buffer.byteLength(text, "utf8") };
}
function countSessionContext({ messages, tools = [], responseFormat = { type: "json_object" } }) {
  return countContextText(serializePayload({ messages, tools, responseFormat }));
}
function estimateSessionContextFromCounts({ counts, settings, identity, scope = "next_request", includesPlayerInput = false, callIndex = 0 }) {
  if (!identity || (identity.adventureId !== null && !ID.test(identity.adventureId || ""))
    || !Number.isSafeInteger(identity.revision) || identity.revision < 0
    || (identity.actionId !== null && !ID.test(identity.actionId || ""))
    || !["next_request", "invocation"].includes(scope) || !Number.isSafeInteger(callIndex) || callIndex < 0) fail("CONTEXT_INPUT_INVALID");
  fields(counts, ["ascii", "other", "characters", "bytes"], ["ascii", "other", "characters", "bytes"], "CONTEXT_INPUT_INVALID");
  if (Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)
    || counts.characters < counts.ascii + counts.other || counts.characters > counts.ascii + 2 * counts.other
    || counts.bytes < counts.characters || counts.bytes > counts.ascii + 4 * counts.other) fail("CONTEXT_INPUT_INVALID");
  const inputTokens = Math.ceil(counts.ascii / 4) + counts.other;
  const bytes = counts.bytes;
  const safetyInputTokens = bytes;
  const { policy } = settings;
  const limitingReason = counts.characters > settings.maxContextCharacters ? "CONTEXT_CHARACTER_LIMIT"
    : bytes > settings.maxContextBytes ? "CONTEXT_BYTE_LIMIT"
      : safetyInputTokens + policy.maxOutputTokens + policy.protocolSafetyMargin > policy.effectiveContextWindow
        || safetyInputTokens > policy.hardInputLimit ? "CONTEXT_TOKEN_LIMIT"
        : safetyInputTokens >= policy.emergencyLimit ? "CONTEXT_EMERGENCY_LIMIT" : null;
  return { ...identity, settingsIdentity: settings.settingsIdentity, scope, compactionAvailable: false,
    estimateMethod: "unicode_heuristic_utf8_safety_v1", includesPlayerInput,
    latestEstimate: { inputTokens, safetyInputTokens, characters: counts.characters, bytes, callIndex },
    latestActual: null, peak: { estimatedInputTokens: inputTokens, safetyInputTokens, actualInputTokens: null },
    policy: { ...policy }, limits: { maxContextCharacters: settings.maxContextCharacters, maxContextBytes: settings.maxContextBytes },
    fits: limitingReason === null, limitingReason };
}

function estimateSessionContext(options) {
  return estimateSessionContextFromCounts({ ...options, counts: countSessionContext(options) });
}

module.exports = { normalizeNarrationPreferences, normalizeSessionContextPolicy, normalizeSessionContextOptions,
  narrationPreferenceMessage, estimateSessionContext, countContextText, countSessionContext, estimateSessionContextFromCounts, MAX_CONTEXT_BYTES };
