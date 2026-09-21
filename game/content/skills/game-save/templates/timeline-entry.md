# Timeline Entry Template

Template ID: `template:timeline-entry`

Use when the host needs to record the compact result of a meaningful turn or
save moment.

Payload shape for `append_timeline_event(event)`:

```json
{
  "id": "optional-stable-timeline-id",
  "type": "narrative_event",
  "summary": "",
  "participants": [],
  "location_id": "",
  "authority": "narrative_event"
}
```

Rules:

- Keep it concise and factual.
- Do not include hidden reasoning, raw prompts, API keys, provider bodies, or local paths.
- Rejected hard changes can be recorded as rejected, not as facts.
