"use strict";

const path = require("node:path");
const { createDesktopContentLibrary } = require("./content-library");

function createDesktopContentManagement(options = {}) {
  const dataRoot = requireAbsolute(options.dataRoot, "dataRoot");
  const contentRoot = requireAbsolute(options.contentRoot, "contentRoot");
  const engineRoot = requireAbsolute(options.engineRoot || path.join(resolveRuntimeRoot(), "engine"), "engineRoot");
  const { createPlayerProfileStore, normalizeSkillModuleCreatorDraft } = require(path.join(engineRoot, "content-v2"));
  const { projectSkillModulePreview } = require(path.join(engineRoot, "content-v2", "skill-module-preview"));
  const { createSkillPanelPreviewService: createSkillPanelProjectionService } = require(path.join(engineRoot, "content-v2", "skill-panel-preview"));
  const library = createDesktopContentLibrary({ dataRoot, contentRoot, engineRoot });
  const profileStore = createPlayerProfileStore({
    profileRoot: path.join(dataRoot, "player-profile"),
    clock: options.clock,
  });

  async function listContent() {
    const value = await library.initialize();
    return projectLibrary(value, await library.listNewGamePresets());
  }

  async function importContent(input = {}) {
    void input;
    throw managementError("CONTENT_IMPORT_DISABLED", "Third-party content import is disabled for this release.");
  }

  async function cloneContent(input = {}) {
    const pack = await library.clonePack(requirePackId(input.packId), {
      newPackId: requirePackId(input.newPackId),
      title: normalizeText(input.title, 240, "CONTENT_CLONE_TITLE_INVALID"),
      author: normalizeText(input.author || "Player", 240, "CONTENT_CLONE_AUTHOR_INVALID"),
    });
    return Object.freeze({ ok: true, pack: projectPack(pack), library: await listContent() });
  }

  async function createBlankContent(input = {}) {
    const profile = await profileStore.load();
    const item = await library.createBlankContent({
      kind: normalizeBlankContentKind(input.kind),
      title: normalizeText(input.title, 240, "CONTENT_BLANK_TITLE_INVALID"),
      language: normalizeText(input.language, 35, "CONTENT_BLANK_LANGUAGE_INVALID"),
      description: normalizeText(input.description, 1200, "CONTENT_BLANK_DESCRIPTION_INVALID"),
      markdown: input.markdown,
      triggers: input.triggers,
      ...(Object.prototype.hasOwnProperty.call(input, "playerGuide") ? { playerGuide: input.playerGuide } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "moduleDraft") ? { moduleDraft: input.moduleDraft } : {}),
      author: profile.profile.displayName || "Player",
    });
    return Object.freeze({
      ok: true,
      item: projectEditableItem(item),
      library: await listContent(),
      localPathsExposed: false,
    });
  }

  async function exportContent(input = {}) {
    const result = await library.exportPack(
      requirePackId(input.packId),
      requireAbsolute(input.destinationRoot, "destinationRoot")
    );
    return Object.freeze({
      ok: true,
      packId: result.packId,
      files: result.files,
      destinationExposed: false,
    });
  }

  async function deleteContent(input = {}) {
    const result = await library.deletePack(requirePackId(input.packId));
    return Object.freeze({ ok: true, packId: result.packId, library: await listContent() });
  }

  async function loadEditableContent(input = {}) {
    const item = await library.readEditableItem(
      requirePackId(input.packId),
      requireItemId(input.itemId)
    );
    return Object.freeze({ ok: true, item: projectEditableItem(item), localPathsExposed: false });
  }

  async function saveEditableContent(input = {}) {
    const item = await library.saveEditableItem(
      requirePackId(input.packId),
      requireItemId(input.itemId),
      {
        expectedRevision: normalizeRevision(input.expectedRevision),
        title: input.title,
        language: input.language,
        description: input.description,
        danger: input.danger,
        markdown: input.markdown,
        triggers: input.triggers,
        readScopes: input.readScopes,
        writeScopes: input.writeScopes,
        templates: input.templates,
        ...(Object.prototype.hasOwnProperty.call(input, "playerGuide") ? { playerGuide: input.playerGuide } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "moduleDraft") ? { moduleDraft: input.moduleDraft } : {}),
      }
    );
    return Object.freeze({
      ok: true,
      item: projectEditableItem(item),
      library: await listContent(),
      localPathsExposed: false,
    });
  }

  async function saveContentPreset(input = {}) {
    const preset = await library.saveNewGamePreset(requirePackId(input.packId), {
      itemId: input.itemId ? requireItemId(input.itemId) : null,
      expectedRevision: input.expectedRevision || null,
      title: normalizeText(input.title, 240, "CONTENT_PRESET_TITLE_INVALID"),
      description: normalizeText(input.description, 1200, "CONTENT_PRESET_DESCRIPTION_INVALID"),
      language: normalizeText(input.language, 35, "CONTENT_PRESET_LANGUAGE_INVALID"),
      selection: input.selection,
    });
    return Object.freeze({ ok: true, preset: projectPreset(preset), library: await listContent() });
  }

  async function previewSkillModule(input = {}) {
    const normalized = normalizeSkillModuleCreatorDraft(input.moduleDraft);
    if (!normalized.definition) {
      return Object.freeze({
        ok: true,
        draft: normalized.draft,
        panelSurface: normalized.panelSurface,
        projection: null,
        panelProjection: null,
        panelListProjection: null,
        panelDetailProjection: null,
        localPathsExposed: false,
      });
    }
    const triggers = Array.isArray(input.triggers)
      ? input.triggers.map((item) => stableText(item, 120)).filter(Boolean).slice(0, 32)
      : [];
    const previewValues = addPreviewRecordIdentity(normalized.definition, normalized.previewValues);
    const moduleProjection = projectSkillModulePreview({
      title: normalizeText(input.title, 240, "CONTENT_MODULE_PREVIEW_INVALID"),
      packTitle: "本地创作预览",
      description: normalizeText(input.description, 1200, "CONTENT_MODULE_PREVIEW_INVALID"),
      playerGuide: stableText(input.playerGuide, 2000) || null,
      triggers,
      definition: normalized.definition,
      values: previewValues,
    });
    const panelPreview = await projectSkillPanelPreview({
      adventureRoot: path.join(dataRoot, "creator-panel-preview"),
      title: normalizeText(input.title, 240, "CONTENT_MODULE_PREVIEW_INVALID"),
      language: normalizeText(input.language || "en-US", 35, "CONTENT_MODULE_PREVIEW_INVALID"),
      description: normalizeText(input.description, 1200, "CONTENT_MODULE_PREVIEW_INVALID"),
      playerGuide: stableText(input.playerGuide, 2000) || null,
      triggers,
      definition: normalized.definition,
      previewValues,
      moduleProjection,
      panelSurface: normalized.panelSurface,
      createSkillPanelProjectionService,
    });
    const projection = Object.freeze({
      ...moduleProjection,
      skillIO: normalized.companion ? Object.freeze({
        enabled: true,
        defaultView: normalized.companion.defaultView,
        readViews: Object.freeze(normalized.companion.readViews.map((view) => view.id)),
        actions: Object.freeze(normalized.companion.actions.map((action) => Object.freeze({
          label: stableText(action.label, 120),
          behavior: stableText(action.archetype, 64),
        }))),
      }) : Object.freeze({ enabled: false, defaultView: null, readViews: Object.freeze([]), actions: Object.freeze([]) }),
    });
    return Object.freeze({
      ok: true,
      draft: normalized.draft,
      panelSurface: normalized.panelSurface,
      projection,
      panelProjection: panelPreview.overview,
      panelListProjection: panelPreview.list,
      panelDetailProjection: panelPreview.detail,
      localPathsExposed: false,
    });
  }

  async function loadPlayerProfile() {
    return projectProfile(await profileStore.load());
  }

  async function savePlayerProfile(input = {}) {
    return projectProfile(await profileStore.save(input.fields));
  }

  return Object.freeze({
    cloneContent,
    createBlankContent,
    deleteContent,
    exportContent,
    importContent,
    listContent,
    loadEditableContent,
    loadPlayerProfile,
    previewSkillModule,
    saveEditableContent,
    saveContentPreset,
    savePlayerProfile,
  });
}

function addPreviewRecordIdentity(definition, values) {
  const projected = JSON.parse(JSON.stringify(values || {}));
  for (const field of definition.fields || []) {
    if (field.type !== "record_list" || !Array.isArray(projected[field.id])) continue;
    projected[field.id] = projected[field.id].map((record, index) => ({
      entry_id: `preview_item_${index + 1}`,
      created_turn: index + 1,
      ...record,
    }));
  }
  return projected;
}

async function projectSkillPanelPreview(input = {}) {
  const moduleRef = input.moduleProjection.moduleRef;
  const panelRef = "panel_00000000000000000000000000000000";
  const panel = {
    panelRef,
    sourceKind: "ordinary_skill",
    ownership: "player_owned",
    group: "player_extensions",
    sortOrder: 2000,
    title: input.title,
    language: input.language,
    description: input.description,
    triggers: [...input.triggers],
    playerGuide: input.playerGuide,
    surface: input.panelSurface,
    ordinarySource: {
      packId: "player-preview",
      itemId: "skill-preview",
      hasModule: true,
      moduleRef,
      visibility: "visible",
    },
    domainSource: null,
  };
  const snapshot = {
    profile: { features: ["skill-panel-presentation-v2"] },
    lock: { features: ["skill-panel-presentation-v2"] },
    content: {
      skillPanelsV2: {
        schemaVersion: "grey-crow-skill-panel-presentation-v2",
        panels: [panel],
      },
      skills: [{
        id: "skill-preview",
        module: {
          moduleRef,
          definition: input.definition,
        },
      }],
    },
  };
  const moduleProjection = {
    async getCurrentSkillModule(request = {}) {
      if (!request.fieldId) return input.moduleProjection;
      const field = input.moduleProjection.fields.find((entry) => entry.id === request.fieldId);
      if (!field || field.type !== "record_list") {
        const error = new Error("Preview record field is unavailable.");
        error.code = "SKILL_MODULE_FIELD_UNKNOWN";
        throw error;
      }
      const limit = Number.isInteger(request.limit) ? request.limit : 12;
      const values = Array.isArray(field.value) ? field.value.slice(0, limit) : [];
      return {
        ...input.moduleProjection,
        fields: [{ ...field, value: values }],
        pagination: {
          fieldId: field.id,
          nextCursor: null,
          hasMore: false,
          returnedItems: values.length,
          totalItems: Array.isArray(field.value) ? field.value.length : 0,
        },
      };
    },
  };
  const service = input.createSkillPanelProjectionService({
    adventureRoot: input.adventureRoot,
    snapshotLoader: async () => snapshot,
    stateStore: {
      async read() {
        return {
          activated: true,
          stateVersion: 1,
          revision: 0,
          values: input.previewValues,
        };
      },
    },
    moduleProjection,
  });
  const overview = (await service.getCurrentSkillPanel({ panelRef, view: "overview" })).panel;
  const recordField = ["list_detail", "timeline"].includes(input.panelSurface)
    ? input.definition.fields.find((field) => field.type === "record_list") || null
    : null;
  if (!recordField) {
    return Object.freeze({ overview, list: null, detail: null });
  }
  const list = (await service.getCurrentSkillPanel({
    panelRef,
    view: "list",
    fieldId: recordField.id,
    limit: 12,
  })).panel;
  const detail = list.items.length > 0
    ? (await service.getCurrentSkillPanel({
        panelRef,
        view: "detail",
        fieldId: recordField.id,
        itemRef: list.items[0].ref,
      })).panel
    : null;
  return Object.freeze({ overview, list, detail });
}

function projectLibrary(value = {}, presets = []) {
  return Object.freeze({
    schemaVersion: value.schemaVersion || "grey-crow-content-library-v2",
    packs: Object.freeze((value.packs || []).map(projectPack)),
    presets: Object.freeze((presets || []).map(projectPreset)),
    localPathsExposed: false,
  });
}

function projectPack(value = {}) {
  return Object.freeze({
    id: stableText(value.id, 64),
    title: stableText(value.title, 240),
    version: stableText(value.version, 64),
    languages: Object.freeze((value.languages || []).slice(0, 16).map((item) => stableText(item, 32))),
    ownership: normalizeOwnership(value.ownership),
    activation: normalizeActivation(value.activation, value.ownership),
    status: value.status === "valid" ? "valid" : "invalid",
    editable: value.editable === true,
    itemCount: boundedInteger(value.itemCount, 0, 4096),
    errorCode: stableErrorCode(value.errorCode),
    items: Object.freeze((value.items || []).slice(0, 4096).map((item) => Object.freeze({
      id: stableText(item.id, 64),
      type: ["host", "world", "skill"].includes(item.type) ? item.type : "unknown",
      title: stableText(item.title, 240),
      language: stableText(item.language, 32),
      description: stableText(item.description, 800),
      danger: ["low", "medium", "high", "critical"].includes(item.danger) ? item.danger : "medium",
      skillClass: item.type === "skill" && ["ordinary", "new_game"].includes(item.skillClass) ? item.skillClass : null,
      triggers: Object.freeze((item.triggers || []).slice(0, 64).map((entry) => stableText(entry, 160))),
      readScopes: Object.freeze((item.readScopes || []).slice(0, 32).map((entry) => stableText(entry, 160))),
      writeScopes: Object.freeze((item.writeScopes || []).slice(0, 32).map((entry) => stableText(entry, 160))),
      playerGuide: stableText(item.playerGuide, 2000) || null,
      hasModule: item.hasModule === true,
      hasSkillIO: item.hasSkillIO === true,
      replaces: item.replaces ? Object.freeze({
        packId: stableText(item.replaces.packId, 64),
        itemId: stableText(item.replaces.itemId, 64),
      }) : null,
    }))),
  });
}

function projectPreset(value = {}) {
  return Object.freeze({
    packId: stableText(value.packId, 64),
    packTitle: stableText(value.packTitle, 240),
    packVersion: stableText(value.packVersion, 64),
    ownership: normalizeOwnership(value.ownership),
    itemId: stableText(value.itemId, 64),
    title: stableText(value.title, 240),
    language: stableText(value.language, 35),
    description: stableText(value.description, 1200),
    revision: /^[a-f0-9]{64}$/.test(String(value.revision || "")) ? value.revision : null,
    selection: Object.freeze({
      host: projectRef(value.selection?.host),
      world: projectRef(value.selection?.world),
      newGameSkill: projectRef(value.selection?.newGameSkill),
      skills: Object.freeze((value.selection?.skills || []).slice(0, 32).map(projectRef)),
      optionalSkills: Object.freeze((value.selection?.optionalSkills || []).slice(0, 32).map((item) => Object.freeze({
        ...projectRef(item),
        defaultEnabled: item.defaultEnabled === true,
      }))),
    }),
  });
}

function projectRef(value = {}) {
  return Object.freeze({
    packId: stableText(value.packId, 64),
    itemId: stableText(value.itemId, 64),
  });
}

function projectProfile(value = {}) {
  const profile = value.profile || {};
  return Object.freeze({
    ok: true,
    profile: Object.freeze({
      schemaVersion: "grey-crow-player-profile-v2",
      playerProfileId: stableText(profile.playerProfileId, 96),
      preferredLanguage: stableText(profile.preferredLanguage, 32),
      displayName: stableText(profile.displayName, 120),
      pronouns: stableText(profile.pronouns, 120),
      narrativePreferences: Object.freeze((profile.narrativePreferences || []).slice(0, 20).map((item) => stableText(item, 240))),
      contentBoundaries: Object.freeze((profile.contentBoundaries || []).slice(0, 20).map((item) => stableText(item, 240))),
      notes: stableText(profile.notes, 2000),
      updatedAt: stableText(profile.updatedAt, 40),
    }),
    explicitFields: Object.freeze((value.explicitFields || []).slice(0, 16).map((item) => stableText(item, 64))),
    persistence: Object.freeze({
      status: stableText(value.persistence?.status, 64),
      warning: stableErrorCode(value.persistence?.warning),
    }),
    localPathsExposed: false,
  });
}

function projectEditableItem(value = {}) {
  const packId = stableText(value.packId, 64);
  const packVersion = stableText(value.packVersion, 64);
  const itemId = stableText(value.itemId, 64);
  const type = ["host", "world", "skill"].includes(value.type) ? value.type : "unknown";
  const skillClass = type === "skill" && ["ordinary", "new_game"].includes(value.skillClass) ? value.skillClass : null;
  const language = stableText(value.language, 35);
  const danger = ["low", "medium", "high", "critical"].includes(value.danger) ? value.danger : "medium";
  const triggers = Object.freeze((value.triggers || []).slice(0, 32).map((entry) => stableText(entry, 120)));
  const readScopes = Object.freeze((value.readScopes || []).slice(0, 8).map((entry) => stableText(entry, 64)));
  const writeScopes = Object.freeze((value.writeScopes || []).slice(0, 8).map((entry) => stableText(entry, 64)));
  const replaces = value.replaces ? projectRef(value.replaces) : null;
  const templates = Object.freeze((value.templates || []).slice(0, 32).map((template) => Object.freeze({
    templateId: stableText(template.templateId, 40),
    title: stableText(template.title, 240),
    markdown: boundedText(template.markdown, 40_000),
  })));
  const revision = normalizeRevision(value.revision);
  const module = value.module && type === "skill" && skillClass === "ordinary"
    ? Object.freeze({
        enabled: value.module.enabled === true,
        definitionSchemaVersion: stableText(value.module.definitionSchemaVersion, 96) || null,
        creatorSupport: ["editable_v1", "editable_v2", "available_v1", "available_v2", "read_only"].includes(value.module.creatorSupport)
          ? value.module.creatorSupport
          : "read_only",
        draft: deepFreezeClone(value.module.draft),
      })
    : null;
  return Object.freeze({
    schemaVersion: "grey-crow-content-editor-item-v2",
    packId,
    packVersion,
    itemId,
    type,
    skillClass,
    title: stableText(value.title, 240),
    language,
    description: stableText(value.description, 1200),
    danger,
    triggers,
    readScopes,
    writeScopes,
    replaces,
    markdown: boundedText(value.markdown, 120_000),
    templates,
    ...(type === "skill" && skillClass === "ordinary" ? {
      playerGuide: stableText(value.playerGuide, 2000),
      module,
    } : {}),
    revision,
    technical: Object.freeze({
      schemaVersion: "grey-crow-content-technical-v1",
      pack: Object.freeze({
        id: packId,
        version: packVersion,
        ownership: "player_owned",
        activation: "active",
        validationStatus: "valid",
      }),
      item: Object.freeze({
        id: itemId,
        type,
        skillClass,
        language,
        danger,
        triggers,
        readScopes,
        writeScopes,
        templates: Object.freeze(templates.map((template) => Object.freeze({
          templateId: template.templateId,
          title: template.title,
        }))),
        replaces,
        module: module ? Object.freeze({
          enabled: module.enabled,
          definitionSchemaVersion: module.definitionSchemaVersion,
          creatorSupport: module.creatorSupport,
          skillIOEnabled: module.draft?.skillIOEnabled === true,
        }) : null,
        revision,
      }),
      policy: Object.freeze({
        manifestEditable: false,
        permissionsEditable: false,
        localPathsExposed: false,
      }),
    }),
  });
}

function normalizeOwnership(value) {
  return ["built_in", "imported_readonly", "player_owned"].includes(value) ? value : "imported_readonly";
}

function normalizeActivation(value, ownership) {
  if (value === "active" || value === "quarantined") return value;
  return normalizeOwnership(ownership) === "imported_readonly" ? "quarantined" : "active";
}

function requirePackId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(normalized)) {
    throw managementError("CONTENT_PACK_ID_INVALID", "Pack id is invalid.");
  }
  return normalized;
}

function requireItemId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(normalized)) {
    throw managementError("CONTENT_ITEM_ID_INVALID", "Content item id is invalid.");
  }
  return normalized;
}

function normalizeRevision(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw managementError("CONTENT_EDIT_REVISION_INVALID", "Content editor revision is invalid.");
  }
  return normalized;
}

function normalizeBlankContentKind(value) {
  const normalized = String(value || "").trim();
  if (!["host", "world", "ordinary_skill", "new_game_skill"].includes(normalized)) {
    throw managementError("CONTENT_BLANK_KIND_INVALID", "Blank content type is invalid.");
  }
  return normalized;
}

function normalizeText(value, maximum, code) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) throw managementError(code, "Content metadata is invalid.");
  return normalized;
}

function stableText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function boundedText(value, maximum) {
  const normalized = String(value || "");
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum);
}

function stableErrorCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]+$/.test(value) ? value : null;
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function deepFreezeClone(value) {
  const cloned = JSON.parse(JSON.stringify(value || null));
  return deepFreeze(cloned);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function resolveRuntimeRoot() {
  if (typeof process.resourcesPath === "string") {
    return path.resolve(process.resourcesPath);
  }
  return path.resolve(__dirname, "../../..");
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw managementError("CONTENT_PATH_INVALID", `${label} must be absolute.`);
  }
  return path.resolve(value);
}

function managementError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = { createDesktopContentManagement };
