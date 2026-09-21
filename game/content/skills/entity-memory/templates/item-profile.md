# 物品档案模板

Template ID: `template:item-profile`

具名物品、线索、文档、工具、零件、容器或特殊资源需要跨回合保留时使用。

`record_item_memory` 参数示例：

```json
{
  "name": "蓝色门禁卡",
  "summary": "卡面印有褪色的设备区标识，权限范围尚未确认。",
  "authority": "soft"
}
```

规则：

- 领域物品记录不会自动把物品加入右侧背包；确认所有权变化后另用 `game-state`。
- 更新已有物品时，先检索并把返回的 `reference` 原样传回；新物品不要自己创造 reference。
- 看见、想要或尝试拿取不等于已经拥有；不确定内容使用 `player_claim`、`rumor` 或 `attempt`。
- 稀缺、危险或关键物品也必须有当前回合依据，不能因为模板存在而凭空生成。
- Runtime 负责记录结构、校验、幂等和文件写入；只提交当前 Tool Schema 声明的简单字段。
