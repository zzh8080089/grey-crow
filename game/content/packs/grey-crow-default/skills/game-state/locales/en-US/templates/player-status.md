# Player Status Template

Template ID: `template:player-status`

Use when the current turn has confirmed a change to the player's physical condition, fatigue, infection, injury, or another visible state. Use `inspect_current_situation` first when the old value needs confirmation.

Call `update_player_condition` with:

```json
{
  "status": "minor cut on the right arm; bleeding stopped with pressure"
}
```

Rules:

- `status` is one short current condition, not a complete medical history.
- Do not update current state when the player is only imagining, falsely claiming, or attempting a change.
- Do not automatically heal, injure, or consume resources based on figurative language.
- Runtime owns revisioning, idempotency, and UI projection. Do not add reasons, old values, or internal fields.
