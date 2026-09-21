# Save Summary Template

Template ID: `template:save-summary`

Use for safe save commit metadata and UI / Continue confirmation. The final
save summary is system-owned; the model must not raw-write this file.

```json
{
  "save_id": "current",
  "reason": "manual_save",
  "state_version": 0,
  "turn": 0,
  "location_id": "",
  "chapter_generated": false,
  "counts": {
    "timeline_entries": 0,
    "memory_records": 0,
    "record_writes": 0,
    "chapter_logs": 0
  },
  "warnings": []
}
```

Rules:

- This is metadata, not narration.
- Runtime owns final values; model-provided material is only input.
- Keep it safe for UI display.
- Do not include raw provider data, full prompts, hidden reasoning, or local paths.
- Do not build full `world_index` here.
