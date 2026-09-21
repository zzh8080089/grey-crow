# 勢力プロファイルの template

Template ID: `template:faction-profile`

継続するグループ、勢力、ギャング、自警団、家族、取引網、組織が現れた、または変化したときに使う。

`upsert_faction_fact` の parameter の例：

```json
{
  "faction": {
    "id": "optional-existing-faction-ref",
    "name": "北駅相互扶助隊",
    "aliases": ["北駅隊"],
    "summary": "周辺住民による小規模な相互扶助組織。主に水と薬の配給を維持している。",
    "visible_description": {
      "appearance": "構成員は袖に白い布を結んでいることが多い。",
      "behavior": "拠点へ入る前に同行者の人数を記録する。",
      "voice": "会話は抑制され、大声での争いを避ける。",
      "atmosphere": "秩序は残っているが、物資の圧力が目に見える。",
      "first_seen": "プレイヤーが北広場の臨時給水所で初めて接触した。"
    },
    "attitude_to_player": "観察を続けている",
    "territory_refs": ["北広場臨時給水所"],
    "member_refs": ["沈遥"],
    "known_facts": ["給水所を開くのは一日二回だけ。"],
    "player_claims": [],
    "rumors": ["動く発電機を隠しているという話がある。"],
    "status": "活動中",
    "authority": "soft"
  }
}
```

規則：

- `id`、territory/member ref は既存の stable ref がある場合だけ入れる。自然な名称も使える。
- 態度、構成員の関係、勢力圏は現在のゲームの意味記録であり、自動的に数値化された評判システムにはならない。
- 噂は `rumor` のまま保ち、一度触れただけで巨大な画面外組織を作らない。
- 現在必要な field だけを送り、実際の Tool Schema を正式な取り決めとする。
