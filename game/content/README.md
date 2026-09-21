# 游戏内容导航

这里保存内置内容的构建源、生成内容包和保留的旧参考材料，不保存玩家当前状态。产品目标见 [PRODUCT.md](../../PRODUCT.md)，当前实现与待验收项见 [REBUILD.md](../../REBUILD.md)。

## 当前内容链路

1. [内容构建脚本](../apps/desktop/electron/scripts/build-builtin-content-pack.js)从 `host/`、`world/` 和选定的 `skills/` 内容及其本地化资源生成 [默认内容包](packs/grey-crow-default/manifest.json)；默认选择见[开局预设](packs/grey-crow-default/presets/default.json)。
2. [内容加载](../engine/content-v2/built-in-pack.js)与[内容库](../engine/content-v2/content-library.js)校验内容包、解析选择；[快照编译](../engine/content-v2/snapshot-compiler.js)把所选主持人、世界、开局和能力资源锁定到该冒险的内容快照。
3. [快照读取](../engine/content-v2/snapshot-reader.js)核对文件与指纹，[桌面会话桥](../engine/bridge/session-desktop-bridge.js)从快照及本地化结果提取当前会话实际使用的内容。内容包声明存在不等于其中每项能力已经接入；实际行为看[会话源码](../engine/session/)。

## 按用途找文件

| 目录 | 用途 |
| --- | --- |
| [host/](host/README.md)、[world/](world/README.md) | 主持风格与世界卡的构建源；不是每轮直接读取整目录 |
| [skills/](skills/README.md) | 开局及能力内容、模板与本地化构建源；部分旧材料仍保留 |
| [packs/grey-crow-default/](packs/grey-crow-default/) | 生成的内置包；运行时内容入口以其清单与冒险快照为准 |
| [agent/](agent/README.md)、[runtime/](runtime/README.md) | 旧操作手册与规则参考，不代替当前工具或提交实现 |
| [map/](map/README.md) | 尚无基础地图数据的预留目录 |

已发生的故事和状态由[正式存储](../engine/session/turn-store.js)管理，不能通过修改基础世界卡改写。内容正文、模板与本地化资源可能被构建消费；README只做导航，不要求开发者或模型逐份阅读全部材料。
