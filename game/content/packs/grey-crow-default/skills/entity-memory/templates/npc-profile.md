# 人物档案模板

Template ID: `template:npc-profile`

新 NPC 出现、一个具名人物变得重要，或已有角色记录需要更新时使用。先检索已有记录；只有
确实需要持续记住时才写。

`upsert_character_fact` 参数示例：

```json
{
  "character": {
    "id": "optional-existing-character-ref",
    "location_ref": "optional-existing-location-ref",
    "name": "沈遥",
    "aliases": ["小沈"],
    "visible_description": {
      "appearance": "穿着褪色的地铁检修服，左手缠着旧绷带。",
      "behavior": "说话前总会先看一眼最近的出口。",
      "voice": "声音很轻，句子短。",
      "atmosphere": "警惕，但没有立刻表现出敌意。",
      "first_seen": "玩家在商场员工通道第一次遇见她。"
    },
    "role": "自称地铁检修员",
    "faction": "未确认",
    "relationship_to_player": "刚认识，态度谨慎",
    "known_facts": ["她知道地下通道的一部分路线。"],
    "player_claims": ["玩家认为她可能隐瞒了同伴的去向。"],
    "rumors": [],
    "status": "在场",
    "authority": "soft"
  }
}
```

规则：

- 首次记录优先保存玩家可以观察到的内容。
- `id` 和 `location_ref` 只有已有稳定引用时才填写，不为填模板创造英文 slug。
- 不凭空确认身份、阵营、物品或经历；怀疑和玩家判断写入 `player_claims` 或 `rumors`。
- 只提交当前需要的字段，未确认字段直接省略。实际 Tool Schema 是协议权威。
