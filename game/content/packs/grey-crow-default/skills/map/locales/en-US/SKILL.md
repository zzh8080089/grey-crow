---
id: map
title: Map
kind: read
activation: model_or_menu
modelInvocation: model_can_invoke
danger: low
requiresConfirmation: false
userMenuCommand: true
---

# Map

When the player asks about their current location, nearby places, or a route, read known spatial facts and route constraints. This Skill provides facts or clues only. It is read-only: it does not move the player automatically, and a matching trigger hint never causes a state write.

English locale rule: use map results to support clear English spatial narration. Player-visible place names, exits, and route descriptions should use natural English where an English name exists. Proper names in Chinese or another language may remain player-visible. Never reveal internal IDs, refs, or storage keys.

## When to use

- Read when the player asks where they are, where they can go, what is nearby, or how to reach somewhere.
- Before travel, movement, pursuit, or leaving the current location, read when the route facts are unclear.

## Model responsibilities

- Use map results to keep movement, distance, and spatial narration continuous.
- Distinguish known routes, unknown routes, unconfirmed routes, and player guesses.
- If the player attempts to move, host the action using known routes. Reading the map does not decide whether the player arrives.
- Treat internal `id`, `location_id`, and `location_ref` values only as references. Use readable `name`, `aliases`, and route descriptions in the active content language when speaking to the player.
- If the map has no information, do not turn an English-looking location ID into a place name. Say that the information is unconfirmed; read `entity-memory` separately if the detail has persistent value.

## Writes

None. This Skill does not write state, create locations, or move the player. After the player actually reaches another major location, the model may separately read `game-state` and decide whether the primary scene anchor should change. That is not a side effect of using Map.

## Boundaries

- Do not create a confirmed route from map silence.
- Reading the map has no movement side effect.
- Do not expose internal paths, storage structure, internal IDs, or tool protocol to the player.
