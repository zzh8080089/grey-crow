"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applySkillModulePresentation } = require("../content-v2/skill-locale-resolver");
const { MEMORY_FRAGMENT_PANEL, projectMemoryFragmentDescriptor, projectMemoryFragmentPanel, projectMemoryFragmentModule } = require("./session-memory-fragment-projection");
const contentRoot = path.resolve(__dirname, "../../content/packs/grey-crow-default");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(contentRoot, relative), "utf8"));
function metadata(locale = "zh-CN") {
  const source = read("manifest.json").provides.find((item) => item.id === "memory-fragment");
  const localized = locale === "zh-CN" ? source : read("skills/memory-fragment/localizations.json").locales.find((entry) => entry.locale === locale);
  return { packId: "grey-crow-default", itemId: "memory-fragment", moduleRef: "module_fragment_fixture", title: localized.title,
    description: localized.description, playerGuide: localized.playerGuide, triggers: localized.triggers, packTitle: "Grey Crow",
    language: locale, definition: applySkillModulePresentation(read("skills/memory-fragment/module.json"),
      locale === "zh-CN" ? null : read(`skills/memory-fragment/locales/${locale}/module-presentation.json`)) };
}
function view(count = 29, phase = count === 30 ? "available" : "collecting") {
  const fragments = Array.from({ length: count }, (_, index) => ({ id: `fragment-${index + 1}`, gameDay: 10 + Math.floor(index / 2),
    discoveryMode: index % 2 ? "passive_association" : "active_recall", dimension: ["body", "emotion", "skill", "identity"][index % 4],
    trigger: `合成触发物${index + 1}`, content: `第${index + 1}次感官画面，仍是未经证实的可能过去。` + "细节".repeat(90), certainty: "uncertain",
    source: { adventureId: "parent-story", revision: index + 1, eventId: `record-${index + 1}`, sourceSegmentIds: [`fragment-source-${index + 1}`] } }));
  return { adventureId: "child-story", revision: 40, actionId: "current-action", locale: "zh-CN",
    state: { memoryFragments: { fragments, revelationStatus: phase, unlockedAt: count === 30 ? fragments[29].source : null,
      decision: ["accepted", "sealed", "deferred"].includes(phase) ? { choice: phase,
        source: { adventureId: "child-story", revision: 35, eventId: "resolve", sourceSegmentIds: ["decision-source"] } } : null } } };
}
const input = (locale, extra = {}) => ({ memoryFragmentSkill: metadata(locale), displayLocale: locale, panelRef: MEMORY_FRAGMENT_PANEL, ...extra });

for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
  test(`${locale} locked presentation supplies progress, dimensions, uncertainty and reconstruction labels`, () => {
    const state = view(); const options = input(locale); const before = JSON.stringify({ state, options });
    const descriptor = projectMemoryFragmentDescriptor(state, options);
    assert.equal(descriptor.surface, "timeline"); assert.equal(descriptor.language, locale);
    assert.equal(descriptor.title, options.memoryFragmentSkill.title);
    const projected = projectMemoryFragmentPanel(state, options);
    assert.equal(projected.revision, 40); assert.equal(projected.actionId, "current-action");
    assert.deepEqual(projected.panel.fields.find((entry) => entry.id === "fragments"), { id: "fragments", label: options.memoryFragmentSkill.definition.fields[0].label,
      kind: "progress", value: 29, minimum: 0, maximum: 30 });
    assert.equal(projected.panel.fields.find((entry) => entry.id === "dimensions").value.length, 4);
    assert.equal(projected.panel.fields.find((entry) => entry.id === "certainty").value,
      options.memoryFragmentSkill.definition.fields[0].itemFields.find((entry) => entry.id === "certainty").options[0].label);
    assert.doesNotMatch(JSON.stringify(projected), /record_memory_fragment|resolve_memory_fragment|namedPolicy/);
    assert.equal(JSON.stringify({ state, options }), before);
  });

  test(`${locale} full timeline pages and detail preserve exact sensory content and ancestor source`, () => {
    const state = view(30, "deferred"); const options = input(locale);
    const pages = []; let cursor = null;
    do {
      const page = projectMemoryFragmentPanel(state, { ...options, view: "list", fieldId: "fragments", cursor, limit: 12 });
      pages.push(page); cursor = page.panel.pagination.nextCursor;
    } while (cursor);
    assert.deepEqual(pages.map((page) => page.panel.items.length), [12, 12, 6]);
    const refs = pages.flatMap((page) => page.panel.items.map((entry) => entry.ref));
    const items = pages.flatMap((page) => page.panel.items);
    assert.equal(new Set(refs).size, 30);
    for (const [index, itemRef] of refs.entries()) {
      const detail = projectMemoryFragmentPanel(state, { ...options, view: "detail", fieldId: "fragments", itemRef });
      assert.equal(detail.panel.detail.title, `${options.memoryFragmentSkill.definition.fields[0].label} · ${index + 1}`);
      assert.equal(items[index].title, detail.panel.detail.title);
      assert.equal(items[index].subtitle, state.state.memoryFragments.fragments[index].trigger);
      assert.equal(detail.panel.detail.sections[0].fields[0].id, "content");
      assert.equal(detail.panel.detail.sections[0].fields.find((entry) => entry.id === "trigger").value, state.state.memoryFragments.fragments[index].trigger);
      assert.equal(detail.panel.detail.sections[0].fields.find((entry) => entry.id === "content").value, state.state.memoryFragments.fragments[index].content);
      assert.deepEqual(detail.sources[0].source, state.state.memoryFragments.fragments[index].source);
      assert.equal(detail.panel.detail.sections[0].fields.find((entry) => entry.id === "game_day").value, 10 + Math.floor(index / 2));
    }
    assert.equal(pages[0].resolutionSources.decision.choice, "deferred");
    assert.deepEqual(pages[0].resolutionSources.unlockedAt, state.state.memoryFragments.unlockedAt);
  });

  test(`${locale} classic module uses the same progress, localized values and bounded record pages`, () => {
    const state = view(30, "accepted"); const options = input(locale);
    const overview = projectMemoryFragmentModule(state, options);
    assert.equal(overview.module.revision, 40); assert.equal(overview.module.hasModule, true);
    assert.equal(overview.module.fields[0].derivedSummary.count, 30);
    assert.equal(overview.module.fields[0].derivedSummary.groupCounts.reduce((sum, group) => sum + group.count, 0), 30);
    assert.deepEqual(overview.module.fields[0].value, []);
    assert.equal(overview.module.fields[1].value, "accepted");
    const page = projectMemoryFragmentModule(state, { ...options, fieldId: "fragments", limit: 12 });
    assert.equal(page.module.fields[0].value.length, 12);
    assert.equal(page.module.fields[0].value[0].certainty, "uncertain");
    assert.equal(page.module.fields[0].value[0].content, state.state.memoryFragments.fragments[0].content);
    assert.equal(page.sources[0].source.adventureId, "parent-story");
    assert.equal(page.module.pagination.hasMore, true);
  });
}

test("not selected is absent, selected old snapshot without records is zero and never invents fragments", () => {
  const state = view(); delete state.state.memoryFragments;
  assert.equal(projectMemoryFragmentDescriptor(state), null);
  assert.throws(() => projectMemoryFragmentPanel(state, { panelRef: MEMORY_FRAGMENT_PANEL }), { code: "SKILL_PANEL_NOT_SELECTED" });
  assert.equal(projectMemoryFragmentPanel(state, input("zh-CN")).panel.fields[0].value, 0);
  assert.equal(projectMemoryFragmentPanel(state, { ...input("zh-CN"), view: "list", fieldId: "fragments" }).panel.pagination.totalItems, 0);
});

test("cursor rejects another adventure, revision, locale and tampering; item refs bind adventure", () => {
  const state = view(); const options = input("zh-CN");
  const first = projectMemoryFragmentPanel(state, { ...options, view: "list", fieldId: "fragments", limit: 12 });
  const cursor = first.panel.pagination.nextCursor;
  for (const [nextView, nextInput] of [
    [{ ...state, revision: 41 }, options], [{ ...state, adventureId: "other-story" }, options], [state, input("en-US")],
  ]) assert.throws(() => projectMemoryFragmentPanel(nextView, { ...nextInput, view: "list", fieldId: "fragments", cursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  assert.throws(() => projectMemoryFragmentPanel(state, { ...options, view: "list", fieldId: "fragments", cursor: cursor + "0" }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  assert.throws(() => projectMemoryFragmentPanel({ ...state, adventureId: "other-story" }, { ...options, view: "detail", fieldId: "fragments", itemRef: first.panel.items[0].ref }), { code: "SKILL_PANEL_ITEM_NOT_FOUND" });
});

test("choice remains a player's interpretation, both completion branches retain uncertain records", () => {
  for (const phase of ["available", "deferred", "accepted", "sealed"]) {
    const state = view(30, phase); const options = input("zh-CN");
    const result = projectMemoryFragmentPanel(state, options);
    assert.equal(result.panel.fields[0].value, 30);
    assert.equal(result.panel.fields.find((entry) => entry.id === "certainty").value, "未经证实");
    assert.equal(projectMemoryFragmentModule(state, options).module.fields[1].value, phase);
    assert.equal(result.autoSpeak, undefined); assert.equal(result.envelope, undefined);
  }
});

test("missing translation, malformed records, future sources and unknown fields fail safely", () => {
  assert.throws(() => projectMemoryFragmentDescriptor(view(), input("en-US", { displayLocale: "ja-JP" })), { code: "MEMORY_FRAGMENT_PROJECTION_INVALID" });
  for (const mutate of [(state) => { state.state.memoryFragments.fragments[0].certainty = "confirmed"; },
    (state) => { state.state.memoryFragments.fragments[0].source.revision = 999; },
    (state) => { state.state.memoryFragments.fragments[0].source.sourceSegmentIds = []; },
    (state) => { state.state.memoryFragments.revelationStatus = "accepted"; }]) {
    const state = view(); mutate(state);
    assert.throws(() => projectMemoryFragmentPanel(state, input("zh-CN")), { code: "MEMORY_FRAGMENT_PROJECTION_INVALID" });
  }
  assert.throws(() => projectMemoryFragmentPanel(view(), { ...input("zh-CN"), view: "list", fieldId: "hidden" }), { code: "SKILL_PANEL_FIELD_UNKNOWN" });
});

test("valid new-ledger day and all source segments survive the older presentation limits", () => {
  const state = view(1); const fragment = state.state.memoryFragments.fragments[0];
  fragment.gameDay = 1000000000;
  fragment.source.sourceSegmentIds = Array.from({ length: 256 }, (_, index) => `source-${index + 1}`);
  const options = input("zh-CN");
  const list = projectMemoryFragmentPanel(state, { ...options, view: "list", fieldId: "fragments" });
  assert.equal(list.sources[0].source.sourceSegmentIds.length, 256);
  const detail = projectMemoryFragmentPanel(state, { ...options, view: "detail", fieldId: "fragments", itemRef: list.panel.items[0].ref });
  assert.equal(detail.panel.detail.sections[0].fields.find((entry) => entry.id === "game_day").value, 1000000000);
  assert.deepEqual(detail.sources[0].source, fragment.source);
  assert.equal(projectMemoryFragmentModule(state, { ...options, fieldId: "fragments" }).module.fields[0].value[0].game_day, 1000000000);
});
