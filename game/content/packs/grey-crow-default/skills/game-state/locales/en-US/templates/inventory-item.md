# Inventory Summary Template

Template ID: `template:inventory-item`

Use when the current turn has confirmed that the player acquired, discarded, or consumed one named item. This action maintains current inventory quantities; it does not store the item's complete profile.

Call `record_inventory_change` with:

```json
{
  "change": "gain",
  "item": "first-aid bandage",
  "quantity": 1
}
```

Rules:

- Seeing, examining, or intending to take an item does not mean it entered the inventory.
- Use only `gain` or `lose` for `change`. `quantity` is the amount changed by this action and defaults to one.
- If a named item, clue, condition, or ownership must persist, use `entity-memory` separately.
- Runtime owns current quantities, idempotency, and UI projection. Do not submit a complete inventory summary.
