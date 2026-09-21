# Grey Crow 核心源码导航

产品目标见 [PRODUCT.md](../../PRODUCT.md)，当前状态和分层待办见 [REBUILD.md](../../REBUILD.md)。本页只说明目录职责，不规定下一步架构。

| 问题 | 主要代码入口 |
| --- | --- |
| 会话装配与桌面接入 | [会话](session/adventure-session.js)、[桌面桥](bridge/session-desktop-bridge.js)、[子进程](session/session-process.js) |
| 模型请求、工具与纠正 | [请求装配](session/turn-request.js)、[生成循环](session/turn-generator.js)、[纠正反馈](session/session-repair-feedback.js) |
| 行动身份、提交与恢复 | [行动协调](session/turn-coordinator.js)、[正式存储](session/turn-store.js) |
| 上下文、整理与长期记忆 | [上下文](session/session-context.js)、[整理](session/session-compaction.js)、[检索](session/turn-memory.js) |
| 玩家投影与章节 | [投影](session/session-projection.js)、[章节](session/session-chapters.js) |
| 开局、结局与续篇 | [开局](session/session-opening.js)、[结局](session/session-finale.js)、[续篇](session/session-continuation.js) |
| 模型协议与能力目录 | [providers/](providers/README.md) |
| 内容加载、快照与校验 | [content-v2/](content-v2/)、[contracts/v2/](contracts/v2/)；这些合同不等于会话全部接口 |
| 共用时间、上下文与存储策略 | [runtime/](runtime/)：`model-time-policy.js`、`context-window-policy.js`、`storage-utils.js` |
| 朗读调度与分段 | [语音服务](tts/tts-service.js)、[文本分段](tts/utterance-planner.js)；[资源说明](../vendor/tts/README.md) |

沿选中入口查看调用者、消费者及相邻 `*.test.js`，无需默认通读整个目录。启动、默认检查与定向检查见 [游戏目录说明](../README.md)；本文不重复测试数量、历史结果或待办。
