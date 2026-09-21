# 物品プロファイルの template

Template ID: `template:item-profile`

名前のある物品、手掛かり、文書、道具、部品、容器、特殊資源を複数のターンにわたって保持するときに使う。

`record_item_memory` の parameter の例：

```json
{
  "name": "青い入館カード",
  "summary": "表面に色あせた設備区画の印がある。権限範囲は未確認。",
  "authority": "soft"
}
```

規則：

- 物品の領域記録は、持ち物へ物品を自動追加しない。所有権の変化が確定したら `game-state` を別に使う。
- 既存の物品を更新するときは、先に検索し、返された `reference` をそのまま送る。新しい物品の reference を作らない。
- 見た、欲しがった、取ろうとしただけでは所有したことにならない。不確かな内容は `player_claim`、`rumor`、`attempt` のいずれかにする。
- 希少、危険、重要な物品にも現在のターンの根拠が必要であり、template があるという理由で生成しない。
- Runtime が記録構造、検証、冪等性、file 書き込みを担当する。現在の Tool Schema が宣言する簡単な field だけを送る。
