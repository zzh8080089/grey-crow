"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  buildSkillLocaleCoverage,
  compileContentSnapshot,
  loadBuiltInContentPack,
  readContentSnapshot,
} = require("..");
const { withTempFixture } = require("./test-fixtures/temp-workspace");

const ORDINARY_SKILL_IDS = Object.freeze([
  "entity-memory",
  "extreme-ending-easter",
  "game-state",
  "map",
  "memory-fragment",
  "story-finale",
]);

async function runBuiltInSkillLocalizationChecks() {
  return withTempFixture(async (workspace) => {
    const gameRoot = path.resolve(__dirname, "..", "..", "..");
    const contentRoot = path.join(gameRoot, "content");
    const packRoot = path.join(contentRoot, "packs", "grey-crow-default");
    const loaded = await loadBuiltInContentPack({ contentRoot, engineVersion: "2.2.0" });
    const manifestSkills = loaded.pack.manifest.provides.filter((item) => item.type === "skill");
    const ordinarySkills = manifestSkills.filter((item) => item.skillClass === "ordinary");
    const newGameSkill = manifestSkills.find((item) => item.skillClass === "new_game");
    const localizations = loaded.pack.resources.skillLocalizations;
    const localizationById = new Map(localizations.map((item) => [item.itemId, item]));

    assert(loaded.pack.manifest.version === "2.2.0"
      && loaded.pack.manifest.engineCompatibility === ">=2.2 <3"
      && loaded.pack.manifest.languages.join(",") === "zh-CN,en-US,ja-JP", "built-in official content must declare all three supported languages");
    assert(ordinarySkills.map((item) => item.id).sort().join(",") === ORDINARY_SKILL_IDS.join(","), "D4 must cover exactly the selected built-in ordinary Skill set");
    assert(ordinarySkills.every((item) => item.localization?.path === `skills/${item.id}/localizations.json`), "every built-in ordinary Skill must own one same-root localization bundle");
    assert(newGameSkill.localization?.path === "skills/new-game-default/localizations.json", "D3 must localize the formal New Game Skill under its stable identity");
    assert(localizations.length === ORDINARY_SKILL_IDS.length + 1, "validated Pack resources must contain one localization bundle per selected Skill");

    for (const item of ordinarySkills) {
      const localization = localizationById.get(item.id);
      assert(localization?.sourceLocale === "zh-CN" && localization.locales.length === 2, `${item.id} must preserve one stable source identity and English/Japanese resources`);
      const english = localization.locales.find((entry) => entry.locale === "en-US");
      const japanese = localization.locales.find((entry) => entry.locale === "ja-JP");
      assert(english.locale === "en-US" && english.title && english.description, `${item.id} must provide complete English discovery metadata`);
      assert(Boolean(english.modulePresentation) === Boolean(item.module), `${item.id} module presentation coverage must match its stable module definition`);
      const sourceTemplateIds = (item.templates || []).map(templateIdFromPath).sort();
      const englishTemplateIds = english.templates.map((template) => template.templateId).sort();
      assert(sourceTemplateIds.join(",") === englishTemplateIds.join(","), `${item.id} English templates must preserve the complete stable template ID set`);
      const body = await fs.readFile(path.join(packRoot, english.body.path), "utf8");
      assert(!containsCjk(body), `${item.id} English Skill body must not contain untranslated Chinese prose`);
      for (const template of english.templates) {
        const templateBody = await fs.readFile(path.join(packRoot, template.path), "utf8");
        assert(templateBody.includes(`Template ID: \`${template.templateId}\``), `${item.id} English template must preserve its declared stable ID`);
        assert(!containsCjk(templateBody), `${item.id} English template must not contain untranslated Chinese prose`);
      }
      assert(!containsCjk(JSON.stringify({
        title: english.title,
        description: english.description,
        triggers: english.triggers,
        playerGuide: english.playerGuide,
        modulePresentation: english.modulePresentation?.presentation || null,
      })), `${item.id} English metadata and module presentation must not retain Chinese labels`);
      assert(japanese?.title && japanese.description && containsKana(await fs.readFile(path.join(packRoot, japanese.body.path), "utf8")), `${item.id} must provide a substantive Japanese Skill body and discovery metadata`);
      assert(Boolean(japanese.modulePresentation) === Boolean(item.module), `${item.id} Japanese module presentation coverage must match its stable module definition`);
      assert(japanese.templates.map((template) => template.templateId).sort().join(",") === sourceTemplateIds.join(","), `${item.id} Japanese templates must preserve the complete stable template ID set`);
      for (const template of japanese.templates) {
        const templateBody = await fs.readFile(path.join(packRoot, template.path), "utf8");
        assert(templateBody.includes(`Template ID: \`${template.templateId}\``) && containsKana(templateBody), `${item.id} Japanese template must preserve its stable ID and contain Japanese prose`);
      }
    }

    const storyFinale = await readEnglishBody(packRoot, localizationById.get("story-finale"));
    const easter = await readEnglishBody(packRoot, localizationById.get("extreme-ending-easter"));
    const memory = await readEnglishBody(packRoot, localizationById.get("memory-fragment"));
    assert(storyFinale.includes("whole story has reached natural closure")
      && storyFinale.includes("Never choose for the player"), "English Story Finale must preserve natural closure, ambiguity, and player-consent boundaries");
    assert(easter.includes("Three natural confirmations")
      && easter.includes("real player and the fictional character")
      && easter.includes("do not propose a candidate")
      && easter.includes("Never provide real-world methods"), "English hidden ending must preserve three-turn confirmation and real-world safety boundaries");
    assert(memory.includes("choose and shape a new self")
      && memory.includes("Memory Restorer")
      && !/\b(?:record_memory_fragment|resolve_memory_fragment)\b/.test(memory),
    "English Memory Fragments must preserve player-authored completion paths without retired write tools");
    const memoryDefinition = JSON.parse(await fs.readFile(path.join(packRoot, "skills/memory-fragment/module.json"), "utf8"));
    const fragmentField = memoryDefinition.fields.find(field => field.id === "fragments");
    const certainty = fragmentField.itemFields.find(field => field.id === "certainty");
    assert(fragmentField.maxItems === 30 && certainty.options.length === 1 && certainty.options[0].value === "uncertain",
      "localized memory content must retain the 30-fragment limit and unverified certainty");

    const memoryOverlay = localizationById.get("memory-fragment").locales.find((entry) => entry.locale === "en-US").modulePresentation.presentation;
    assert(memoryOverlay.fields.map((field) => field.fieldId).join(",") === "fragments,revelation_status", "English module presentation must preserve stable field identities");
    assert(memoryOverlay.actions.map((action) => action.actionId).join(",") === "record_fragment,resolve_fragment", "English module presentation must preserve stable semantic action identities");
    assert(memoryOverlay.fields[1].options.map((option) => option.value).join(",") === "collecting,available,deferred,sealed,accepted", "English module presentation must preserve stable enum values and order");
    assert(localizationById.get("extreme-ending-easter").locales.every((entry) => entry.modulePresentation.presentation.fields.length === 0), "hidden lifecycle module must remain an empty presentation overlay in every locale");

    const adventuresRoot = workspace.resolve("adventures");
    await fs.mkdir(adventuresRoot, { recursive: true });
    await compileContentSnapshot({
      adventuresRoot,
      adventureId: "d3_builtin_japanese",
      language: "ja-JP",
      plan: loaded.defaultPlan,
      packRoots: { "grey-crow-default": packRoot },
      clock: () => "2026-07-18T10:00:00.000Z",
    });
    const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: "d3_builtin_japanese" });
    assert(snapshot.profile.language === "ja-JP"
      && snapshot.profile.host.language === "ja-JP"
      && snapshot.profile.world.language === "ja-JP"
      && containsKana(snapshot.content.host)
      && snapshot.content.world.includes("感染爆発から十日目"), "Japanese Adventure snapshot must compile the Japanese Host and World bodies under the original stable item IDs");
    const sourceCoverage = buildSkillLocaleCoverage(snapshot, { gameLocale: "zh-CN", localeRevision: "d4_source_001" });
    const englishCoverage = buildSkillLocaleCoverage(snapshot, { gameLocale: "en-US", localeRevision: "d4_english_001" });
    assert(sourceCoverage.status === "ready" && sourceCoverage.readySkillIds.length === 7, "D4 Snapshot must keep all selected Skills ready in the source locale");
    const japaneseCoverage = buildSkillLocaleCoverage(snapshot, { gameLocale: "ja-JP", localeRevision: "d3_japanese_001" });
    assert(englishCoverage.status === "ready" && englishCoverage.readySkillIds.length === 7, "D3 must make every selected Skill English-ready");
    assert(japaneseCoverage.status === "ready" && japaneseCoverage.readySkillIds.length === 7, "D3 must make every selected Skill Japanese-ready");

    await compileContentSnapshot({
      adventuresRoot,
      adventureId: "d3_builtin_english",
      language: "en-US",
      plan: loaded.defaultPlan,
      packRoots: { "grey-crow-default": packRoot },
      clock: () => "2026-07-18T10:05:00.000Z",
    });
    const englishSnapshot = await readContentSnapshot({ adventuresRoot, adventureId: "d3_builtin_english" });
    assert(englishSnapshot.profile.language === "en-US"
      && englishSnapshot.profile.host.language === "en-US"
      && englishSnapshot.profile.world.language === "en-US"
      && englishSnapshot.content.host.includes("You are the Grey Crow")
      && englishSnapshot.content.world.includes("The city is not completely dead"), "English Adventure snapshot must compile the English Host and World bodies under the original stable item IDs");

    return {
      name: "p2-26-built-in-english-skills",
      ok: true,
      details: {
        ordinary_skill_count: ORDINARY_SKILL_IDS.length,
        english_template_count: localizations.flatMap((item) => item.locales.find((entry) => entry.locale === "en-US")?.templates || []).length,
        localized_module_count: localizations.filter((item) => item.locales.some((entry) => entry.modulePresentation)).length,
        stable_identity_and_template_sets: true,
        story_finale_boundary_reviewed: true,
        hidden_ending_safety_reviewed: true,
        memory_choice_semantics_reviewed: true,
        new_game_three_language_ready: true,
      },
    };
  }, { prefix: "p2-26-built-in-english-skills" });
}

async function readEnglishBody(packRoot, localization) {
  return fs.readFile(path.join(packRoot, localization.locales[0].body.path), "utf8");
}

function templateIdFromPath(value) {
  return `template:${path.posix.basename(value).replace(/\.md$/i, "")}`;
}

function containsCjk(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(String(value));
}

function containsKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = { runBuiltInSkillLocalizationChecks };
