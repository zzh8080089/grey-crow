# Single-Commit Guide for Opening Anchors

Template ID: `template:opening-anchor-write`

The player has confirmed the opening summary. Use this guide to organize the natural conversation into one `finalize_new_game` call. This template is not a questionnaire, does not replace the domain tool's parameter schema, and does not authorize direct file access.

## Authority boundary

- Include only details the player stated, finally confirmed, or that the locked World directly supports.
- Do not turn hesitation, speculation, or a detail still being revised into confirmed fact.
- The current `finalize_new_game` schema defines the tool name, parameters, required fields, permissions, and error results.
- Do not create data outside the current Adventure or modify the read-only Content Snapshot.

## Material that may be organized

- Player: name, body or form of address, clues about former identity, and a short player summary.
- One remaining thing: object, ability, memory, or obsession, plus the in-world meaning already explained by the Host.
- Starting point: a natural Shanghai place name, an existing internal place reference if needed, and a short area description.
- Opening anchor: the confirmed situation immediately before the first scene.
- Optional: current goal and initial physical condition. Leave them absent if unknown.

## Commit order

1. Check the player's latest confirmation again. If anything is still being revised, return to conversation and do not commit.
2. Build one `finalize_new_game` request according to the current tool schema.
3. Call `finalize_new_game` exactly once. Do not use other domain tools first to duplicate the player, place, or opening event.
4. Narrate the first scene only after the tool succeeds.

## Failure handling

- If arguments are rejected, correct them using the stable error and current schema, then retry.
- If the tool fails, remain in `new_game_creation` and do not claim that the Adventure started.
- Never bypass validation through direct file writes or expose tools, fields, paths, or raw errors to the player.
