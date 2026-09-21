# 能力内容与构建源

本目录的 Skill 是游戏能力内容与模板。产品范围见 [PRODUCT.md](../../../PRODUCT.md)；目录或清单存在，不代表旧操作协议或所有能力已在当前会话实现。

| 入口 | 当前用途 |
| --- | --- |
| `new-game/` | 构建脚本编为默认包的 `new-game-default`，包含开局、本地化与模板 |
| `game-state/`、`map/`、`entity-memory/`、`story-finale/`、`extreme-ending-easter/`、`memory-fragment/` | [内容构建脚本](../../apps/desktop/electron/scripts/build-builtin-content-pack.js)选取的能力源；实际选定项见[生成包清单](../packs/grey-crow-default/manifest.json)与[预设](../packs/grey-crow-default/presets/default.json) |
| [index.v1.json](index.v1.json) | 仍由[设置目录](../../apps/desktop/electron/settings-store.js)读取，不是当前模型工具路由表 |
| `delete-game/`、`game-save/`、`summarize/`、`_template/` | 保留的旧内容或模板，不在当前默认包构建选择中 |
| `tool-specs.v1.json`、`runtime-skill-rewrites.v1.json` | 旧原型草案，不作为当前执行入口，也不进入当前运行资源包 |

生成包经校验和选择后编为冒险快照，细节见[内容导航](../README.md)。[桌面会话桥](../../engine/bridge/session-desktop-bridge.js)提取当前支持的开局、结局、记忆碎片等内容，并区分实际实现与待接入能力；模型可用工具与正式提交行为以[会话源码](../../engine/session/)为准。

本轮只修正导航，能力正文、深层模板、本地化与模块定义均保留；不从旧手册恢复已删除的文件写入工具，也不据历史扩展设想启动平台开发。
