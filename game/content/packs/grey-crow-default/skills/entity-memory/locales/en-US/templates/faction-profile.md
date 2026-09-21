# Faction Profile Template

Template ID: `template:faction-profile`

Use when a persistent group, faction, gang, militia, family, trading network, or organization appears or changes.

Example `upsert_faction_fact` arguments:

```json
{
  "faction": {
    "id": "optional-existing-faction-ref",
    "name": "North Station Mutual Aid Team",
    "aliases": ["North Station Team"],
    "summary": "A small mutual-aid group formed by nearby residents, mainly coordinating water and medicine distribution.",
    "visible_description": {
      "appearance": "Members usually tie a strip of white cloth around one sleeve.",
      "behavior": "They record the size of each group before admitting anyone to the shelter.",
      "voice": "They speak carefully and avoid loud arguments.",
      "atmosphere": "Order still holds, but the pressure on supplies is obvious.",
      "first_seen": "The player first met them at the temporary water point in North Square."
    },
    "attitude_to_player": "watchful",
    "territory_refs": ["North Square temporary water point"],
    "member_refs": ["Shen Yao"],
    "known_facts": ["They open the water point only twice a day."],
    "player_claims": [],
    "rumors": ["Someone says they are hiding a generator that still works."],
    "status": "active",
    "authority": "soft"
  }
}
```

Rules:

- Fill `id`, territory refs, and member refs only when stable references already exist. Natural names may also be used where the schema permits.
- Attitudes, memberships, and territory are semantic records for the current Adventure; they do not automatically become a numerical reputation system.
- Keep rumors under rumor authority. Do not create a large off-screen organization from a single mention.
- Submit only fields needed now. The actual Tool Schema is authoritative.
