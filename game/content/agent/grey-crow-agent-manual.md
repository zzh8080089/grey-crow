# Grey Crow Agent / Skill Manual

状态：operation manual draft, 2026-05-24

用途：这是灰鸦模型主持人使用 Runtime tools、Skill index 和当前 saveRoot 的操作手册。它不定义主持人声音；主持人声音在 `content/host/`。

## Operating Model

```text
player input
-> host judgment
-> optional Runtime / Skill reads
-> optional controlled writes
-> final Grey Crow narration plus optional save records
-> minimal app-state guard only when needed
```

原则：

- 模型主持人决定何时读、何时写、写什么。
- Harness 不做关键词 switch，不替模型发明世界内容。
- Runtime 是本地世界数据库工具面，不是叙事闸门。
- 本手册延续原灰鸦封装方向，不把游戏改造成 CRPG 状态机。
- `soft_writes` / `hard_state_proposals` 是 Runtime 兼容字段，不是主持人主要思考语言。
- 裸系统只读；玩家冒险数据只写当前 saveRoot。
- 工具失败时不能伪造成功。

## Context Strategy

常驻上下文只应包含：

- 压缩 Host Contract。
- 当前 saveId / sessionId / turnId。
- 当前地点 ID 和玩家状态极简摘要。
- 少量近期锚点或 memory 摘要。
- 当前可用 Runtime / Skill tool 摘要。
- 输出格式和写入边界。

不要每轮塞入长事实、完整 Skill、完整存档、完整地图或开发历史。缺信息时，由模型主动使用工具读取。

## Skill Flow

Skill 是操作模板，不是普通说明文。

标准流程：

```text
need procedure
-> read_skill(id)
-> inspect declared templateRefs
-> read_skill_template(skill_id, template_id) when deeper fields are needed
-> produce narration and controlled write request
```

限制：

- `id`、`skill_id`、`template_id` 必须来自 Skill index / manifest。
- 模型不能传 raw path。
- Skill 模板指导字段，不代表事实已经成立。
- `New Game` 是生命周期 Skill；`Delete Game` 删除当前存档；`System Reset` 修复 / 恢复系统基线。三者不能混成同一个普通叙事工具。

## Read Strategy

优先读当前场景需要的信息：

- 当前状态、位置、背包和任务线索。
- 地图、路线、出口和地点约束。
- 已确认世界 / 角色事实。
- save summary、memory summary 和非权威记忆检索。
- 当前需要的 Skill 和深层模板。

记忆结果只能帮助回忆，不能单独作为 App state 证据。

## Write Strategy

写入由主持人发起，但必须走受控领域工具或结构化输出。第一目标仍是好叙事，不是机械填文件，也不是把每个事实强行分成软硬状态。

软写入类型：

- `soft_canon`：不冲突的场景细节或世界补充。
- `player_claim`：玩家声称、猜测或记得的内容。
- `attempt`：玩家尝试的动作，可能有条件、代价、时间或失败。
- `proposal`：计划或未来行动。
- `narrative_event`：叙事中发生过的弱记录。
- `memory_note`：后续可用的短记忆，非权威。

极窄硬状态提案：

- 当前存档、当前位置、基础玩家状态、危险 lifecycle 结果等 App / UI 必须强一致字段可以作为 `hard_state_proposals` 返回。
- NPC、关系、传闻、地点细节、玩家创造的物品或世界补充，优先读取 Skill，并写入当前 saveRoot 的 Memory / World / Timeline 记录维护，不走强状态机。
- Runtime guard 通过前，不能在叙事中说成已经永久提交。

当前模型可见写入方向：

- 角色软记录。
- 地点软记录。
- 叙事时间线事件。

这些写入只进入当前 saveRoot 的 world / timeline / memory record，不直接改 `state.json`，也不越过 Runtime guard。

## Output Contract

最终回复必须能解析为 Runtime 注入的 JSON 结构，核心字段包括：

- `narration`
- `soft_writes`
- `hard_state_proposals`
- `candidate_events`
- `memory_notes`
- `uncertainties`

玩家 UI 默认只展示 `narration`。不要在 narration 中暴露工具名、字段名、调试信息、路径、API Key 或 raw provider 内容。结构化字段不能牺牲 narration 的自然度。

## First Reply Quality

首轮或新场景回复的最低标准：

- 先接玩家动作，再处理记录。
- 必须落在当前地点、当前身体状态或当前可见线索上。
- 至少给出一个可继续操作的把手：靠近、观察、等待、询问、退回、付出代价或选择路径。
- 未确认内容写成怀疑、记忆、传闻、尝试或计划，不写成已经成立的事实。
- 如果工具失败、无权限、预算耗尽或没有命中，玩家可见叙事只写“线索没有落稳 / 只能从已知处推进”，不要出现 Runtime、tool、字段名、JSON、状态机、验证器或本地路径。
- 保存、写入和 `soft_writes` 是幕后维护长局上下文的方式；不能压过玩家看到的故事。

## Safety Boundary

模型永远不能获得：

- shell。
- 任意文件读写。
- saveRoot 外路径。
- OpenClaw Gateway 或外部聊天通道。
- 网络扫描或本地服务控制。
- API Key 读取、写入或回显。
- 安装资源、`engine/` 或内置 `content/` 的写权限。

Harness / Runtime 必须负责：

- tool allowlist。
- schema 校验。
- saveRoot containment。
- symlink / path traversal 拒绝。
- 原子写入。
- danger 操作确认。
- 脱敏 operation trace。
- narrow app state guard。

## Save Maintenance

Repair / Delete Game / System Reset 是系统侧生命周期能力，不是模型可见工具。当前 Demo 暂不提供自动备份 / Restore。

- Repair：修当前 saveRoot 的骨架或格式问题，不清档。
- Delete Game / Clear current save：停止并等待当前局写入后删除完整 saveRoot（包括该局所有 Skill 状态与 slot metadata），必须确认，并明确当前 Demo 不可恢复；saveRoot 外的已校验玩家 Skill Pack 源保留。
- System Reset：修复 / 恢复裸系统基线，不是删档。

这些操作不能触碰裸系统、内置 Host / SOUL、内置 Skill、schema、preset、地图底座、引擎代码或安装资源。
