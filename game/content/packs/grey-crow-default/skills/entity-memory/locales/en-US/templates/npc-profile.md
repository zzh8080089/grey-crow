# Character Profile Template

Template ID: `template:npc-profile`

Use when a new NPC appears, a named character becomes important, or an existing character record needs updating. Search existing records first and write only when the character must persist across turns.

Example `upsert_character_fact` arguments:

```json
{
  "character": {
    "id": "optional-existing-character-ref",
    "location_ref": "optional-existing-location-ref",
    "name": "Shen Yao",
    "aliases": ["Xiao Shen"],
    "visible_description": {
      "appearance": "She wears a faded metro maintenance uniform and has an old bandage around her left hand.",
      "behavior": "Before speaking, she always glances toward the nearest exit.",
      "voice": "Her voice is quiet and her sentences are short.",
      "atmosphere": "Wary, but not immediately hostile.",
      "first_seen": "The player first met her in a service corridor of the shopping center."
    },
    "role": "claims to be a metro maintenance worker",
    "faction": "unconfirmed",
    "relationship_to_player": "recent acquaintance; cautious attitude",
    "known_facts": ["She knows part of the underground passage network."],
    "player_claims": ["The player thinks she may be hiding what happened to her companions."],
    "rumors": [],
    "status": "present",
    "authority": "soft"
  }
}
```

Rules:

- On first record, prioritize details the player can observe.
- Fill `id` and `location_ref` only when stable references already exist. Do not invent an English slug to fill the template.
- Do not confirm identity, faction, possessions, or history without evidence. Put suspicions and player judgments in `player_claims` or `rumors`.
- Submit only fields needed now and omit unconfirmed fields. The actual Tool Schema is authoritative.
