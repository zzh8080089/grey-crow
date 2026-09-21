"use strict";

const crypto = require("node:crypto");

const UTTERANCE_PLAN_VERSION = 2;
const MAX_UTTERANCE_GRAPHEMES = 8000;
const LEAD_ONE_POLICY = Object.freeze({ min: 30, target: 50, hardMax: 70 });
const LEAD_TWO_POLICY = Object.freeze({ min: 40, target: 80, hardMax: 90 });
const TAIL_BLOCK_POLICY = Object.freeze({ min: 40, target: 80, hardMax: 90 });
const STRONG_BOUNDARY_PATTERN = /[\n\r。！？!?…]/u;
const WEAK_BOUNDARY_PATTERN = /[；;：:，,、]/u;

class TtsUtterancePlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TtsUtterancePlanError";
    this.code = code;
  }
}

function planTtsUtterance(text, { locale = "zh-CN" } = {}) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TtsUtterancePlanError("INVALID_TTS_INPUT", "没有可朗读文本。");
  }

  const graphemes = segmentGraphemes(text, locale);
  if (graphemes.length > MAX_UTTERANCE_GRAPHEMES) {
    throw new TtsUtterancePlanError(
      "TTS_TEXT_TOO_LONG",
      `朗读正文不能超过 ${MAX_UTTERANCE_GRAPHEMES} 个字符。`
    );
  }

  const segments = [];
  let cursor = 0;
  const leadOneEnd = chooseEnd(graphemes, cursor, LEAD_ONE_POLICY);
  segments.push(createSegment("lead-1", segments.length, text, graphemes, cursor, leadOneEnd));
  cursor = leadOneEnd;

  if (cursor < graphemes.length) {
    const leadTwoEnd = chooseEnd(graphemes, cursor, LEAD_TWO_POLICY);
    segments.push(createSegment("lead-2", segments.length, text, graphemes, cursor, leadTwoEnd));
    cursor = leadTwoEnd;
  }

  if (cursor < graphemes.length) {
    const tail = createSegment("tail", segments.length, text, graphemes, cursor, graphemes.length);
    tail.blocks = createTailBlocks(text, graphemes, cursor, graphemes.length);
    segments.push(tail);
  }

  const plan = {
    version: UTTERANCE_PLAN_VERSION,
    locale,
    sourceText: text,
    sourceHash: hashText(text),
    graphemeCount: graphemes.length,
    segments,
  };
  assertTtsUtteranceCoverage(plan);
  return deepFreeze(plan);
}

function countGraphemes(text, locale = "zh-CN") {
  if (typeof text !== "string") {
    return 0;
  }
  return segmentGraphemes(text, locale).length;
}

function createTailBlocks(text, graphemes, start, end) {
  const blocks = [];
  let cursor = start;
  while (cursor < end) {
    const blockEnd = chooseEnd(graphemes, cursor, TAIL_BLOCK_POLICY, end);
    blocks.push(createSegment("tail-block", blocks.length, text, graphemes, cursor, blockEnd));
    cursor = blockEnd;
  }
  return blocks;
}

function chooseEnd(graphemes, start, policy, limit = graphemes.length) {
  const remaining = limit - start;
  if (remaining <= policy.hardMax) {
    return limit;
  }

  const minimum = Math.min(limit, start + policy.min);
  const target = Math.min(limit, start + policy.target);
  const hardMax = Math.min(limit, start + policy.hardMax);
  return findBoundary(graphemes, minimum, target, hardMax, STRONG_BOUNDARY_PATTERN) ||
    findBoundary(graphemes, minimum, target, hardMax, WEAK_BOUNDARY_PATTERN) ||
    target;
}

function findBoundary(graphemes, minimum, target, hardMax, pattern) {
  for (let end = target; end >= minimum; end -= 1) {
    if (pattern.test(graphemes[end - 1].segment)) {
      return end;
    }
  }
  for (let end = target + 1; end <= hardMax; end += 1) {
    if (pattern.test(graphemes[end - 1].segment)) {
      return end;
    }
  }
  return 0;
}

function createSegment(kind, index, text, graphemes, start, end) {
  const startOffset = graphemeOffset(graphemes, start, text.length);
  const endOffset = graphemeOffset(graphemes, end, text.length);
  const segmentText = text.slice(startOffset, endOffset);
  return {
    id: kind === "tail-block" ? `tail-${index + 1}` : kind,
    kind,
    index,
    startOffset,
    endOffset,
    graphemeCount: end - start,
    text: segmentText,
    textHash: hashText(segmentText),
  };
}

function graphemeOffset(graphemes, index, textLength) {
  return index >= graphemes.length ? textLength : graphemes[index].index;
}

function segmentGraphemes(text, locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), ({ segment, index }) => ({ segment, index }));
}

function assertTtsUtteranceCoverage(plan) {
  if (!plan || typeof plan.sourceText !== "string" || !Array.isArray(plan.segments) || !plan.segments.length) {
    throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", "朗读分段缺少完整正文或段落。");
  }
  if (plan.sourceHash !== hashText(plan.sourceText) || plan.graphemeCount !== countGraphemes(plan.sourceText, plan.locale)) {
    throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", "朗读正文哈希或字符数量不一致。");
  }

  assertContinuousCoverage(plan.sourceText, plan.segments, "朗读分段");
  const tail = plan.segments.find((segment) => segment.kind === "tail");
  if (tail) {
    if (!Array.isArray(tail.blocks) || !tail.blocks.length) {
      throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", "朗读 Tail 缺少内部安全块。");
    }
    assertContinuousCoverage(tail.text, tail.blocks.map((block) => ({
      ...block,
      startOffset: block.startOffset - tail.startOffset,
      endOffset: block.endOffset - tail.startOffset,
    })), "朗读 Tail");
    if (tail.blocks.some((block) => block.graphemeCount > TAIL_BLOCK_POLICY.hardMax)) {
      throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", "朗读 Tail 内部安全块超过上限。");
    }
  }
  return true;
}

function assertContinuousCoverage(sourceText, segments, label) {
  let cursor = 0;
  let reconstructed = "";
  for (const segment of segments) {
    if (!segment || segment.startOffset !== cursor || segment.endOffset < segment.startOffset) {
      throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", `${label}存在空洞或重叠。`);
    }
    const expected = sourceText.slice(segment.startOffset, segment.endOffset);
    if (segment.text !== expected || segment.textHash !== hashText(expected)) {
      throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", `${label}文本或哈希不一致。`);
    }
    reconstructed += segment.text;
    cursor = segment.endOffset;
  }
  if (cursor !== sourceText.length || reconstructed !== sourceText) {
    throw new TtsUtterancePlanError("TTS_CHUNK_COVERAGE_FAILED", `${label}没有完整覆盖正文。`);
  }
}

function hashText(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

module.exports = {
  LEAD_ONE_POLICY,
  LEAD_TWO_POLICY,
  MAX_UTTERANCE_GRAPHEMES,
  TAIL_BLOCK_POLICY,
  TtsUtterancePlanError,
  UTTERANCE_PLAN_VERSION,
  assertTtsUtteranceCoverage,
  countGraphemes,
  planTtsUtterance,
};
