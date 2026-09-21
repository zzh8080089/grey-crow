---
id: summarize
title: Summarize / Compaction
kind: memory-maintenance
activation: runtime_threshold_or_menu
modelInvocation: model_can_request
danger: medium
requiresConfirmation: false
userMenuCommand: true
---

# Summarize / Compaction

Summarize / Compaction keeps long-running play stable by reducing memory and
diary material into short, retrievable summaries.

## When To Read

- Read this Skill when context is long, the runtime asks for compaction, or the player uses a summary menu action.
- Use it after important scenes, not in the middle of unresolved player input.

## Model Duties

- Preserve what the player would expect the host to remember.
- Keep narrow app state, saveRoot records, player claims, attempts, and unresolved uncertainty separate.
- Keep summaries concise and source-aware.
- If model-assisted compaction is available, produce the compact summary draft only. Runtime validates, redacts, and saves it.

## Detail Template Index

- `template:compact-summary`：compressed memory / diary summary with source range and anchors.
- `template:compact-prompt`：Claude Code `/compact` inspired prompt shape for model-assisted summarization.

## Allowed Reads

- `saveRoot/memory`
- `saveRoot/diary`
- `saveRoot/world/timeline`
- `saveRoot/modules`

## Allowed Writes

- `saveRoot/memory`
- `saveRoot/diary`
- `saveRoot/meta/`

## Write Template Summary

```json
{
  "template_id": "template:compact-summary",
  "record_type": "compact_summary",
  "source_range": {},
  "hard_anchors": [],
  "soft_threads": [],
  "open_questions": []
}
```

## Boundaries

- A summary is not hard fact authority.
- Do not erase unresolved uncertainty by summarizing it as confirmed.
- Do not include API keys, raw provider output, full prompts, hidden reasoning, local paths, or debug trace.
