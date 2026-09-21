# 背包摘要模板

Template ID: `template:inventory-item`

当前回合已经确认玩家取得、丢弃或消耗一种具名物品时使用。
这个动作只维护当前背包数量，不保存物品的完整档案。

调用 `record_inventory_change`，参数：

```json
{
  "change": "gain",
  "item": "急救绷带",
  "quantity": 1
}
```

规则：

- 场景中看见、检查或打算拿取物品，不等于已经进入背包。
- `change` 只使用 `gain` 或 `lose`；`quantity` 是本次变化的数量，省略时为 1。
- 命名物品、线索、状态和归属需要长期保留时，另用 `entity-memory`。
- Runtime 负责当前数量、幂等和 UI 投影；不要自行提交整份背包摘要。
