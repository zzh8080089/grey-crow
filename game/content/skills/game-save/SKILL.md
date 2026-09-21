---
id: game-save
title: Game Save / Auto Save
kind: save-lifecycle
activation: runtime_or_menu
modelInvocation: model_can_request
danger: medium
requiresConfirmation: false
userMenuCommand: true
---

# Game Save / Auto Save

Game Save commits current adventure progress at save nodes. It creates safe save
metadata, timeline material, and chapter / observation logs when useful without
writing base system files.

Game Save is not a per-turn logger, not a world index builder, and not a hard
state validator.

## When To Read

- Read this Skill when the player uses Save, when the runtime reaches an autosave point, after useful compaction, or when New Game needs an initial save commit.
- Do not use it as a substitute for narration.
- Do not read it every turn.

## Model Duties

- Request save only after the turn has a coherent player-facing result.
- Keep chapter / observation logs useful for player review, but do not invent hard state.
- Keep save metadata short, factual, system-safe, and free of hidden reasoning.
- Separate narrative save records from narrow app-state proposals.
- Use entity-memory or game-state tools for actual entity/state changes before save commit; Game Save does not replace those tools.
- For dangerous writes, repairs, Delete Game, or schema upgrades, request system confirmation / Repair instead of inventing files. Current Demo does not provide automatic backup or Restore. System Reset is separate and handles system baseline repair.
- `append_timeline_event(event)` accepts only `id`, `type`, `summary`, `participants`, `location_id`, and non-confirmed soft authority values. Do not include paths, file names, template IDs, source metadata, timestamps, or hard-state details.

## Detail Template Index

- `template:timeline-entry`：compact record of what changed in this save moment.
- `template:diary-entry`：player-facing chapter / observation log written only at save or compaction nodes.
- `template:save-summary`：system-owned save commit metadata for UI / Continue / debug.

## Runtime Controlled Write

- `write_chapter_log(entry)`：explicit-route write for a player-facing chapter / observation log through the Runtime chapter-log store. It requires save-node / maintenance permission and is only exposed during save / compaction / menu maintenance routes, not ordinary turns.

## Runtime Controlled Read

- `read_chapter_log`：explicit-route readback for recent chapter logs, one chapter id, or a turn range. Use only when the player asks to review progress or when save / compaction maintenance needs chapter context. Do not treat readback as hard state.

## System-Owned Write

- save commit metadata. The model may provide narrative material, but the Runtime owns final metadata projection.

## Allowed Reads

- `saveRoot/modules`
- `saveRoot/world`
- `saveRoot/characters`
- `saveRoot/memory`
- `saveRoot/diary`
- `saveRoot/meta/`

## Allowed Writes

- `saveRoot/world/timeline`
- `saveRoot/diary`
- `saveRoot/meta/`

## Write Template Summary

```json
{
  "id": "optional-stable-timeline-id",
  "type": "narrative_event",
  "summary": "",
  "participants": [],
  "location_id": "",
  "authority": "narrative_event"
}
```

## Boundaries

- Do not generate diary/chapter logs every turn.
- Do not build or rewrite full `world_index`; map / world index is a separate future module.
- Do not save API keys, provider raw bodies, full prompts, hidden reasoning, or local absolute paths.
- Do not modify base content or engine files.
- Do not force a save if the current turn is still waiting for player confirmation.
- Do not treat timeline, chapter logs, compact summary, or save metadata as hard state.
- Do not treat save as repair; use Repair for corrupted current-save files, Delete Game for intentional current-save deletion, and System Reset for system baseline repair. Current Demo does not provide automatic backup or Restore.
