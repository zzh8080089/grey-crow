#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  CREATOR_FACADE_DRAFT_VERSION,
  normalizeSkillModuleCreatorDraft,
} = require("../../../../engine/content-v2");

const EXPERIMENT_SCHEMA_VERSION = "grey-crow-character-skill-facade-experiment-v1";
const RECORD_SCHEMA_VERSION = "grey-crow-character-record-experiment-v1";
const INDEX_SCHEMA_VERSION = "grey-crow-character-pointer-index-experiment-v1";
const TRACE_SCHEMA_VERSION = "grey-crow-character-operation-trace-experiment-v1";
const NAMESPACE = "skillio_character_fixture";
const CHARACTER_REF_PATTERN = /^character-[a-f0-9]{12}$/;
const BASIS_VALUES = Object.freeze(["self_reported", "observed", "alias", "rumor"]);
const AUTHORITY_VALUES = Object.freeze([
  "observed",
  "self_reported",
  "player_claim",
  "rumor",
  "narrative_event",
  "disputed",
]);

const CHARACTER_ACTIONS = Object.freeze([
  actionSpec("remember_new_character", "记录新人物", [
    textInput("description", "可观察的人物描述", 800),
    textInput("encounter", "首次遭遇", 800),
  ]),
  actionSpec("record_character_encounter", "记录人物遭遇", [
    textInput("character", "角色稳定引用", 80),
    textInput("encounter", "本次遭遇", 800),
  ]),
  actionSpec("identify_character", "记录人物名称", [
    textInput("character", "角色稳定引用", 80),
    textInput("name", "姓名或别名", 160),
    enumInput("basis", "名称依据", BASIS_VALUES),
  ]),
  actionSpec("record_character_fact", "记录人物事实", [
    textInput("character", "角色稳定引用", 80),
    textInput("fact", "事实、自述、判断或传闻", 800),
    enumInput("authority", "事实权威层级", AUTHORITY_VALUES),
  ]),
  actionSpec("update_character_relationship", "更新人物关系", [
    textInput("character", "角色稳定引用", 80),
    textInput("relationship", "当前关系摘要", 400),
  ]),
]);

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

async function main() {
  const compiled = compileCharacterFacade();
  const compiledAgain = compileCharacterFacade();
  assert(canonicalJson(compiled) === canonicalJson(compiledAgain), "Character facade compilation must be deterministic.");
  assertCharacterModelSurface(compiled);

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-character-c1-"));
  const clock = createClock("2026-07-21T10:00:00.000Z");
  const store = createCharacterStoreFixture({ rootDir, clock, facade: compiled });
  const checks = [];

  try {
    const created = await store.execute("remember_new_character", {
      description: "戴红围巾，左手缠着旧绷带。",
      encounter: "在北站检修层首次遇见。",
    }, actionMeta(8, "turn-8-red-scarf"));
    assert(created.ok && created.outcome === "created" && created.revision === 1, "New character creation failed.");
    assert(CHARACTER_REF_PATTERN.test(created.character), "Runtime must allocate an opaque stable character ref.");
    checks.push("unknown_character_created_with_runtime_ref");

    const replayed = await store.execute("remember_new_character", {
      description: "这些内容不应在幂等重放时建立新卡。",
      encounter: "同一回合重放。",
    }, actionMeta(8, "turn-8-red-scarf"));
    assert(replayed.idempotent === true && replayed.character === created.character && replayed.revision === 1,
      "Same action identity must replay the committed receipt without a duplicate card.");
    checks.push("same_turn_idempotency");

    const identified = await store.execute("identify_character", {
      character: created.character,
      name: "沈遥",
      basis: "self_reported",
    }, actionMeta(12, "turn-12-name", 1));
    assert(identified.character === created.character && identified.revision === 2,
      "Naming a character must preserve its stable ref.");
    checks.push("rename_preserves_stable_ref");

    const restarted = createCharacterStoreFixture({ rootDir, clock, facade: compiled });
    const exactAfterRestart = await restarted.inspect("lookup", created.character);
    assert(exactAfterRestart.status === "ok"
      && exactAfterRestart.cards[0].character === created.character
      && exactAfterRestart.cards[0].preferred_name === "沈遥"
      && exactAfterRestart.cards[0].revision === 2,
    "Restarted store must recover the canonical card by exact ref.");
    checks.push("restart_exact_ref_recovery");

    await assertRejects("CHARACTER_REVISION_CONFLICT", () => restarted.execute("record_character_encounter", {
      character: created.character,
      encounter: "这次遇见不应越过冲突检查。",
    }, actionMeta(14, "turn-14-stale", 1)));
    const afterConflict = await restarted.inspect("lookup", created.character);
    assert(afterConflict.cards[0].revision === 2 && afterConflict.cards[0].encounter_count === 1,
      "Revision conflict must leave canonical state unchanged.");
    checks.push("revision_conflict_rejected_without_mutation");

    const encountered = await restarted.execute("record_character_encounter", {
      character: created.character,
      encounter: "在商场员工通道再次相遇。",
    }, actionMeta(18, "turn-18-encounter", 2));
    const fact = await restarted.execute("record_character_fact", {
      character: created.character,
      fact: "她为玩家指出了通往地下的楼梯。",
      authority: "observed",
    }, actionMeta(18, "turn-18-fact", encountered.revision));
    const relationship = await restarted.execute("update_character_relationship", {
      character: created.character,
      relationship: "刚认识，态度谨慎。",
    }, actionMeta(19, "turn-19-relationship", fact.revision));
    assert(relationship.revision === 5, "Character actions must advance one canonical revision at a time.");
    checks.push("encounter_fact_relationship_actions");

    const secondCreated = await restarted.execute("remember_new_character", {
      description: "穿灰色外套，说话很快。",
      encounter: "在南站售票厅遇见。",
    }, actionMeta(20, "turn-20-second-person"));
    await restarted.execute("identify_character", {
      character: secondCreated.character,
      name: "沈遥",
      basis: "self_reported",
    }, actionMeta(20, "turn-20-second-name", 1));
    const sameName = await restarted.inspect("lookup", "沈遥");
    assert(secondCreated.character !== created.character
      && sameName.status === "multiple_candidates"
      && sameName.candidates.length === 2,
    "Runtime must not silently merge same-name characters.");
    checks.push("same_name_returns_multiple_candidates_without_merge");

    const cardPath = path.join(rootDir, "characters", `${created.character}.md`);
    const indexPath = path.join(rootDir, "index", "character-cards.v1.json");
    await fs.rm(cardPath, { force: true });
    await fs.writeFile(indexPath, "{corrupt-index", "utf8");
    const repaired = await restarted.inspect("lookup", "左手缠着旧绷带");
    assert(repaired.status === "ok"
      && repaired.candidates[0].character === created.character
      && repaired.repair.card_projection_count >= 1
      && repaired.repair.index_rebuilt === true,
    "Lookup must rebuild missing Markdown and a corrupt derived index from canonical JSON.");
    await fs.access(cardPath);
    JSON.parse(await fs.readFile(indexPath, "utf8"));
    checks.push("derived_projection_and_index_repair");

    const records = await readCharacterRecords(rootDir);
    assert(records.length === 2 && records.every((record) => record.schema_version === RECORD_SCHEMA_VERSION),
      "C1 must keep one canonical JSON record per stable character ref.");
    const traceText = await fs.readFile(path.join(rootDir, "audit", "operations.jsonl"), "utf8");
    assert(traceText.includes(TRACE_SCHEMA_VERSION)
      && traceText.includes("state_precondition")
      && traceText.includes("canonical_commit")
      && !traceText.includes("沈遥")
      && !traceText.includes("红围巾")
      && !traceText.includes("地下的楼梯")
      && !traceText.includes(rootDir),
    "Safe trace must keep stages and receipts without character content or local paths.");
    checks.push("safe_trace_redacts_character_content_and_paths");

    const report = {
      schema_version: EXPERIMENT_SCHEMA_VERSION,
      status: "passed",
      experiment_date: "2026-07-21",
      scope: "isolated_character_companion_and_privileged_store_fixture",
      provider_calls: 0,
      production_pack_changed: false,
      production_router_changed: false,
      production_store_changed: false,
      source_companion: {
        schema_version: compiled.sourceCompanion.schemaVersion,
        namespace: compiled.sourceCompanion.namespace,
        read_views: compiled.sourceCompanion.readViews.map((view) => view.id),
        action_ids: compiled.sourceCompanion.actions.map((action) => action.id),
        canonical_sha256: sha256(canonicalJson(compiled.sourceCompanion)),
      },
      model_surface: compiled.actions.map((action) => ({
        id: action.id,
        tool_name: action.toolName,
        fields: action.modelInput.fields.map((field) => field.name),
        required: action.modelInput.required,
      })),
      checks,
      observed_character_count: records.length,
      decision: {
        semantic_policy_source: "initial entity-memory behavior plus Character Skill C0",
        stable_identity_owner: "runtime",
        identity_decision_owner: "ai_after_bounded_lookup",
        canonical_source: "characters/<character-ref>.json",
        markdown_and_index: "runtime_generated_rebuildable_projection",
        c2_contract_requirement: "a versioned built-in-domain companion target; ordinary module field mapping must not be reused as a fake character database",
      },
      limitations: [
        "This fixture is not loaded by a Pack, snapshot, Router, Provider, or real Adventure.",
        "The production companion v1 only targets ordinary module fields; the Character facade therefore remains an isolated derived built-in-domain experiment.",
        "C2 still requires a separately reviewed contract for privileged character_records routing and must hide the legacy competing write tool in new snapshots.",
        "Real model behavior, restart after process crash, compaction retrieval quality, and 50-turn acceptance remain unproven.",
      ],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function compileCharacterFacade() {
  const normalized = normalizeSkillModuleCreatorDraft(createSourceDraft(), {
    identitySeed: "grey-crow-built-in-characters-c1",
    requireRoundTrip: true,
  });
  const sourceActions = new Map(normalized.companion.actions.map((action) => [action.id, action]));
  const actions = CHARACTER_ACTIONS.map((spec) => {
    const source = sourceActions.get(spec.id);
    assert(source, `Production companion compiler did not produce ${spec.id}.`);
    return deepFreeze({
      id: spec.id,
      toolName: `${spec.id}_${sha256(`${normalized.companion.namespace}:${spec.id}`).slice(0, 10)}`,
      label: spec.label,
      modelInput: {
        fields: spec.inputs.map((input) => ({
          name: input.name,
          type: input.type,
          description: input.description,
          ...(input.maxLength ? { maxLength: input.maxLength } : {}),
          ...(input.enum ? { enum: [...input.enum] } : {}),
        })),
        required: spec.inputs.filter((input) => input.required).map((input) => input.name),
      },
      runtimeMapping: {
        capability: "character_records",
        operation: spec.id,
        sourceActionId: source.id,
        sourceActionToolName: source.toolName,
      },
    });
  });
  return deepFreeze({
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    namespace: normalized.companion.namespace,
    defaultView: "overview",
    readViews: normalized.companion.readViews,
    actions,
    sourceCompanion: normalized.companion,
    sourceDefinition: normalized.definition,
  });
}

function createSourceDraft() {
  return {
    schemaVersion: CREATOR_FACADE_DRAFT_VERSION,
    enabled: true,
    skillIOEnabled: true,
    namespace: NAMESPACE,
    fields: [
      recordField({
        id: "character_directory",
        label: "角色目录",
        views: ["overview", "recent", "lookup"],
        itemFields: [textItem("character", "角色引用", 80)],
      }),
      recordField({
        id: "new_character_requests",
        label: "新人物请求",
        actionId: "remember_new_character",
        actionLabel: "记录新人物",
        itemFields: [textItem("description", "可观察描述", 800), textItem("encounter", "首次遭遇", 800)],
      }),
      recordField({
        id: "encounter_requests",
        label: "遭遇请求",
        actionId: "record_character_encounter",
        actionLabel: "记录人物遭遇",
        itemFields: [textItem("character", "角色引用", 80), textItem("encounter", "遭遇", 800)],
      }),
      recordField({
        id: "identity_requests",
        label: "名称请求",
        actionId: "identify_character",
        actionLabel: "记录人物名称",
        itemFields: [
          textItem("character", "角色引用", 80),
          textItem("name", "姓名或别名", 160),
          enumItem("basis", "名称依据", BASIS_VALUES),
        ],
      }),
      recordField({
        id: "fact_requests",
        label: "事实请求",
        actionId: "record_character_fact",
        actionLabel: "记录人物事实",
        itemFields: [
          textItem("character", "角色引用", 80),
          textItem("fact", "事实内容", 800),
          enumItem("authority", "权威层级", AUTHORITY_VALUES),
        ],
      }),
      recordField({
        id: "relationship_requests",
        label: "关系请求",
        actionId: "update_character_relationship",
        actionLabel: "更新人物关系",
        itemFields: [textItem("character", "角色引用", 80), textItem("relationship", "关系摘要", 400)],
      }),
    ],
  };
}

function recordField({ id, label, views = [], actionId = null, actionLabel = null, itemFields }) {
  return {
    id,
    label,
    type: "record_list",
    widget: "cards",
    modelWritable: Boolean(actionId),
    showInSummary: id === "character_directory",
    views,
    hostAction: actionId ? { id: actionId, label: actionLabel, behavior: "append_record" } : null,
    maxItems: 100,
    collectionMode: "append_only",
    itemFields,
    previewRecordEnabled: false,
    summaryMode: id === "character_directory" ? "count" : "none",
    summaryTarget: null,
    milestones: [],
    groupCountItemIndex: null,
  };
}

function textItem(id, label, maxLength) {
  return { id, label, type: "text", maxLength, preview: "示例" };
}

function enumItem(id, label, values) {
  return {
    id,
    label,
    type: "enum",
    options: values.map((value) => ({ id: value, label: value })),
    previewOptionIndex: 0,
  };
}

function createCharacterStoreFixture(options) {
  const rootDir = options.rootDir;
  const clock = options.clock;
  const facade = options.facade;
  const actionById = new Map(facade.actions.map((action) => [action.id, action]));

  async function execute(actionId, rawArgs, rawMeta) {
    const action = actionById.get(actionId);
    if (!action) throw characterError("CHARACTER_ACTION_NOT_AVAILABLE", "Character action is not declared.");
    const args = validateActionArguments(action, rawArgs);
    const meta = validateActionMeta(rawMeta);
    const actionKey = sha256(`${actionId}:${meta.turn}:${meta.actionIdentity}`);
    const replay = await findAppliedAction(rootDir, actionKey);
    if (replay) {
      await appendSafeTrace(rootDir, traceEntry(action, args, meta, {
        stage: "idempotent_replay",
        ok: true,
        character: replay.character_ref,
        beforeRevision: replay.revision,
        afterRevision: replay.revision,
        idempotent: true,
      }));
      return deepFreeze({
        ok: true,
        action: actionId,
        character: replay.character_ref,
        outcome: replay.outcome,
        revision: replay.revision,
        idempotent: true,
      });
    }

    let current = null;
    let next;
    try {
      if (actionId === "remember_new_character") {
        const characterRef = `character-${actionKey.slice(0, 12)}`;
        current = await readCharacterRecord(rootDir, characterRef);
        if (current) throw characterError("CHARACTER_ID_COLLISION", "Generated character identity already exists.");
        next = createCharacterRecord(characterRef, args, meta, actionKey, clock());
      } else {
        const characterRef = requireCharacterRef(args.character);
        current = await readCharacterRecord(rootDir, characterRef);
        if (!current) throw characterError("CHARACTER_NOT_FOUND", "Character record was not found.");
        if (meta.expectedRevision !== null && current.revision !== meta.expectedRevision) {
          throw characterError("CHARACTER_REVISION_CONFLICT", "Character record changed after Runtime read it.", {
            expected_revision: meta.expectedRevision,
            actual_revision: current.revision,
          });
        }
        next = updateCharacterRecord(current, actionId, args, meta, actionKey, clock());
      }
    } catch (error) {
      await appendSafeTrace(rootDir, traceEntry(action, args, meta, {
        stage: "state_precondition",
        ok: false,
        character: args.character || null,
        beforeRevision: current?.revision ?? null,
        afterRevision: current?.revision ?? null,
        errorCode: error?.code || "CHARACTER_ACTION_FAILED",
      }));
      throw error;
    }

    await writeCharacterRecord(rootDir, next);
    let projection = { status: "ready", card_projection_count: 0, index_rebuilt: false };
    try {
      projection = await repairDerived(rootDir);
    } catch {
      projection = { status: "degraded", card_projection_count: 0, index_rebuilt: false };
    }
    await appendSafeTrace(rootDir, traceEntry(action, args, meta, {
      stage: "canonical_commit",
      ok: true,
      character: next.character_ref,
      beforeRevision: current?.revision ?? 0,
      afterRevision: next.revision,
      projectionStatus: projection.status,
    }));
    return deepFreeze({
      ok: true,
      action: actionId,
      character: next.character_ref,
      outcome: current ? "updated" : "created",
      revision: next.revision,
      idempotent: false,
      projection_status: projection.status,
    });
  }

  async function inspect(view = facade.defaultView, query = "") {
    if (!["guide", "overview", "recent", "lookup"].includes(view)) {
      throw characterError("CHARACTER_VIEW_INVALID", "Character view is not declared.");
    }
    const repair = await repairDerived(rootDir);
    const records = await readCharacterRecords(rootDir);
    if (view === "guide") {
      return deepFreeze({
        status: "ok",
        guide: "先检索，再由 AI 判断创建或更新；Runtime 不按名称自动合并。",
        repair,
      });
    }
    const pointers = records.map(projectPointer).sort(compareRecent);
    if (view === "overview") {
      return deepFreeze({
        status: "ok",
        character_count: pointers.length,
        unnamed_count: pointers.filter((entry) => !entry.preferred_name).length,
        recent: pointers.slice(0, 5),
        repair,
      });
    }
    if (view === "recent") return deepFreeze({ status: pointers.length ? "ok" : "not_found", candidates: pointers.slice(0, 5), repair });

    const normalized = normalizeSearch(query);
    const exact = records.find((record) => record.character_ref === normalized);
    if (exact) return deepFreeze({ status: "ok", cards: [projectCard(exact)], candidates: [projectPointer(exact)], repair });
    const index = await readIndex(rootDir);
    const candidates = index.entries
      .filter((entry) => !normalized || entry.search_text.includes(normalized))
      .slice(0, 5)
      .map(({ search_text, ...entry }) => entry);
    return deepFreeze({
      status: candidates.length === 0 ? "not_found" : candidates.length === 1 ? "ok" : "multiple_candidates",
      candidates,
      repair,
    });
  }

  return deepFreeze({ execute, inspect });
}

function createCharacterRecord(characterRef, args, meta, actionKey, timestamp) {
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    record_type: "character",
    character_ref: characterRef,
    revision: 1,
    preferred_name: "",
    aliases: [],
    name_claims: [],
    observed_description: cleanText(args.description, 800),
    facts: [],
    relationship: "",
    encounters: [{
      id: `encounter-${actionKey.slice(0, 12)}`,
      text: cleanText(args.encounter, 800),
      turn: meta.turn,
      location: cleanText(meta.location, 160),
    }],
    created_turn: meta.turn,
    updated_turn: meta.turn,
    created_at: timestamp,
    updated_at: timestamp,
    runtime: { applied_actions: [{ key: actionKey, outcome: "created", revision: 1 }] },
  };
}

function updateCharacterRecord(current, actionId, args, meta, actionKey, timestamp) {
  const next = clone(current);
  const revision = current.revision + 1;
  if (actionId === "record_character_encounter") {
    next.encounters.push({
      id: `encounter-${actionKey.slice(0, 12)}`,
      text: cleanText(args.encounter, 800),
      turn: meta.turn,
      location: cleanText(meta.location, 160),
    });
  } else if (actionId === "identify_character") {
    const name = cleanText(args.name, 160);
    next.name_claims.push({ name, basis: args.basis, turn: meta.turn });
    if (args.basis === "alias") {
      if (!next.aliases.includes(name)) next.aliases.push(name);
    } else {
      if (next.preferred_name && next.preferred_name !== name && !next.aliases.includes(next.preferred_name)) {
        next.aliases.push(next.preferred_name);
      }
      next.preferred_name = name;
    }
  } else if (actionId === "record_character_fact") {
    next.facts.push({
      id: `fact-${actionKey.slice(0, 12)}`,
      text: cleanText(args.fact, 800),
      authority: args.authority,
      turn: meta.turn,
      status: args.authority === "disputed" ? "disputed" : "active",
    });
  } else if (actionId === "update_character_relationship") {
    next.relationship = cleanText(args.relationship, 400);
  } else {
    throw characterError("CHARACTER_ACTION_NOT_AVAILABLE", "Character action is not supported by the fixture.");
  }
  next.revision = revision;
  next.updated_turn = meta.turn;
  next.updated_at = timestamp;
  next.runtime.applied_actions.push({ key: actionKey, outcome: "updated", revision });
  next.runtime.applied_actions = next.runtime.applied_actions.slice(-64);
  return next;
}

async function repairDerived(rootDir) {
  const records = await readCharacterRecords(rootDir);
  let cardProjectionCount = 0;
  for (const record of records) {
    const target = path.join(rootDir, "characters", `${record.character_ref}.md`);
    const expected = renderCharacterCard(record);
    const actual = await fs.readFile(target, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (actual !== expected) {
      await writeTextAtomic(target, expected);
      cardProjectionCount += 1;
    }
  }
  const index = {
    schema_version: INDEX_SCHEMA_VERSION,
    entries: records.map((record) => ({
      ...projectPointer(record),
      search_text: normalizeSearch([
        record.character_ref,
        record.preferred_name,
        ...(record.aliases || []),
        record.observed_description,
        ...(record.encounters || []).slice(-3).map((entry) => `${entry.location} ${entry.text}`),
      ].join(" ")),
    })).sort((left, right) => left.character.localeCompare(right.character)),
  };
  const indexPath = path.join(rootDir, "index", "character-cards.v1.json");
  const actualIndex = await fs.readFile(indexPath, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  const expectedIndex = `${JSON.stringify(index, null, 2)}\n`;
  let indexRebuilt = false;
  if (actualIndex !== expectedIndex) {
    await writeTextAtomic(indexPath, expectedIndex);
    indexRebuilt = true;
  }
  return deepFreeze({
    status: "ready",
    card_projection_count: cardProjectionCount,
    index_rebuilt: indexRebuilt,
  });
}

async function readIndex(rootDir) {
  const value = JSON.parse(await fs.readFile(path.join(rootDir, "index", "character-cards.v1.json"), "utf8"));
  if (value.schema_version !== INDEX_SCHEMA_VERSION || !Array.isArray(value.entries)) {
    throw characterError("CHARACTER_INDEX_INVALID", "Character pointer index is invalid.");
  }
  return value;
}

async function findAppliedAction(rootDir, key) {
  const records = await readCharacterRecords(rootDir);
  for (const record of records) {
    const applied = record.runtime?.applied_actions?.find((entry) => entry.key === key);
    if (applied) return { ...applied, character_ref: record.character_ref };
  }
  return null;
}

async function readCharacterRecords(rootDir) {
  const directory = path.join(rootDir, "characters");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
    validateCharacterRecord(record);
    records.push(record);
  }
  return records;
}

async function readCharacterRecord(rootDir, characterRef) {
  const target = path.join(rootDir, "characters", `${requireCharacterRef(characterRef)}.json`);
  const text = await fs.readFile(target, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (text === null) return null;
  const record = JSON.parse(text);
  validateCharacterRecord(record);
  return record;
}

async function writeCharacterRecord(rootDir, record) {
  validateCharacterRecord(record);
  await writeTextAtomic(path.join(rootDir, "characters", `${record.character_ref}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

function validateCharacterRecord(record) {
  if (!record || record.schema_version !== RECORD_SCHEMA_VERSION || record.record_type !== "character"
    || !CHARACTER_REF_PATTERN.test(record.character_ref) || !Number.isInteger(record.revision) || record.revision < 1
    || !Array.isArray(record.encounters) || !Array.isArray(record.facts)
    || !Array.isArray(record.name_claims) || !Array.isArray(record.runtime?.applied_actions)) {
    throw characterError("CHARACTER_RECORD_INVALID", "Character canonical record is invalid.");
  }
}

function renderCharacterCard(record) {
  const observedFacts = record.facts.filter((entry) => ["observed", "narrative_event"].includes(entry.authority));
  const uncertainFacts = record.facts.filter((entry) => !["observed", "narrative_event"].includes(entry.authority));
  const lines = [
    "---",
    `schema_version: grey-crow-character-card-projection-v1`,
    `character_ref: ${record.character_ref}`,
    `revision: ${record.revision}`,
    `preferred_name: ${JSON.stringify(record.preferred_name || "")}`,
    `updated_turn: ${record.updated_turn}`,
    "---",
    "",
    `# ${record.preferred_name || "未命名人物"}`,
    "",
    "## 可观察特征",
    "",
    record.observed_description || "暂无。",
    "",
    "## 身份与名称声明",
    "",
    ...listOrEmpty(record.name_claims.map((entry) => `${entry.name}（${entry.basis}，turn ${entry.turn}）`)),
    "",
    "## 已发生与可观察事实",
    "",
    ...listOrEmpty(observedFacts.map((entry) => `${entry.text}（${entry.authority}，turn ${entry.turn}）`)),
    "",
    "## 玩家判断、传闻与争议",
    "",
    ...listOrEmpty(uncertainFacts.map((entry) => `${entry.text}（${entry.authority}，turn ${entry.turn}）`)),
    "",
    "## 当前关系",
    "",
    record.relationship || "暂无。",
    "",
    "## 最近遭遇",
    "",
    ...listOrEmpty(record.encounters.slice(-5).reverse().map((entry) => `turn ${entry.turn}${entry.location ? ` · ${entry.location}` : ""} · ${entry.text}`)),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function listOrEmpty(values) {
  return values.length ? values.map((value) => `- ${value}`) : ["- 暂无。"];
}

function projectPointer(record) {
  const recent = record.encounters[record.encounters.length - 1] || null;
  return {
    character: record.character_ref,
    preferred_name: record.preferred_name,
    aliases: [...record.aliases],
    observable_anchor: record.observed_description.slice(0, 160),
    last_seen_turn: recent?.turn ?? record.updated_turn,
    last_seen_location: recent?.location || "",
    revision: record.revision,
  };
}

function projectCard(record) {
  return {
    ...projectPointer(record),
    description: record.observed_description,
    name_claims: clone(record.name_claims),
    facts: clone(record.facts),
    relationship: record.relationship,
    encounters: clone(record.encounters.slice(-5)),
    encounter_count: record.encounters.length,
  };
}

function compareRecent(left, right) {
  return right.last_seen_turn - left.last_seen_turn || left.character.localeCompare(right.character);
}

async function appendSafeTrace(rootDir, entry) {
  const target = path.join(rootDir, "audit", "operations.jsonl");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

function traceEntry(action, args, meta, result) {
  return {
    schema_version: TRACE_SCHEMA_VERSION,
    action: action.id,
    action_identity_hash: sha256(meta.actionIdentity).slice(0, 16),
    turn: meta.turn,
    model_surface: {
      argument_keys: Object.keys(args).sort(),
      argument_shapes: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, {
        kind: typeof value,
        ...(typeof value === "string" ? { length: value.length, value_hash: sha256(value).slice(0, 16) } : {}),
      }])),
    },
    runtime_translation: {
      capability: "character_records",
      operation: action.id,
      validation_stage: result.stage,
    },
    write_receipt: {
      ok: result.ok,
      character: result.character || null,
      before_revision: result.beforeRevision,
      after_revision: result.afterRevision,
      idempotent: result.idempotent === true,
      projection_status: result.projectionStatus || null,
      error_code: result.errorCode || null,
    },
  };
}

function validateActionArguments(action, value) {
  const args = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!args) throw characterError("CHARACTER_ACTION_INVALID", "Character action arguments must be an object.");
  const fieldByName = new Map(action.modelInput.fields.map((field) => [field.name, field]));
  const keys = Object.keys(args);
  if (keys.some((key) => !fieldByName.has(key))
    || action.modelInput.required.some((key) => !Object.prototype.hasOwnProperty.call(args, key))) {
    throw characterError("CHARACTER_ACTION_INVALID", "Character action arguments do not match the compiled model surface.");
  }
  const normalized = {};
  for (const [key, raw] of Object.entries(args)) {
    const field = fieldByName.get(key);
    if (field.type !== "string" || typeof raw !== "string") {
      throw characterError("CHARACTER_ACTION_INVALID", "Character action argument has an invalid type.");
    }
    const text = cleanText(raw, field.maxLength || 160);
    if (!text || (field.enum && !field.enum.includes(text))) {
      throw characterError("CHARACTER_ACTION_INVALID", "Character action argument has an invalid value.");
    }
    normalized[key] = text;
  }
  return normalized;
}

function validateActionMeta(value) {
  const meta = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (!Number.isInteger(meta.turn) || meta.turn < 0 || typeof meta.actionIdentity !== "string" || !meta.actionIdentity.trim()) {
    throw characterError("CHARACTER_RUNTIME_META_INVALID", "Character Runtime metadata is invalid.");
  }
  const expectedRevision = meta.expectedRevision === null || meta.expectedRevision === undefined
    ? null
    : Number.isInteger(meta.expectedRevision) && meta.expectedRevision >= 1 ? meta.expectedRevision : NaN;
  if (Number.isNaN(expectedRevision)) throw characterError("CHARACTER_RUNTIME_META_INVALID", "Character revision metadata is invalid.");
  return {
    turn: meta.turn,
    actionIdentity: meta.actionIdentity.trim().slice(0, 160),
    expectedRevision,
    location: cleanText(meta.location, 160),
  };
}

function assertCharacterModelSurface(compiled) {
  assert(compiled.sourceCompanion.schemaVersion === "grey-crow-skill-io-companion-v1", "C1 must start from the production companion compiler.");
  assert(compiled.readViews.map((view) => view.id).join(",") === "guide,overview,recent,lookup", "Character views changed.");
  assert(compiled.actions.length === 5, "Character facade must expose exactly five semantic actions.");
  const expected = new Map(CHARACTER_ACTIONS.map((action) => [action.id, action.inputs.map((input) => input.name).join(",")]));
  for (const action of compiled.actions) {
    assert(action.modelInput.fields.map((field) => field.name).join(",") === expected.get(action.id), `Unexpected model fields for ${action.id}.`);
    const publicSurface = JSON.stringify({
      toolName: action.toolName,
      label: action.label,
      modelInput: action.modelInput,
    });
    assert(!/(?:path|file|revision|fieldId|moduleRef|operation|permission|schemaBody)/i.test(publicSurface),
      `Internal protocol leaked into ${action.id} model surface.`);
  }
}

function actionMeta(turn, actionIdentity, expectedRevision = null) {
  return { turn, actionIdentity, expectedRevision, location: turn < 15 ? "北站检修层" : "商场员工通道" };
}

function actionSpec(id, label, inputs) {
  return deepFreeze({ id, label, inputs });
}

function textInput(name, description, maxLength, required = true) {
  return deepFreeze({ name, type: "string", description, maxLength, required });
}

function enumInput(name, description, values) {
  return deepFreeze({ name, type: "string", description, enum: [...values], required: true });
}

function requireCharacterRef(value) {
  const ref = String(value || "").trim();
  if (!CHARACTER_REF_PATTERN.test(ref)) throw characterError("CHARACTER_REF_INVALID", "Character ref is invalid.");
  return ref;
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function writeTextAtomic(target, text) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(temporary, target);
}

function createClock(start) {
  let value = Date.parse(start);
  return () => {
    const result = new Date(value).toISOString();
    value += 1000;
    return result;
  };
}

function characterError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.meta = meta;
  return error;
}

async function assertRejects(code, callback) {
  try {
    await callback();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`Expected ${code}, received ${error?.code || error?.message || "unknown"}.`);
  }
  throw new Error(`Expected ${code}.`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
