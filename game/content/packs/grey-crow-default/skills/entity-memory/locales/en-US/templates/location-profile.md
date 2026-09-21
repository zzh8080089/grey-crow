# Location Profile Template

Template ID: `template:location-profile`

Use when the host needs to create or update a location, room, settlement, route anchor, landmark, or persistent environmental feature.

English locale rule: `name` and `summary` should use natural English when an English rendering exists. A natural Chinese or other-language place name may remain player-visible.

Example `record_location_memory` arguments:

```json
{
  "name": "Hongkou Football Stadium",
  "summary": "An old stadium divided by rain and makeshift tarps; ticket gates and passages to the stands remain recognizable around its outer ring.",
  "authority": "narrative_event"
}
```

Rules:

- `name` must be player-visible. Keep `summary` to the short detail with the most persistent value.
- To update an existing location, look it up first and pass the returned `reference` back unchanged. Do not invent a reference for a new location.
- New route and location details belong in the Adventure's world records. Read `game-state` separately only if the player's primary scene changes.
- Use `player_claim`, `rumor`, or `attempt` for unconfirmed information instead of upgrading it to confirmed fact.
- Runtime owns record structure, validation, idempotency, and file writes. Do not add undeclared fields.
