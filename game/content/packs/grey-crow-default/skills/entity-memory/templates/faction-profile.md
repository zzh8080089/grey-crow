# 阵营档案模板

Template ID: `template:faction-profile`

持续群体、阵营、帮派、民兵、家庭、商铺网络或组织出现或发生变化时使用。

`upsert_faction_fact` 参数示例：

```json
{
  "faction": {
    "id": "optional-existing-faction-ref",
    "name": "北站互助队",
    "aliases": ["北站队"],
    "summary": "由附近居民组成的小型互助组织，主要维持水和药品分配。",
    "visible_description": {
      "appearance": "成员通常在衣袖上系白色布条。",
      "behavior": "进入据点前会登记同行人数。",
      "voice": "交谈克制，避免大声争执。",
      "atmosphere": "秩序尚在，但资源压力明显。",
      "first_seen": "玩家在北广场的临时水点第一次接触他们。"
    },
    "attitude_to_player": "保持观察",
    "territory_refs": ["北广场临时水点"],
    "member_refs": ["沈遥"],
    "known_facts": ["他们每天只开放两次水点。"],
    "player_claims": [],
    "rumors": ["有人说他们藏着一台还能工作的发电机。"],
    "status": "活跃",
    "authority": "soft"
  }
}
```

规则：

- `id`、territory/member 引用只有已有稳定引用时才填写，自然名称也可以使用。
- 态度、成员关系和地盘默认是当前冒险的语义记录，不自动变成数值声望系统。
- 传闻保持 `rumor`，不要因为一次提及创造庞大的场外组织结构。
- 只提交当前需要的字段，实际 Tool Schema 是协议权威。
