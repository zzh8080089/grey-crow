# Diary Entry Template

Template ID: `template:diary-entry`

Use for a player-facing chapter / observation log after a save node or useful
compaction. This is for later review, not for every turn.

```json
{
  "chapter_id": "chapter-0001",
  "save_commit_id": "save_...",
  "reason": "manual_save",
  "turn_range": { "start": 0, "end": 0 },
  "title": "",
  "summary": "",
  "key_events": [],
  "open_threads": [],
  "createdAt": ""
}
```

Rules:

- Diary/chapter text may be atmospheric, but it must not invent app/UI state.
- Do not write a chapter log when the source material is too short, still waiting for player confirmation, or compaction had no benefit.
- Keep it useful for a player who has forgotten previous sessions.
- Attach every chapter log to an existing save commit id.
- Reference known records by stable ids when available; do not expose file paths.
- Do not expose tool names, debug trace, provider details, or local paths to the player.
