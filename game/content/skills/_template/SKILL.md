---
id: example-skill
title: Example Skill
kind: read
activation: model_can_invoke_when_relevant
modelInvocation: model_can_invoke
danger: low
requiresConfirmation: false
userMenuCommand: false
---

# Example Skill

This is the template for Grey Crow Skill files. Replace the frontmatter and
sections with one focused operation template.

## When To Read

- Use this Skill only when the current turn needs its specific operation.
- Do not load every Skill into every prompt.

## Detail Template Index

Use stable template IDs, not file paths. Read a detailed template only when the
current turn needs that specific write shape.

- `template:example-record`：field skeleton for one domain record.

## Model Duties

- Decide whether this Skill is relevant.
- Ask Runtime tools for missing state instead of guessing hard facts.
- Decide whether this turn needs a write; the Harness will not write just because a keyword matched.
- Use only the domain write tools declared for this Skill, and keep player-facing narration natural before reporting any save operation.
- Keep the final player-facing reply as natural Grey Crow narration.

## Allowed Data

- Read only the Runtime or saveRoot scopes declared in `content/skills/index.v1.json`.
- Write only through high-level domain tools declared for this Skill.
- For dangerous writes, request confirmation / repair flow before changing current saveRoot. Current Demo does not provide automatic backup or Restore.

## Write Template Summary

When this Skill supports writes, include a short field skeleton here and put the
full version in a deeper template file. Keep the skeleton stable enough for
schema validation.

```json
{
  "template_id": "template:example-record",
  "record_type": "example",
  "authority": "soft",
  "source": "current_turn",
  "fields": {}
}
```

## Boundaries

- Do not request shell, raw file read/write, network scan, absolute paths, or saveRoot escape.
- Do not modify `engine/` or base `content/` in place.
- Do not turn narration into narrow app state unless the Runtime guard accepts it.
- If a write seems wrong or incomplete, prefer a Repair request over inventing missing files.
