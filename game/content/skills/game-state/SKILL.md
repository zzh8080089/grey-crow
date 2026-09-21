---
id: game-state
title: 游戏状态
kind: read-write
activation: model_or_menu
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: true
---

# 游戏状态

当玩家询问当前状态，或本轮已经确认身体、背包摘要、主要场景锚点发生变化时，读取并更新
玩家可见的当前状态。它不是完整世界历史，也不要求每轮都写状态。

## 何时使用

- 玩家询问自身状态、背包、当前场景、活跃任务或可执行行动时读取。
- 当前回合确认了身体状况、背包摘要或主要场景锚点变化时使用。
- 缺少当前状态锚点会导致叙事混乱时读取。

## 操作流程

1. 需要确认当前锚点时调用 `inspect_current_situation`，或读取 `inspect_skill(skill: "game-state", view: "overview")`，不要凭旧摘要覆盖新状态。
2. 判断变化是否属于玩家状态、背包摘要或主要场景锚点；普通姿态、视角、声音和氛围继续留在叙事中。
3. 位置变化调用 `confirm_current_location`，身体状态调用 `update_player_condition`，物品增减调用 `record_inventory_change`。
4. 每次只提交已经在当前叙事中确认的一项变化；Runtime 负责数量、版本、幂等和 App / UI 投影。
5. 工具失败时保留叙事结果并说明状态尚未写入，不要伪称更新成功。

## 边界

- 不把返回状态中不存在的内容推断成已确认事实。
- 玩家看见或谈到一个物品，不等于物品已经进入背包；持续物品细节使用 `entity-memory`。
- 地点细节和路线记录使用 `entity-memory` 或 `map`；这里只维护玩家当前的主要场景锚点。
- 当前 Tool Schema 是参数协议权威，模板只解释何时写和如何缩小写入范围。
- 不请求任意文件写入，不修改只读内容快照，也不向玩家暴露内部路径或调试信息。
- 当前内容语言为中文时使用自然中文；专有名词可以保留原语言，不做映射表翻译。
