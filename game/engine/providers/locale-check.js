"use strict";

// The connection probe checks language without loading a story-rewrite loop.
function isObviousLocaleMismatch(value, locale) {
  const text = stripNonLanguage(String(value || ""));
  if (Array.from(text).length < 18) return false;
  const han = count(text, /\p{Script=Han}/gu);
  const kana = count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const latin = count(text, /\p{Script=Latin}/gu);
  if (locale === "en-US") return han + kana >= 12 && latin < 20;
  if (locale === "ja-JP") return kana === 0 && han >= 18 && latin < 20;
  return kana >= 4 || (latin >= 60 && han < 8);
}

function stripNonLanguage(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`[^`]*`/g, " ");
}

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

module.exports = { isObviousLocaleMismatch };
