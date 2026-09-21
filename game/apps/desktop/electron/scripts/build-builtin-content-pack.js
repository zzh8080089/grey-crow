"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const GAME_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const { validatePackV2 } = require(path.join(GAME_ROOT, "engine", "content-v2"));
const CONTENT_ROOT = path.join(GAME_ROOT, "content");
const PACKS_ROOT = path.join(CONTENT_ROOT, "packs");
const OUTPUT_ROOT = path.join(PACKS_ROOT, "grey-crow-default");
const CHECK_MODE = process.argv.includes("--check");
const PACK_VERSION = "2.2.0";
const OFFICIAL_LOCALES = Object.freeze(["zh-CN", "en-US", "ja-JP"]);
const NEW_GAME_SKILL = Object.freeze({
  id: "new-game-default",
  sourceId: "new-game",
  title: "灰鸦：上海末日开局",
  description: "从主菜单开始灰鸦上海末日新冒险时，通过多轮对话确认身份、唯一之物和四类上海出生区域。",
  danger: "medium",
  triggers: ["ui_start_new_game"],
  readScopes: ["state", "world", "memory"],
  writeScopes: ["state", "memory", "world_records", "character_records", "timeline"],
});

const SKILLS = Object.freeze([
  {
    id: "game-state",
    title: "游戏状态",
    description: "当玩家询问或确认身体、背包摘要、主要场景锚点变化时，提供受控的当前状态读写指南。",
    danger: "medium",
    triggers: ["状态", "背包", "受伤", "地点", "inventory", "status"],
    readScopes: ["state", "world"],
    writeScopes: ["state"],
  },
  {
    id: "map",
    title: "地图",
    description: "当玩家询问当前位置、附近地点或路线时，读取已知空间资料；不会自动移动玩家。",
    danger: "low",
    triggers: ["地图", "路线", "附近", "去哪", "map", "route"],
    readScopes: ["state", "world"],
    writeScopes: [],
  },
  {
    id: "entity-memory",
    title: "实体与世界记忆",
    description: "当当前回合涉及持续人物、地点、阵营或物品时，按需读取或更新当前冒险的语义记录。",
    danger: "medium",
    triggers: ["人物", "地点", "阵营", "物品", "之前", "remember"],
    readScopes: ["memory", "transcript", "world"],
    writeScopes: ["memory", "world_records", "character_records", "item_records", "timeline"],
  },
  {
    id: "story-finale",
    title: "故事终局",
    description: "当整个故事真正自然闭合时，由主持人在普通叙事中温和询问玩家继续、完结或暂不决定。",
    playerGuide: "主持人只会在整个故事自然闭合时，通过普通故事对话询问你是否愿意完结。你可以继续、完结或暂不决定；不会出现强制结算弹窗。",
    danger: "high",
    triggers: ["故事结局", "旅程终点", "让故事结束", "继续这个故事", "story finale"],
    readScopes: ["state", "memory", "transcript", "skill"],
    writeScopes: [],
  },
  {
    id: "extreme-ending-easter",
    title: "灰鸦余响",
    description: "官方隐藏终末路线：仅处理明确限定于当前游戏角色的极端选择，并通过普通叙事进行三次独立确认。",
    playerGuide: "一段只在满足官方隐藏条件后才会显现的灰鸦余响。它不会公开确认阶段、概率或内部判定。",
    danger: "high",
    triggers: [],
    readScopes: ["state", "memory", "transcript", "skill"],
    writeScopes: [],
    modulePath: "skills/extreme-ending-easter/module.json",
  },
]);

const OPTIONAL_SKILLS = Object.freeze([
  {
    id: "memory-fragment",
    title: "记忆碎片",
    description: "当玩家主动回忆或场景形成强关联时，收集未经证实的感官碎片，并由玩家决定如何面对拼合出的过去。",
    playerGuide: "主持人会在主动回忆或强关联场景中保存模糊的感官碎片，最多 30 条。这些碎片不是已证实历史；满额后由你决定接受过去、选择新的自己或暂缓决定。",
    danger: "medium",
    triggers: ["回忆", "记忆", "熟悉的气味", "似曾相识", "旧物", "身份线索"],
    readScopes: ["state", "memory", "transcript", "skill"],
    writeScopes: [],
    modulePath: "skills/memory-fragment/module.json",
    defaultEnabled: true,
  },
]);

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  if (error?.meta) process.stderr.write(`${JSON.stringify(error.meta, null, 2)}\n`);
  process.exitCode = 1;
});

async function main() {
  await fs.mkdir(PACKS_ROOT, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(PACKS_ROOT, ".grey-crow-default-build-"));
  try {
    await buildPack(stagingRoot);
    await validatePackV2(stagingRoot, { trustedRoot: PACKS_ROOT });
    if (CHECK_MODE) {
      await assertDirectoriesEqual(OUTPUT_ROOT, stagingRoot);
      process.stdout.write("Built-in Grey Crow Pack is current.\n");
      return;
    }
    await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
    await fs.rename(stagingRoot, OUTPUT_ROOT);
    process.stdout.write(`Generated ${path.relative(GAME_ROOT, OUTPUT_ROOT)}.\n`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function buildPack(root) {
  const host = await compileHost();
  const world = normalizeText(await fs.readFile(path.join(CONTENT_ROOT, "world", "world-card.shanghai-day10.md"), "utf8"));
  const newGameSkill = await compileNewGameSkill();
  const newGameSourceRoot = path.join(CONTENT_ROOT, "skills", NEW_GAME_SKILL.sourceId);
  const newGameTargetRoot = `skills/${NEW_GAME_SKILL.id}`;
  const newGameTemplateFiles = (await listFiles(path.join(newGameSourceRoot, "templates")))
    .filter((file) => file.endsWith(".md"));
  const newGameTemplates = newGameTemplateFiles.map((file) => `${newGameTargetRoot}/templates/${file}`);
  await writeText(root, "host/HOST.md", host);
  await writeText(root, "world/WORLD.md", world);
  await writeText(root, `${newGameTargetRoot}/SKILL.md`, newGameSkill);
  await copyTextTree(path.join(CONTENT_ROOT, "host", "locales"), root, "host/locales");
  await copyTextTree(path.join(CONTENT_ROOT, "world", "locales"), root, "world/locales");
  await writeText(root, "host/localizations.json", normalizeText(await fs.readFile(path.join(CONTENT_ROOT, "host", "localizations.json"), "utf8")));
  await writeText(root, "world/localizations.json", normalizeText(await fs.readFile(path.join(CONTENT_ROOT, "world", "localizations.json"), "utf8")));
  for (const file of newGameTemplateFiles) {
    await writeText(
      root,
      `${newGameTargetRoot}/templates/${file}`,
      normalizeText(await fs.readFile(path.join(newGameSourceRoot, "templates", file), "utf8"))
    );
  }
  await copyNewGameLocalizations(newGameSourceRoot, root, newGameTargetRoot);

  const provides = [
    {
      type: "host", id: "grey-crow-host", title: "灰鸦主持人", path: "host/HOST.md", language: "zh-CN",
      description: "冷静、克制、具体的灰鸦主持风格，不携带固定世界背景。", danger: "low",
      localization: {
        schemaVersion: "grey-crow-narrative-localization-ref-v1",
        path: "host/localizations.json",
      },
    },
    {
      type: "world", id: "shanghai-day10", title: "上海·爆发后第十天", path: "world/WORLD.md", language: "zh-CN",
      description: "N7 狂犬病变种爆发后第十天的上海：城市正在失效，但还没有彻底死去。", danger: "medium",
      localization: {
        schemaVersion: "grey-crow-narrative-localization-ref-v1",
        path: "world/localizations.json",
      },
    },
  ];

  provides.push({
    type: "skill",
    skillClass: "new_game",
    id: NEW_GAME_SKILL.id,
    title: NEW_GAME_SKILL.title,
    path: `${newGameTargetRoot}/SKILL.md`,
    language: "zh-CN",
    description: NEW_GAME_SKILL.description,
    danger: NEW_GAME_SKILL.danger,
    triggers: NEW_GAME_SKILL.triggers,
    templates: newGameTemplates,
    readScopes: NEW_GAME_SKILL.readScopes,
    writeScopes: NEW_GAME_SKILL.writeScopes,
    localization: {
      schemaVersion: "grey-crow-skill-localization-ref-v1",
      path: `${newGameTargetRoot}/localizations.json`,
    },
  });

  for (const skill of [...SKILLS, ...OPTIONAL_SKILLS]) {
    const sourceRoot = path.join(CONTENT_ROOT, "skills", skill.id);
    const targetRoot = `skills/${skill.id}`;
    await copyTextTree(sourceRoot, root, targetRoot);
    const templates = (await listFiles(path.join(sourceRoot, "templates")))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `${targetRoot}/templates/${file}`);
    provides.push({
      type: "skill",
      skillClass: "ordinary",
      id: skill.id,
      title: skill.title,
      path: `${targetRoot}/SKILL.md`,
      language: "zh-CN",
      description: skill.description,
      danger: skill.danger,
      triggers: skill.triggers,
      templates,
      readScopes: skill.readScopes,
      writeScopes: skill.writeScopes,
      ...(skill.playerGuide ? { playerGuide: skill.playerGuide } : {}),
      localization: {
        schemaVersion: "grey-crow-skill-localization-ref-v1",
        path: `${targetRoot}/localizations.json`,
      },
      ...(skill.modulePath ? {
        module: {
          schemaVersion: "grey-crow-skill-module-ref-v1",
          path: skill.modulePath,
        },
      } : {}),
    });
  }

  provides.push({
    type: "new_game_preset", id: "grey-crow-default", title: "灰鸦·上海末日", path: "presets/default.json",
    language: "zh-CN", description: "上海，疫情爆发后的第十天。电力与物资渐渐短缺，仍有人守着家、等待救援。你将决定自己的身份、唯一留下的东西和起点，在弄堂与街区间探索、交谈、寻找物资，面对信任与生存的选择。氛围克制而紧张，包含感染、伤亡与困境描写；行动通过自然语言表达，结果随故事发展。", danger: "low",
  });

  const manifest = {
    schemaVersion: "grey-crow-extension-pack-v2",
    id: "grey-crow-default",
    title: "Grey Crow Default Content",
    version: PACK_VERSION,
    author: "Grey Crow",
    engineCompatibility: ">=2.2 <3",
    languages: OFFICIAL_LOCALES,
    provides,
    permissions: ["read_base_content", "write_current_saveRoot_via_tools", "menu_command"],
    conflicts: [],
  };
  await writeJson(root, "manifest.json", manifest);
  await writeJson(root, "presets/default.json", {
    schemaVersion: "grey-crow-new-game-preset-v2",
    id: "grey-crow-default",
    language: "zh-CN",
    locales: OFFICIAL_LOCALES,
    localizedMetadata: [
      {
        locale: "en-US",
        title: "Grey Crow · Shanghai Outbreak",
        description: "Shanghai, ten days after the outbreak. Power and supplies are running short, yet people still wait at home for rescue. Choose who you are, the one thing you kept and where you begin. Explore lanes and neighborhoods, talk to survivors and search for supplies as trust and survival come into conflict. A restrained, tense story with infection, injury and loss. Describe your actions in your own words and discover their consequences.",
      },
      {
        locale: "ja-JP",
        title: "灰鴉・上海終末",
        description: "感染拡大から十日目の上海。電力も物資も不足し始める一方、家で救援を待つ人々もいる。自分の素性、唯一手元に残したもの、出発地点を決め、路地や街区を探索し、生存者と話し、物資を探そう。信頼と生存の間で何を選ぶか。感染、負傷、喪失を含む、静かな緊張感のある物語。行動を自分の言葉で伝え、その結果を見届ける。",
      },
    ],
    host: { packId: "grey-crow-default", itemId: "grey-crow-host" },
    world: { packId: "grey-crow-default", itemId: "shanghai-day10" },
    newGameSkill: { packId: "grey-crow-default", itemId: NEW_GAME_SKILL.id },
    skills: SKILLS.map((skill) => ({ packId: "grey-crow-default", itemId: skill.id })),
    optionalSkills: OPTIONAL_SKILLS.map((skill) => ({
      packId: "grey-crow-default",
      itemId: skill.id,
      defaultEnabled: skill.defaultEnabled === true,
    })),
  });
}

async function compileNewGameSkill() {
  const source = await fs.readFile(path.join(CONTENT_ROOT, "skills", NEW_GAME_SKILL.sourceId, "SKILL.md"), "utf8");
  return normalizeText(source)
    .replace(/^id:\s*new-game\s*$/m, `id: ${NEW_GAME_SKILL.id}`)
    .replace(/^title:\s*New Game\s*$/m, `title: ${NEW_GAME_SKILL.title}`);
}

async function copyNewGameLocalizations(sourceRoot, outputRoot, targetRoot) {
  const sourceBundle = JSON.parse(await fs.readFile(path.join(sourceRoot, "localizations.json"), "utf8"));
  sourceBundle.itemId = NEW_GAME_SKILL.id;
  await writeJson(outputRoot, `${targetRoot}/localizations.json`, sourceBundle);
  for (const locale of sourceBundle.locales) {
    const sourceLocaleRoot = path.join(sourceRoot, "locales", locale.locale);
    const targetLocaleRoot = `${targetRoot}/locales/${locale.locale}`;
    await copyTextTree(sourceLocaleRoot, outputRoot, targetLocaleRoot);
    const localizedSkillPath = `${targetLocaleRoot}/SKILL.md`;
    const localizedSkill = await fs.readFile(path.join(sourceLocaleRoot, "SKILL.md"), "utf8");
    await writeText(
      outputRoot,
      localizedSkillPath,
      normalizeText(localizedSkill).replace(/^id:\s*new-game\s*$/m, `id: ${NEW_GAME_SKILL.id}`)
    );
  }
}

async function compileHost() {
  const hostText = await fs.readFile(path.join(CONTENT_ROOT, "host", "grey-crow-host.md"), "utf8");
  const roleText = await fs.readFile(path.join(CONTENT_ROOT, "host", "role-card.grey-crow.md"), "utf8");
  const soulText = await fs.readFile(path.join(CONTENT_ROOT, "host", "grey-crow-soul.md"), "utf8");
  const sections = [
    "# Grey Crow Host v2",
    "",
    "本 Host 只定义主持人身份、语气、裁决倾向和叙事质量。世界背景由当前冒险锁定的 World item 单独注入。",
    "",
    extractSections(roleText, ["Identity", "Personality", "Voice", "Judgment", "Difficulty Baseline", "Prohibitions"]),
    extractSections(soulText, ["Player-Facing Reply"]),
    extractSections(hostText, ["Narrative Boundaries", "Scene Quality", "Execution Boundary"]),
  ];
  return normalizeText(sections.filter(Boolean).join("\n\n"))
    .replace(/上海末日废土中的观察者/g, "当前锁定世界中的观察者");
}

function extractSections(text, names) {
  const wanted = new Set(names);
  const lines = normalizeText(text).split("\n");
  const out = [];
  let keep = false;
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) keep = wanted.has(match[1]);
    if (keep) out.push(line);
  }
  return out.join("\n").trim();
}

async function copyTextTree(sourceRoot, outputRoot, relativeTarget) {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const source = path.join(sourceRoot, entry.name);
    const target = `${relativeTarget}/${entry.name}`;
    if (entry.isDirectory()) await copyTextTree(source, outputRoot, target);
    else if (entry.isFile() && [".md", ".json"].includes(path.extname(entry.name).toLowerCase())) {
      await writeText(outputRoot, target, normalizeText(await fs.readFile(source, "utf8")));
    }
  }
}

async function listFiles(dir) {
  return fs.readdir(dir).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
}

async function writeText(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, normalizeText(content), "utf8");
}

async function writeJson(root, relativePath, value) {
  await writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeText(value) {
  return String(value).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n*$/, "\n");
}

async function assertDirectoriesEqual(leftRoot, rightRoot) {
  const left = await collectFiles(leftRoot);
  const right = await collectFiles(rightRoot);
  if (JSON.stringify([...left.keys()]) !== JSON.stringify([...right.keys()])) {
    throw new Error("Built-in Pack file list is stale. Run npm run build:content-packs.");
  }
  for (const [relativePath, content] of left) {
    if (!content.equals(right.get(relativePath))) {
      throw new Error(`Built-in Pack file is stale: ${relativePath}`);
    }
  }
}

async function collectFiles(root) {
  const result = new Map();
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) result.set(path.relative(root, absolute).split(path.sep).join("/"), await fs.readFile(absolute));
    }
  }
  await walk(root);
  return result;
}
