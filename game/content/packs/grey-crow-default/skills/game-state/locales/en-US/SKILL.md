---
id: game-state
title: Game State
kind: read-write
activation: model_or_menu
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: true
---

# Game State

Read and update the player-visible current state when the player asks about it, or when the current turn has confirmed a change to the player's body, inventory summary, or primary scene anchor. This is not a complete history of the world, and state does not need to be written every turn.

## When to use

- Read when the player asks about their condition, inventory, current scene, active objectives, or available actions.
- Use when the current turn confirms a change to the player's physical condition, inventory summary, or primary scene anchor.
- Read when a missing current-state anchor would make the narration inconsistent.

## Procedure

1. Call `inspect_current_situation`, or `inspect_skill` with the `game-state` overview, when the current anchor needs confirmation. Never overwrite newer state from an old summary.
2. Decide whether the change belongs to player state, inventory summary, or the primary scene anchor. Ordinary posture, viewpoint, sound, and atmosphere remain in narration.
3. Use `confirm_current_location` for a location change, `update_player_condition` for physical state, and `record_inventory_change` for an item delta.
4. Submit only one change already confirmed by the current narration. Runtime owns quantity, version, idempotency, and App/UI projection.
5. If the tool fails, preserve the narrative result and explain that the state was not recorded. Never claim that an update succeeded when it did not.

## Boundaries

- Do not infer confirmed facts from fields that are absent in returned state.
- Seeing or discussing an item does not put it in the inventory. Use `entity-memory` for persistent item details.
- Use `entity-memory` or `map` for location details and routes. This Skill only maintains the player's current primary scene anchor.
- The current Tool Schema is authoritative for parameters. Templates only explain when to write and how to keep the write narrow.
- Do not request arbitrary file writes, modify the read-only content snapshot, or expose internal paths or debug information to the player.
- Use natural English when the active content language is English. Proper names may remain in their original language; do not invent a translation table.
