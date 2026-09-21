# 持ち物要約の template

Template ID: `template:inventory-item`

現在のターンで、プレイヤーが名前のある物品を取得、廃棄、消費したことが確認されたときに使う。この action は現在の所持数だけを管理し、物品の完全な記録は保存しない。

`record_inventory_change` の parameter の例：

```json
{
  "change": "gain",
  "item": "救急包帯",
  "quantity": 1
}
```

規則：

- 場面で見た、調べた、取ろうとしただけでは持ち物に入らない。
- `change` は `gain` または `lose` だけを使う。`quantity` は今回変化した数で、省略時は 1。
- 名前のある物品、手掛かり、状態、所有関係を長期保存する必要がある場合、`entity-memory` を別に使う。
- Runtime が現在数、冪等性、UI への反映を担当する。持ち物全体の要約を送らない。
