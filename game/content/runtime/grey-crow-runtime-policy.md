# Grey Crow Runtime Policy

状态：active correction draft

用途：这个文件承接旧 `AGENTS.md` / `STATE_CONTRACT.md` 中真正需要进入独立版 Runtime 的规则。它不是开发手册，也不是给玩家看的说明；它描述 Context Anchor Builder、Tool Router、Hard Commit Validator 和 Memory Store 的运行边界。当前代码文件名可能仍保留 `context-assembler.js` / `fact-gate.js`，但后续语义按本文收窄。

## Authority Chain

1. `State Store`：当前存档、当前位置、基础玩家状态和少量 UI 必需状态的权威来源。
2. `World / Character / Timeline Save Records`：长期世界、地点、人物、阵营和玩家创造内容的当前 saveRoot 记录来源。
3. `Hard Commit Validator / Commit Gate`：极窄 App / UI 必需状态能否进入 State Store 的保护层，不是 CRPG 规则引擎。
4. `Memory Store`：审计、摘要、玩家声明和回合记忆；只能提供上下文，不能覆盖 State Store。
5. `Host Profile`：主持人格和裁决倾向；不能直接写状态。
6. `Player Input`：玩家意图和叙事材料；不是世界事实。
7. `Model Output`：候选叙事和候选事件；不是世界事实。

## Turn Lifecycle

每轮必须按这个顺序执行：

1. `BeforeTurn`：读取 save id、当前状态、最近 memory 和可用工具。
2. `AssembleContext`：注入 Host Profile、Runtime Context、允许工具和玩家输入。
3. `ModelCall`：Provider / Harness 只负责生成候选输出。
4. `ParseResponse`：解析 `narration`、`candidate_events`、`memory_notes`、`uncertainties`。
5. `BeforeCommit`：Hard Commit Validator 只校验极窄 App 状态 proposal。
6. `Commit`：只提交通过校验的 App state changes。
7. `AfterCommit`：写入 audit / memory / saveRoot records，刷新 state projection。
8. `ProjectResponse`：只返回 UI 可见 envelope、state hint 和安全错误。
9. `AfterCompact`：需要时压缩已确认审计记录，保留 source range 和 state anchor。

任何步骤失败都返回结构化错误；不能用叙事补写状态。

## Runtime Lifecycle

这些能力由 Desktop main / Runtime 拥有，不能作为模型工具：

- `new_game_init`：创建新存档后，由 Desktop Bridge 调用 Runtime 初始化最小 App / UI state、saveRoot 骨架和开场锚点；API Key 测试结果只能解锁流程，不能进入 State Store / Memory Store。
- `save_lifecycle`：负责 list / create / restore / rename / snapshot / delete / overwrite contract；renderer 只拿 summary projection，不拿本地路径、raw state 或 secret。删除和覆盖必须由 Runtime 发放短期 confirmation token；当前覆盖执行器在没有明确替换来源前保持关闭。

玩家自定义开局文本、背景设定或偏好只能作为候选材料，不能被 `new_game_init` 直接写成事实。

## Routing Policy

Tool Router 只能暴露本轮必要工具：

- `read_state`：默认允许，读取当前状态投影。
- `read_fact`：兼容旧工具名；默认只读取当前 Runtime 可安全投影的状态 / 记录摘要，不把结果自动升级成世界硬事实。
- `read_map`：默认允许，读取已确认地图、地点、出口、附近点和路线约束；没有地图数据时只能返回 State Store 当前地点 fallback 和 unknowns。
- `search_memory`：默认允许，但结果必须标注 `not_fact`。
- `propose_event`：默认允许，只产生候选事件。
- `write_save_record` / current domain write tools：默认允许写入不越过物理 / 世界锚点的角色、地点、时间线、玩家声明、尝试或叙事记录。
- `propose_hard_state_change`：只用于当前存档、当前位置、基础 UI 状态等 App 必须强一致字段，提交必须经过 Hard Commit Validator。
- `append_memory`：默认不直接暴露给模型，由 Runtime 在审计阶段调用。
- `compact_context`：默认不直接暴露给模型，由 Runtime 在维护阶段调用。

禁止模型直接调用：

- `commit_event`
- `new_game_init`
- `save_lifecycle`
- 任意 shell
- 任意文件读写
- 任意网络扫描
- 任意 OpenClaw session / Gateway 控制
- 任意图片生成、图片 relay、场景图或肖像图工具

## Commit Policy

App state proposal 进入 State Store 前必须满足：

- 不与当前 State Store / World Fact Store 冲突。
- 不把玩家猜测写成 NPC 动机、记忆、承诺或关系。
- 不凭空给玩家增加物品、能力、地点权限或阵营关系。
- 不让 memory summary 覆盖当前 App state。
- 不让 narration 或 save record 代替 App state 提交。
- 涉及消耗、移动、风险、时间推进或伤害时必须有明确代价或校验理由。

不确定时输出 `uncertainties`，或请求只读工具补事实；不要直接提交 App state。合理叙事优先读取 Skill，并写入当前 saveRoot 的 Memory / World / Timeline 记录。

## Memory Policy

Memory 只能保存：

- 已确认事件的审计摘要。
- saveRoot narrative records、player claim、attempt、proposal 和 narrative event 的可检索记录。
- 工具调用审计。
- 被 Runtime 标记为非权威的短记忆。
- 压缩摘要的 source range、state anchor 和安全统计。

Memory 不能保存：

- API Key、provider raw body、prompt、messages、local path。
- 未经过 Runtime guard 的 App state proposal 细节。
- 玩家输入全文作为未来硬事实。
- 任意图片生成提示词或图片路径作为核心 Runtime 事实。

## Excluded Capabilities

这些能力不进入 P2-03 迁移包：

- 图片生成、图片展示、图片 relay、`scene-visualizer`、肖像图、场景图。
- TTS 后端和音频缓存。
- Feishu / Slack / Discord / Teams 等外部通道。
- OpenClaw CLI、Gateway、旧 session、固定机器路径。
- Git hooks 或公开 plugin hooks。
- 开发期 skill 生成工具。
