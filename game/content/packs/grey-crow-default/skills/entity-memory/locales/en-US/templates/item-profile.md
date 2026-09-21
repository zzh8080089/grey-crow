# Item Profile Template

Template ID: `template:item-profile`

Use when a named item, clue, document, tool, component, container, or special resource must persist across turns.

Example `record_item_memory` arguments:

```json
{
  "name": "blue access card",
  "summary": "A faded equipment-area mark is printed on the card; its access level remains unknown.",
  "authority": "soft"
}
```

Rules:

- A domain item record does not automatically add the item to inventory. After ownership is confirmed, use `game-state` separately.
- To update an existing item, look it up first and pass the returned `reference` back unchanged. Do not invent a reference for a new item.
- Seeing, wanting, or attempting to take an item does not establish ownership. Use `player_claim`, `rumor`, or `attempt` for uncertainty.
- Scarce, dangerous, or critical items still require evidence from the current turn. A template is not permission to invent them.
- Runtime owns record structure, validation, idempotency, and file writes. Submit only the simple fields declared by the current Tool Schema.
