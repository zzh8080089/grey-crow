# 玩家状态模板

Template ID: `template:player-status`

当前回合已经确认玩家的身体状况、疲劳、感染、伤势或其他可见状态变化时使用。
需要确认旧值时，先用 `inspect_current_situation`。

调用 `update_player_condition`，参数：

```json
{
  "status": "右臂轻度划伤，已压迫止血"
}
```

规则：

- `status` 是一条简短的当前状态，不是完整病历。
- 玩家只是在设想、谎称或尝试改变状态时，不更新当前状态。
- 不根据修辞自动治疗、自动受伤或自动消耗资源。
- Runtime 负责版本、幂等和 UI 投影；不要附加原因、旧值或内部字段。
