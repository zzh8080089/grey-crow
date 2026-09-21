"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const COMPACTION_QUOTE_FORMAT = "source-quotes-2";
// A count ceiling bounds selection work; the independent serialized-text and
// request budgets can require a smaller selection even below this ceiling.
const COMPACTION_QUOTE_MAX_ITEMS = 128;
const QUOTE_CHARACTERS = 1200;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

function fail() { throw Object.assign(new Error("COMPACTION_VALIDATION_FAILED"), { code: "COMPACTION_VALIDATION_FAILED" }); }
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== names.length) fail();
  const copy = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) fail();
    copy[name] = field.value;
  }
  return copy;
}
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function sourceKind(value, fallback) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const field = Object.getOwnPropertyDescriptor(value, "kind");
  if (field && (!field.enumerable || !Object.hasOwn(field, "value"))) fail();
  const kind = field ? field.value : fallback;
  if (!["narration", "player_input"].includes(kind)) fail();
  return kind;
}
function sourceData(value) {
  const kind = sourceKind(value);
  const source = fields(value, ["adventureId", "revision", "kind", ...(kind === "narration" ? ["segmentId"] : [])]);
  if (typeof source.adventureId !== "string" || !ID.test(source.adventureId)
    || !integer(source.revision, 1) || (kind === "narration" && (typeof source.segmentId !== "string" || !ID.test(source.segmentId)))) fail();
  return source;
}
function quoteId(source, range, text) {
  return "quote-" + createHash("sha256").update(JSON.stringify({ source, range, text })).digest("hex");
}
function quoteData(value) {
  const quote = fields(value, ["quoteId", "text", "source", "range"]);
  const source = sourceData(quote.source);
  const range = fields(quote.range, ["start", "end", "totalCharacters"]);
  if (!integer(range.start) || !integer(range.end, 1) || !integer(range.totalCharacters, 1)
    || range.start >= range.end || range.end > range.totalCharacters || range.totalCharacters > 200_000
    || typeof quote.text !== "string" || !quote.text.length || quote.text.length > QUOTE_CHARACTERS
    || quote.text.length !== range.end - range.start
    || quote.quoteId !== quoteId(source, range, quote.text)) fail();
  return { quoteId: quote.quoteId, text: quote.text, source, range };
}

// Offsets use UTF-16, matching String.slice and the stored narration. Selection
// preserves all whitespace and punctuation; it never claims a long-source
// window contains qualifications or context outside its declared range.
function createCompactionQuotes(value) {
  const kind = sourceKind(value, "narration");
  const input = fields(value, ["adventureId", "revision", ...(Object.hasOwn(value, "kind") ? ["kind"] : []),
    ...(kind === "narration" ? ["segmentId"] : []), "text"]);
  const source = sourceData({ adventureId: input.adventureId, revision: input.revision, kind,
    ...(kind === "narration" ? { segmentId: input.segmentId } : {}) });
  const text = input.text;
  if (typeof text !== "string" || !text.length || text.length > 200_000) fail();
  const result = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + QUOTE_CHARACTERS, text.length);
    if (end < text.length) {
      if (/[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
      // Fixed punctuation rules keep IDs independent of host locale, ICU
      // version, model settings and request chunk sizes. Prefer a late sentence
      // or line ending, without producing a tiny quote from an early stop.
      const boundary = /(?:[。！？]["'”’」』）)\]]*|[.!?]["'”’」』）)\]]*(?=\s|$)|\r?\n)/gu;
      const window = text.slice(start, end);
      let match, last = 0;
      while ((match = boundary.exec(window))) last = match.index + match[0].length;
      if (last >= QUOTE_CHARACTERS / 2) end = start + last;
    }
    const range = { start, end, totalCharacters: text.length };
    const passage = text.slice(start, end);
    result.push({ quoteId: quoteId(source, range, passage), text: passage, source: { ...source }, range });
    start = end;
  }
  return result;
}

function validateCompactionQuotes(value, allowedQuotes) {
  const candidate = fields(value, ["format", "items"]);
  if (candidate.format !== COMPACTION_QUOTE_FORMAT || !Array.isArray(candidate.items)
    || Object.getPrototypeOf(candidate.items) !== Array.prototype || !candidate.items.length || candidate.items.length > COMPACTION_QUOTE_MAX_ITEMS
    || Reflect.ownKeys(candidate.items).length !== candidate.items.length + 1
    || (allowedQuotes !== undefined && !(allowedQuotes instanceof Map))) fail();
  const seen = new Set();
  const items = [];
  for (let index = 0; index < candidate.items.length; index++) {
    const field = Object.getOwnPropertyDescriptor(candidate.items, String(index));
    if (!field?.enumerable || !Object.hasOwn(field, "value")) fail();
    const quote = quoteData(field.value);
    if (seen.has(quote.quoteId)) fail();
    seen.add(quote.quoteId);
    if (allowedQuotes !== undefined) {
      const allowed = Map.prototype.get.call(allowedQuotes, quote.quoteId);
      if (!allowed || !isDeepStrictEqual(quote, quoteData(allowed))) fail();
    }
    items.push(quote);
  }
  const result = { format: COMPACTION_QUOTE_FORMAT, items };
  if (JSON.stringify(result).length > 64000) fail();
  return result;
}

module.exports = { COMPACTION_QUOTE_FORMAT, COMPACTION_QUOTE_MAX_ITEMS, createCompactionQuotes, validateCompactionQuotes };
