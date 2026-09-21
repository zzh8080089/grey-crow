# Compact Summary Template

Template ID: `template:compact-summary`

Use when older memory, diary, and timeline records must be compressed while
preserving continuity.

```json
{
  "template_id": "template:compact-summary",
  "record_type": "compact_summary",
  "source_range": {
    "from_turn": "",
    "to_turn": ""
  },
  "hard_anchors": [],
  "soft_threads": [],
  "player_claims": [],
  "open_questions": [],
  "recent_handoff": [],
  "do_not_promote_to_fact": []
}
```

Rules:

- Keep narrow app state and narrative memory/save records separate.
- Do not resolve uncertain claims during compression.
- Do not include hidden reasoning, raw prompts, API keys, provider bodies, or local paths.
