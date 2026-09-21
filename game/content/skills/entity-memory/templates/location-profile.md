# 地点档案模板

Template ID: `template:location-profile`

用于主持人需要创建或更新地点、房间、聚落、路线锚点、地标或持续存在的环境特征。

当前中文版规则：`name` 和 `summary` 默认用自然中文；自然英文或其他语言地名也可作为玩家可见名。

`record_location_memory` 参数示例：

```json
{
  "name": "虹口足球场",
  "summary": "一座被雨水和临时棚布切开的旧体育场，外圈还能辨认出检票口和看台通道。",
  "authority": "narrative_event"
}
```

规则：

- `name` 必须是玩家可见地点名，`summary` 只保留当前最有持续价值的短摘要。
- 更新已有地点时，先检索并把返回的 `reference` 原样传回；新地点不要自己创造 reference。
- 新路线和地点细节属于当前冒险的世界记录；只有玩家当前主要场景变化才需要另读 `game-state`。
- 未确认内容使用 `player_claim`、`rumor` 或 `attempt`，不要直接升级成确认事实。
- Runtime 负责记录结构、校验、幂等和文件写入；不要附加未声明字段。
