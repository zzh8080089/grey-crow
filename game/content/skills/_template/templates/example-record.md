# Example Record Template

Template ID: `template:example-record`

Use this file as the deeper field skeleton for a Skill-specific write. The
model should read it only after the Skill itself is relevant.

```json
{
  "template_id": "template:example-record",
  "record_type": "example",
  "id": "stable-generated-id",
  "display_name": "",
  "authority": "soft",
  "source": "current_turn",
  "summary": "",
  "evidence": [],
  "hard_state_proposal": null
}
```

Rules:

- Prefer `authority: "soft"` unless this is truly a narrow app/UI state field.
- Do not include local file paths, raw prompts, API keys, or hidden reasoning.
- If required fields are unknown, write `unknown` or request a narrower read.
