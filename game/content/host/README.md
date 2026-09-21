# 主持人内容构建源

[内容构建脚本](../../apps/desktop/electron/scripts/build-builtin-content-pack.js)的 `compileHost()`从以下正文提取指定章节，生成[内置主持人内容](../packs/grey-crow-default/host/HOST.md)：

- [角色卡](role-card.grey-crow.md)：身份、性格、语气、判断与边界。
- [声音参考](grey-crow-soul.md)：面向玩家的表达要求。
- [主持人契约](grey-crow-host.md)：叙事边界、场景质量与执行边界。

`locales/`及`localizations.json`提供对应本地化资源。黑鸦难度卡与`host-profile.v1.json`仍保留，但不是上述脚本的默认主持人编译输入。

正式会话读取冒险快照中的主持人内容，不直接把本目录整份正文每轮加载；链路见[内容导航](../README.md)。主持风格不授予工具权限或状态写入能力，实际行为由[会话源码](../../engine/session/)实现。稳定目标见 [PRODUCT.md](../../../PRODUCT.md)。
