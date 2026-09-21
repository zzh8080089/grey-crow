"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { COMPACTION_QUOTE_FORMAT, COMPACTION_QUOTE_MAX_ITEMS, createCompactionQuotes, validateCompactionQuotes } = require("./session-compaction-quotes");

const source = (text, segmentId = "speech") => ({ adventureId: "ancestor", revision: 9, segmentId, text });
const value = (items) => ({ format: COMPACTION_QUOTE_FORMAT, items });
const rehash = (quote) => { quote.quoteId = "quote-" + createHash("sha256")
  .update(JSON.stringify({ source: quote.source, range: quote.range, text: quote.text })).digest("hex"); return quote; };

test("short Chinese, English and Japanese passages keep their complete original qualifications and whitespace", () => {
  for (const text of ["  她说：大前天……下午？我记不准。\n", "She paused: three days ago… afternoon? I am not sure.\n",
    "彼女は考えた。「三日前……午後？　よく覚えていない。」\r\n", "x".repeat(1200)]) {
    const input = source(text), before = structuredClone(input);
    const quotes = createCompactionQuotes(input);
    assert.equal(quotes.length, 1); assert.equal(quotes[0].text, text);
    assert.deepEqual(quotes[0].range, { start: 0, end: text.length, totalCharacters: text.length });
    assert.deepEqual(quotes[0].source, { adventureId: "ancestor", revision: 9, kind: "narration", segmentId: "speech" });
    assert.deepEqual(quotes, createCompactionQuotes({ text, segmentId: "speech", revision: 9, adventureId: "ancestor" }));
    assert.deepEqual(input, before);
    const normalized = validateCompactionQuotes(value(quotes), new Map(quotes.map((quote) => [quote.quoteId, quote])));
    normalized.items[0].source.adventureId = "changed";
    assert.equal(quotes[0].source.adventureId, "ancestor");
  }
});

test("player input and narration have distinct immutable source kinds without inventing a narration segment for the input", () => {
  const text = "我是食堂的小沈。我不开门，只试着问一声。";
  const input = { adventureId: "ancestor", revision: 6, kind: "player_input", text };
  const before = structuredClone(input);
  const player = createCompactionQuotes(input)[0];
  const narrated = createCompactionQuotes({ adventureId: "ancestor", revision: 6, segmentId: "front", text })[0];
  assert.deepEqual(player.source, { adventureId: "ancestor", revision: 6, kind: "player_input" });
  assert.equal(player.text, text); assert.notEqual(player.quoteId, narrated.quoteId);
  assert.deepEqual(createCompactionQuotes({ adventureId: "ancestor", revision: 6, kind: "narration", segmentId: "front", text }), [narrated]);
  const allowed = new Map([player, narrated].map((quote) => [quote.quoteId, quote]));
  assert.deepEqual(validateCompactionQuotes(value([player, narrated]), allowed).items, [player, narrated]);
  assert.deepEqual(input, before);
  for (const invalid of [
    { ...input, segmentId: "invented" }, { adventureId: "ancestor", revision: 6, kind: "narration", text },
    { adventureId: "ancestor", revision: 6, text }, { ...input, kind: "assistant" }, { ...input, kind: "event" },
  ]) assert.throws(() => createCompactionQuotes(invalid), { code: "COMPACTION_VALIDATION_FAILED" });
  for (const change of [
    (quote) => { quote.source.segmentId = "invented"; }, (quote) => { delete quote.source.kind; },
    (quote) => { quote.source.kind = "narration"; }, (quote) => { quote.source.kind = "assistant"; },
  ]) {
    const invalid = structuredClone(player); change(invalid); rehash(invalid);
    assert.throws(() => validateCompactionQuotes(value([invalid])), { code: "COMPACTION_VALIDATION_FAILED" });
  }
  assert.throws(() => validateCompactionQuotes({ format: "source-quotes-1", items: [narrated] }), { code: "COMPACTION_VALIDATION_FAILED" });
});

test("long passages have deterministic gapless windows with late sentence or line endings and intact surrogate pairs", () => {
  const examples = [
    "a".repeat(650) + ". " + "b".repeat(700),
    "中".repeat(700) + "。随后".repeat(300),
    "語".repeat(700) + "\r\n" + "次".repeat(800),
    "x".repeat(1199) + "😀" + "y".repeat(2000),
    "全文\n😀".repeat(30_000).slice(0, 200_000),
    " ".repeat(1300) + "the end",
  ];
  for (const text of examples) {
    const quotes = createCompactionQuotes(source(text));
    assert.equal(quotes.map((quote) => quote.text).join(""), text);
    let offset = 0;
    for (const quote of quotes) {
      assert.equal(quote.range.start, offset);
      assert.equal(quote.range.end - quote.range.start, quote.text.length);
      assert.equal(quote.range.totalCharacters, text.length);
      assert.ok(quote.text.length > 0 && quote.text.length <= 1200);
      const end = quote.range.end;
      assert.equal(end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end]), false);
      offset = end;
    }
    assert.equal(offset, text.length);
    assert.equal(new Set(quotes.map((quote) => quote.quoteId)).size, quotes.length);
    assert.deepEqual(createCompactionQuotes(source(text)), quotes);
  }
  assert.equal(createCompactionQuotes(source(examples[0]))[0].range.end, 651);
  assert.equal(createCompactionQuotes(source(examples[2]))[0].range.end, 702);
  assert.equal(createCompactionQuotes(source(examples[3]))[0].range.end, 1199);
});

test("selection validation rejects rewritten text, wrong identity, duplicate IDs and arbitrary windows against the supplied quote map", () => {
  const originals = createCompactionQuotes(source("她说：下午？也可能是早上，我拿不准。"));
  const allowed = new Map(originals.map((quote) => [quote.quoteId, quote]));
  const changes = [
    (quote) => { quote.text = "她说：下午。"; },
    (quote) => { quote.source.adventureId = "stranger"; },
    (quote) => { quote.range.totalCharacters++; },
    (quote) => { quote.range.start = -1; },
    (quote) => { quote.range.end = quote.range.totalCharacters + 1; },
    (quote) => { quote.source.experienceId = "private"; },
    (quote) => { quote.extra = true; },
  ];
  for (const change of changes) {
    const quote = structuredClone(originals[0]); change(quote);
    assert.throws(() => validateCompactionQuotes(value([quote]), allowed), { code: "COMPACTION_VALIDATION_FAILED" });
  }
  const window = structuredClone(originals[0]); window.text = window.text.slice(0, 5); window.range.end = 5; rehash(window);
  assert.equal(validateCompactionQuotes(value([window])).items[0].text, window.text, "shape and hash alone cannot prove it was offered");
  assert.throws(() => validateCompactionQuotes(value([window]), allowed), { code: "COMPACTION_VALIDATION_FAILED" });
  assert.throws(() => validateCompactionQuotes(value([originals[0], originals[0]])), { code: "COMPACTION_VALIDATION_FAILED" });
});

test("strict source and candidate validation never invokes accessors or coercion, and enforces all bounds", () => {
  const quote = createCompactionQuotes(source("原话"))[0];
  for (const candidate of [value([]), { items: [quote] },
    { ...value([quote]), extra: true }, { format: "source-quotes-0", items: [quote] },
    value(Object.assign([quote], { extra: true })), value(new Array(1)), value([Object.create(quote)])]) {
    assert.throws(() => validateCompactionQuotes(candidate), { code: "COMPACTION_VALIDATION_FAILED" });
  }
  let calls = 0;
  const accessor = { ...quote };
  Object.defineProperty(accessor, "text", { enumerable: true, get() { calls++; throw new Error("must not run"); } });
  assert.throws(() => validateCompactionQuotes(value([accessor])), { code: "COMPACTION_VALIDATION_FAILED" });
  const coercion = { toString() { calls++; return "ancestor"; } };
  assert.throws(() => createCompactionQuotes({ ...source("原话"), adventureId: coercion }), { code: "COMPACTION_VALIDATION_FAILED" });
  assert.equal(calls, 0);
  for (const text of ["", "x".repeat(200001), null]) assert.throws(() => createCompactionQuotes(source(text)), { code: "COMPACTION_VALIDATION_FAILED" });
  const escaped = Array.from({ length: 32 }, (_, index) => createCompactionQuotes(source("\u0000".repeat(1200), `s-${index}`))[0]);
  assert.throws(() => validateCompactionQuotes(value(escaped)), { code: "COMPACTION_VALIDATION_FAILED" });
});

test("the shared count ceiling allows 128 short original quotes but keeps the compiled JSON limit independent", () => {
  const quotes = Array.from({ length: COMPACTION_QUOTE_MAX_ITEMS + 1 }, (_, index) => createCompactionQuotes(source("还没有确认。", `s-${index}`))[0]);
  const selected = quotes.slice(0, COMPACTION_QUOTE_MAX_ITEMS);
  assert.equal(COMPACTION_QUOTE_MAX_ITEMS, 128);
  assert.equal(JSON.stringify({ selectedQuoteIds: selected.map(quote => quote.quoteId) }).length, 9366);
  assert.deepEqual(validateCompactionQuotes(value(selected)).items, selected);
  assert.throws(() => validateCompactionQuotes(value(quotes)), { code: "COMPACTION_VALIDATION_FAILED" });
  const long = selected.map((_, index) => createCompactionQuotes(source("字".repeat(1200), `s-${index}`))[0]);
  assert.ok(JSON.stringify(value(long)).length > 64000);
  assert.throws(() => validateCompactionQuotes(value(long)), { code: "COMPACTION_VALIDATION_FAILED" });
});
