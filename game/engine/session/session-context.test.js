"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNarrationPreferences, normalizeSessionContextPolicy, normalizeSessionContextOptions,
  narrationPreferenceMessage, estimateSessionContext, countContextText, countSessionContext, estimateSessionContextFromCounts, MAX_CONTEXT_BYTES } = require("./session-context");

const identity = { adventureId: "adventure", revision: 12, actionId: "action" };
function estimate(text, settings, extra = {}) {
  return estimateSessionContext({ messages: [{ role: "user", content: text }], settings, identity,
    scope: "invocation", includesPlayerInput: true, ...extra });
}

test("normalized settings are immutable and the identity reflects effective preferences and independent limits", () => {
  const preference = { lengthPreset: "custom", customTargetChars: 520 };
  const policy = { configuredContextWindow: 128000, providerContextLimit: 64000, autoCompactRatio: 0.65 };
  const first = normalizeSessionContextOptions({ narrationPreferences: preference, contextPolicy: policy });
  const same = normalizeSessionContextOptions({ contextPolicy: { ...policy }, narrationPreferences: { ...preference } });
  assert.equal(first.settingsIdentity, same.settingsIdentity);
  assert.equal(first.settingsIdentity.length, 64);
  assert.equal(first.policy.effectiveContextWindow, 64000);
  assert.equal(first.maxContextCharacters, 256000);
  preference.customTargetChars = 800; policy.configuredContextWindow = 1000000;
  assert.equal(first.narrationPreferences.customTargetChars, 520);
  assert.equal(first.policy.configuredContextWindow, 128000);
  assert.ok(Object.isFrozen(first.policy));
  for (const options of [{ narrationPreferences: { lengthPreset: "short" } }, { maxOutputTokens: 8192 },
    { maxContextCharacters: 10000 }, { contextPolicy: { autoCompactRatio: 0.5 } }]) {
    assert.notEqual(normalizeSessionContextOptions(options).settingsIdentity, normalizeSessionContextOptions().settingsIdentity);
  }
  assert.equal(normalizeSessionContextOptions().maxContextCharacters, 48000, "direct core default remains bounded");
});

test("narration settings preserve three-locale character targets without limiting facts or JSON", () => {
  for (const [lengthPreset, target] of [["short", 200], ["standard", 300], ["detailed", 400], ["custom", 800]]) {
    const settings = normalizeSessionContextOptions({ narrationPreferences: { lengthPreset, ...(lengthPreset === "custom" ? { customTargetChars: target } : {}) } });
    const text = narrationPreferenceMessage(settings);
    assert.match(text, new RegExp(`"targetCharacters":${target}`));
    assert.match(text, /fixed adventure locale/);
    assert.match(text, /not a limit on JSON, events or experiences/);
    assert.doesNotMatch(text, /Chinese characters|中文字符/);
  }
  assert.deepEqual(normalizeNarrationPreferences({ lengthPreset: "standard", customTargetChars: 400 }), { lengthPreset: "standard", customTargetChars: null });
});

test("adaptive narration uses scene consequence, not player input length or a hard prose cutoff", () => {
  const settings = normalizeSessionContextOptions({ narrationPreferences: { lengthPreset: "adaptive" } });
  const text = narrationPreferenceMessage(settings);
  assert.match(text, /"lengthPreset":"adaptive"/);
  assert.match(text, /"ordinarySoftUpperCharacters":600/);
  assert.match(text, /"consequentialSoftUpperCharacters":800/);
  assert.match(text, /never from the player's input length/);
  assert.match(text, /never minimums or hard cutoffs/);
  assert.match(text, /stop before choosing the player's next action/);
  assert.match(text, /Do not invent events, add a planning call, use numerical adjudication/);
  assert.doesNotMatch(text, /targetCharacters/);
  assert.deepEqual(normalizeNarrationPreferences({ lengthPreset: "adaptive", customTargetChars: 400 }),
    { lengthPreset: "adaptive", customTargetChars: null });
  assert.notEqual(settings.settingsIdentity, normalizeSessionContextOptions().settingsIdentity);
});

test("existing fixed narration presets retain their established prompt prefix", () => {
  const settings = normalizeSessionContextOptions({ narrationPreferences: { lengthPreset: "standard" } });
  assert.equal(narrationPreferenceMessage(settings), "PLAYER NARRATION PREFERENCE: "
    + JSON.stringify({ lengthPreset: "standard", targetCharacters: 300, unit: "characters", scope: "player_narration_only" })
    + ". In the fixed adventure locale, aim for approximately this many visible Unicode characters across narration paragraphs. This is a soft prose preference, not a limit on JSON, events or experiences. Prioritize coherent consequences and complete sentences. Never truncate the bundle, omit required state changes, or alter facts to satisfy a length target.");
});

test("unrecognized options and accessor properties are rejected without executing getters", () => {
  let reads = 0;
  const hostile = {}; Object.defineProperty(hostile, "configuredContextWindow", { enumerable: true, get() { reads++; return 64000; } });
  for (const value of [hostile, { maxOutputTokens: 100 }, { autoCompactRatio: 0.9 }, { providerContextLimit: -1 }]) {
    assert.throws(() => normalizeSessionContextPolicy(value), { code: "CONTEXT_OPTIONS_INVALID" });
  }
  for (const value of [{ lengthPreset: "custom", customTargetChars: 119 }, { lengthPreset: "custom", customTargetChars: 801 },
    { lengthPreset: "custom" }, { lengthPreset: null }, { lengthPreset: "unexpected" }]) {
    assert.throws(() => normalizeNarrationPreferences(value), { code: "CONTEXT_OPTIONS_INVALID" });
  }
  assert.throws(() => normalizeSessionContextOptions({ maxContextCharacters: null }), { code: "CONTEXT_OPTIONS_INVALID" });
  assert.equal(reads, 0);
});

test("all messages, tool schemas and response format contribute; estimates never masquerade as actual usage", () => {
  const settings = normalizeSessionContextOptions();
  const plain = estimate("English 中文 日本語 😀", settings);
  const rich = estimate("English 中文 日本語 😀", settings, { tools: [{ name: "read_entity", description: "x".repeat(1000) }], responseFormat: { type: "json_object", schema: { description: "y".repeat(1000) } } });
  assert.ok(rich.latestEstimate.inputTokens > plain.latestEstimate.inputTokens);
  assert.ok(plain.latestEstimate.bytes > plain.latestEstimate.characters);
  assert.equal(plain.latestEstimate.safetyInputTokens, plain.latestEstimate.bytes);
  assert.equal(plain.latestActual, null);
  assert.equal(plain.peak.actualInputTokens, null);
  assert.equal(plain.compactionAvailable, false);
  assert.match(plain.estimateMethod, /heuristic/);
  assert.doesNotMatch(JSON.stringify(plain), /read_entity|English|日本語/);
});

test("output and protocol reserves, emergency guard and independent character/byte caps are enforced", () => {
  const small = normalizeSessionContextOptions({ contextPolicy: { configuredContextWindow: 4000 }, maxOutputTokens: 512 });
  assert.equal(estimate("a".repeat(3000), small).limitingReason, "CONTEXT_TOKEN_LIMIT");
  const emergency = normalizeSessionContextOptions({ contextPolicy: { configuredContextWindow: 20000, autoCompactRatio: 0.5 }, maxOutputTokens: 256 });
  assert.equal(estimate("a".repeat(11000), emergency).fits, true, "an unavailable automatic compactor must not reject the soft threshold");
  assert.equal(estimate("a".repeat(18000), emergency).limitingReason, "CONTEXT_EMERGENCY_LIMIT");
  assert.equal(estimate("a".repeat(1000), normalizeSessionContextOptions({ maxContextCharacters: 100 })).limitingReason, "CONTEXT_CHARACTER_LIMIT");
  assert.equal(estimate("a".repeat(MAX_CONTEXT_BYTES), normalizeSessionContextOptions({ maxContextCharacters: 10000000,
    contextPolicy: { configuredContextWindow: 4000000 } })).limitingReason, "CONTEXT_BYTE_LIMIT");
});

test("context estimation rejects unsafe payloads before evaluating accessors", () => {
  let reads = 0;
  const message = { role: "user" }; Object.defineProperty(message, "content", { enumerable: true, get() { reads++; return "secret"; } });
  assert.throws(() => estimateSessionContext({ messages: [message], identity, settings: normalizeSessionContextOptions() }), { code: "CONTEXT_INPUT_INVALID" });
  assert.equal(reads, 0);
  const circular = {}; circular.self = circular;
  assert.throws(() => estimateSessionContext({ messages: [circular], identity, settings: normalizeSessionContextOptions() }), { code: "CONTEXT_INPUT_INVALID" });
});

test("incremental wire counts equal complete request serialization across escapes and Unicode", () => {
  const settings = normalizeSessionContextOptions();
  const messages = [{ role: "system", content: "固定上下文" }, { role: "user", content: "前缀\n" + JSON.stringify({ turns: [] }) }];
  const tools = [{ type: "function", function: { name: "read", description: "按需工具 😀" } }];
  const entries = ['quoted "text"\\\n\t', "中文 日本語 😀", "\u0000\r\b", "unpaired \ud800", "é e\u0301"];
  const full = structuredClone(messages);
  full[1].content = "前缀\n" + JSON.stringify({ turns: entries });
  const counts = countSessionContext({ messages, tools });
  entries.forEach((entry, index) => {
    const part = countContextText(JSON.stringify(JSON.stringify(entry)).slice(1, -1) + (index ? "," : ""));
    for (const key of Object.keys(counts)) counts[key] += part[key];
  });
  assert.deepEqual(counts, countSessionContext({ messages: full, tools }));
  assert.deepEqual(estimateSessionContextFromCounts({ counts, settings, identity }),
    estimateSessionContext({ messages: full, tools, settings, identity }));
});
