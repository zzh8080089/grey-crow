---
id: delete-game
title: Delete Game
kind: system-dangerous
activation: ui_delete_game
modelInvocation: never_direct_delete
danger: critical
requiresConfirmation: true
userMenuCommand: true
---

# Delete Game

Delete Game is a dangerous system function. The system performs current-save
cleanup; the model may only explain, confirm, or narrate around the operation.

System Reset is separate. It means system repair / baseline restoration, not ordinary save deletion.
Demo currently does not provide automatic backup or Restore for Delete Game.

## When To Read

- Read this Skill when the UI starts delete game or current-save cleanup.
- Do not trigger it from ordinary player narration.

## System Duties

- Keep Delete Game separate from New Game and System Reset.
- Require multi-step confirmation.
- Make the irreversible consequence clear before confirmation.
- Block new Adventure writes, cancel active Adventure operations, and wait for them to finish before deletion.
- Atomically detach and delete the complete current Adventure root after confirmation. Do not maintain a per-Skill delete allowlist.
- Delete the Adventure's desktop slot metadata together with the Adventure root.
- Record the delete operation in safe metadata.
- Offer Repair when the player wants to recover from a bad write instead of intentionally deleting the adventure.

## Model Duties

- Make the consequence clear to the player.
- Keep the confirmation text concise and unambiguous.
- Never request raw delete paths or shell commands.
- Do not promise backup or Restore in the current Demo flow.

## Storage Split

- Player-created Skill source Packs live in the validated global content library and survive Adventure deletion.
- The selected Skill's locked `content-snapshot/` copy and all per-Adventure Skill state live inside the Adventure root and are deleted with that Adventure.
- Player profile, settings, provider credentials, built-in content, and installed Pack sources are outside the Adventure root and must be preserved.

## Allowed Deletes

- The one current Adventure root resolved by a validated Adventure id.
- Everything contained by that root, including metadata, state, transcript, Memory, character records, world records, chapters, audit, indexes, locked content snapshot, ordinary Skill module state, Finale, Easter, lineage, and Adventure-owned backups.

## Boundaries

- Do not delete or rewrite `engine/`.
- Do not delete or rewrite base `content/`, Host / SOUL, Skill templates, schema, presets, map base, or installer resources.
- Do not delete the global player content library, installed Pack sources, player profile, settings, provider vault, sibling Adventures, or files outside the validated Adventures root.
- Do not expose local absolute paths or raw file operations to the model.
- Do not combine New Game and Delete Game in one unconfirmed flow.
