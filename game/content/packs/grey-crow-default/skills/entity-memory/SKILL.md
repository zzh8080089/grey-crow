---
id: entity-memory
title: 实体与世界记忆
kind: read-write
activation: model_can_invoke_when_entity_or_world_fact_is_relevant
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: false
---

# 实体与世界记忆

当人物、地点、阵营、命名物品、传闻或之前发生的事情会影响当前回合时，按需读取或更新当前
冒险的语义记录。模型决定是否读写；触发提示只帮助发现本 Skill，不是强制执行条件。

## 何时使用

- 某个持续存在的人物、地点、阵营或物品再次出现，或本轮首次变得重要。
- 主持人准备声称某个实体已知、在场、归属、敌对、结盟或发生持续变化。
- 玩家提到旧线索、传闻、关系或地点，而近期对话不足以确认细节。

## 操作流程

1. 先调用 `inspect_skill(skill: "entity-memory", view: "lookup", query: ...)` 检索已有记录；只想回看近期记录时使用 `recent`。
2. 如果命中已有地点或物品，更新时复用返回的 `reference`；是否为同一实体仍由模型根据叙事判断。
3. 地点调用 `record_location_memory`，命名物品或线索调用 `record_item_memory`；只提交名称、短摘要、authority 和可选 reference。
4. 玩家声称、尝试和传闻保持对应的不确定 authority，不自动升级为已确认状态。
5. 如果变化还需要显示在右侧当前状态，再单独读取 `game-state`；领域记录本身不会自动改 UI。

## 写入边界

- 人物使用 Character Skill 的具名动作；地点使用 `record_location_memory`，物品使用 `record_item_memory`；
  阵营和重要经过继续使用当前 Router 暴露的对应领域动作。
- authority 只使用 `soft`、`player_claim`、`rumor`、`attempt` 或 `narrative_event`。
- 当前 Tool Schema 是字段、长度和类型的协议权威；不要附加路径、文件名、模板 ID 或未声明字段。
- 不修改只读世界卡、Skill 或内容快照，不使用任意文件工具。
- 不把普通叙事强制写成状态机；有持续价值时才写，写入失败也不能阻止主持人正常回应玩家。
