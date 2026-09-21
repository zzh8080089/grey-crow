#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  LEAD_ONE_POLICY,
  LEAD_TWO_POLICY,
  MAX_UTTERANCE_GRAPHEMES,
  TAIL_BLOCK_POLICY,
  assertTtsUtteranceCoverage,
  countGraphemes,
  planTtsUtterance,
} = require(path.resolve(__dirname, "../../../..", "engine/tts/utterance-planner"));

main();

function main() {
  for (const length of [30, 50, 100, 300, 500, 1000, 1001, 2000, 4000, 8000]) {
    const text = makeText(length);
    const plan = planTtsUtterance(text);
    assert(plan.graphemeCount === length, `${length} graphemes should be counted exactly.`);
    assert(reconstruct(plan) === text, `${length} graphemes should reconstruct without loss.`);
    assert(assertTtsUtteranceCoverage(plan) === true, `${length} graphemes should pass coverage.`);
    assert(Object.isFrozen(plan) && Object.isFrozen(plan.segments), "utterance plan must be immutable.");
  }
  for (let length = 1; length <= Math.min(1000, MAX_UTTERANCE_GRAPHEMES); length += 1) {
    const text = makeText(length);
    assert(reconstruct(planTtsUtterance(text)) === text, `coverage sweep failed at ${length} graphemes.`);
  }

  const compact = planTtsUtterance(makeText(50));
  assert(compact.segments.length === 1 && compact.segments[0].kind === "lead-1", "short text should stay in lead-1.");

  const standard = planTtsUtterance(makeText(300));
  assert(standard.segments.map((segment) => segment.kind).join(",") === "lead-1,lead-2,tail", "standard text should use two leads and one Tail.");
  assert(inRange(standard.segments[0].graphemeCount, LEAD_ONE_POLICY), "lead-1 should respect its target range.");
  assert(inRange(standard.segments[1].graphemeCount, LEAD_TWO_POLICY), "lead-2 should respect its target range.");
  assert(standard.segments[2].blocks.length >= 2, "ordinary Tail should use approximately 80-character playback units.");
  assert(playbackUnits(standard).every((segment) => segment.graphemeCount <= TAIL_BLOCK_POLICY.hardMax), "all follow-up playback units must stay within the character safety bound.");

  const maximum = planTtsUtterance(makeText(MAX_UTTERANCE_GRAPHEMES));
  const maximumTail = maximum.segments.find((segment) => segment.kind === "tail");
  assert(maximumTail.blocks.length >= 10, "maximum Tail should be split into short playback units.");
  assert(maximumTail.blocks.every((block) => block.graphemeCount <= TAIL_BLOCK_POLICY.hardMax), "Tail blocks must respect the hard max.");
  assert(maximumTail.blocks.map((block) => block.text).join("") === maximumTail.text, "Tail blocks must reconstruct the entire Tail.");

  const punctuation = "雨停了。".repeat(12) + "门外传来脚步声！".repeat(12) + "继续观察，不要出声。".repeat(20);
  const punctuationPlan = planTtsUtterance(punctuation);
  assert(reconstruct(punctuationPlan) === punctuation, "punctuated narration should preserve all text.");
  assert(/[。！？!?…]$/u.test(punctuationPlan.segments[0].text), "lead-1 should prefer a sentence boundary.");
  assert(playbackUnits(punctuationPlan).slice(1).every((segment) =>
    segment.graphemeCount <= TAIL_BLOCK_POLICY.hardMax
  ), "punctuated follow-up units must stay within the playback bound.");

  const paragraphs = "第一段没有危险。\n第二段继续观察。\n" + makeText(260);
  assert(reconstruct(planTtsUtterance(paragraphs)) === paragraphs, "paragraph newlines must be preserved.");

  const mixed = "第2026号出口仍然关闭，API-7记录正常；continue observing. ".repeat(12);
  const mixedPlan = planTtsUtterance(mixed);
  assert(reconstruct(mixedPlan) === mixed, "mixed Chinese, digits, and English must reconstruct exactly.");
  assert(playbackUnits(mixedPlan).every((segment) => segment.graphemeCount <= TAIL_BLOCK_POLICY.hardMax), "mixed playback units must stay within the character safety bound.");

  const family = "👨‍👩‍👧‍👦";
  const graphemeText = family.repeat(40) + "结束。";
  const graphemePlan = planTtsUtterance(graphemeText);
  assert(countGraphemes(graphemeText) === 43 && graphemePlan.graphemeCount === 43, "Unicode grapheme clusters must not be split by code unit.");
  assert(reconstruct(graphemePlan) === graphemeText, "Unicode grapheme text must reconstruct exactly.");

  expectFailure(() => planTtsUtterance("界".repeat(MAX_UTTERANCE_GRAPHEMES + 1)), "TTS_TEXT_TOO_LONG");
  expectFailure(() => planTtsUtterance(" \n\t "), "INVALID_TTS_INPUT");

  const invalid = JSON.parse(JSON.stringify(standard));
  invalid.segments[1].startOffset += 1;
  expectFailure(() => assertTtsUtteranceCoverage(invalid), "TTS_CHUNK_COVERAGE_FAILED");

  process.stdout.write("TTS utterance planner checks passed\n");
}

function makeText(length) {
  return "界".repeat(length);
}

function reconstruct(plan) {
  return plan.segments.map((segment) => segment.text).join("");
}

function playbackUnits(plan) {
  return plan.segments.flatMap((segment) => segment.kind === "tail" ? segment.blocks : [segment]);
}

function inRange(value, policy) {
  return value >= policy.min && value <= policy.hardMax;
}

function expectFailure(fn, code) {
  try {
    fn();
  } catch (error) {
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected failure ${code}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
