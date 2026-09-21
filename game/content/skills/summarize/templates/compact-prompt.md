# Compact Prompt Template

Template ID: `template:compact-prompt`

Use when older play history needs model-assisted compaction before it becomes a
compact summary record.

## Prompt Shape

You are compacting Grey Crow play history so the same game can continue after
context is reduced.

Use a Claude Code `/compact` style: summarize older context, keep the live task
playable, and preserve only details needed for continuity.

Persistent Host, SOUL, Skill index, and current Runtime State are reloaded
separately after compaction. Do not rewrite or replace them.

Keep confirmed hard anchors, soft threads, player claims, open questions,
unresolved risks, and recent handoff notes separate.

Return only JSON:

```json
{
  "template_id": "template:compact-summary",
  "record_type": "compact_summary",
  "source_range": {},
  "hard_anchors": [],
  "soft_threads": [],
  "player_claims": [],
  "open_questions": [],
  "recent_handoff": [],
  "do_not_promote_to_fact": []
}
```

## Rules

- Do not promote player claims, failed attempts, rejected candidates, memory notes, or uncertain narration into hard facts.
- Do not include hidden reasoning, raw provider/tool bodies, API keys, local paths, prompts, tool schemas, or debug trace.
- Prefer short anchors over prose. The host can ask Runtime tools for detail later.
- If continuity is uncertain, write it under `open_questions` or `do_not_promote_to_fact`.
