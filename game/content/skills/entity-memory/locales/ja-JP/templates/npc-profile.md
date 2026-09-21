# 人物プロファイルの template

Template ID: `template:npc-profile`

新しい NPC が現れた、名前のある人物が重要になった、または既存の人物記録を更新するときに使う。まず既存記録を検索し、継続して覚える必要がある場合だけ書く。

`upsert_character_fact` の parameter の例：

```json
{
  "character": {
    "id": "optional-existing-character-ref",
    "location_ref": "optional-existing-location-ref",
    "name": "沈遥",
    "aliases": ["小沈"],
    "visible_description": {
      "appearance": "色あせた地下鉄保守服を着て、左手に古い包帯を巻いている。",
      "behavior": "話す前に必ず一番近い出口を見る。",
      "voice": "声は小さく、文も短い。",
      "atmosphere": "警戒しているが、すぐに敵意は見せない。",
      "first_seen": "商業施設の従業員通路で初めて会った。"
    },
    "role": "自称・地下鉄保守員",
    "faction": "未確認",
    "relationship_to_player": "会ったばかりで、慎重な態度",
    "known_facts": ["地下通路の一部を知っている。"],
    "player_claims": ["仲間の行方を隠しているかもしれないと考えている。"],
    "rumors": [],
    "status": "その場にいる",
    "authority": "soft"
  }
}
```

規則：

- 最初の記録では、プレイヤーが観察できる内容を優先する。
- `id` と `location_ref` は既存の stable ref がある場合だけ入れ、template を埋めるために英語 slug を作らない。
- 身元、勢力、物品、経歴を根拠なく確定しない。疑いと判断は `player_claims` または `rumors` にする。
- 現在必要な field だけを送り、未確認 field は省略する。実際の Tool Schema を正式な取り決めとする。
