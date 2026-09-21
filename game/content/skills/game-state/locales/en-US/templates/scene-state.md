# Scene State Template

Template ID: `template:scene-state`

Use when the player has reached another major location. Short movements inside the same building, district, or major location normally do not change the scene anchor.

Call `confirm_current_location` with:

```json
{
  "location": "<player-visible major location name>"
}
```

Rules:

- Write current location only for a primary scene-anchor change or a forced location change.
- Posture, cover, viewpoint, sound, emotion, and atmosphere within the same scene belong mainly in narration or soft records.
- `location` is the player-visible name. Use natural English in the English locale, while preserving proper names when appropriate.
- Detailed locations, routes, and present entities belong in world records. Use `entity-memory` for persistent location details.
- Runtime owns revisioning, idempotency, and UI projection. Do not add a reference, summary, tags, or internal fields.
