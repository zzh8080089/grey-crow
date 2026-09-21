---
id: entity-memory
title: Entity and World Memory
kind: read-write
activation: model_can_invoke_when_entity_or_world_fact_is_relevant
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: false
---

# Entity and World Memory

When a character, location, faction, named item, rumor, or earlier event affects the current turn, read or update the Adventure's semantic records as needed. The model decides whether a read or write is useful. Trigger hints only help discover this Skill; they are not mandatory execution conditions.

## When to use

- A persistent character, location, faction, or item appears again, or becomes important for the first time this turn.
- The host is about to claim that an entity is known, present, owned, hostile, allied, or changed in a way that must persist.
- The player refers to an old clue, rumor, relationship, or place and the recent conversation is insufficient to confirm the details.

## Procedure

1. Search with `inspect_skill(skill: "entity-memory", view: "lookup", query: ...)` before writing. Use `recent` when only the latest records are needed.
2. Reuse the returned `reference` when updating an existing location or item. The model still decides entity identity from the narrative.
3. Use `record_location_memory` for locations and `record_item_memory` for named items or clues. Submit only name, short summary, authority, and an optional reference.
4. Preserve the correct uncertainty authority for player claims, attempts, and rumors. Do not silently promote them to confirmed state.
5. If a change must also appear in the right-side current-state UI, read `game-state` separately. Domain records do not update the UI automatically.

## Write boundaries

- Use the named Character Skill actions for people, `record_location_memory` for locations, and `record_item_memory` for items. Use the currently routed domain action for factions or important timeline events.
- Use only `soft`, `player_claim`, `rumor`, `attempt`, or `narrative_event` as authority.
- The current Tool Schema is authoritative for fields, lengths, and types. Do not add paths, filenames, template IDs, or undeclared fields.
- Do not modify the read-only World card, Skills, or content snapshot, and do not use arbitrary file tools.
- Do not force ordinary narration into a state machine. Write only when the information has persistent value, and never let a failed write prevent a normal response to the player.
