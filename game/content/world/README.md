# 世界内容构建源

[上海第十天世界卡](world-card.shanghai-day10.md)及`locales/`、`localizations.json`由[内容构建脚本](../../apps/desktop/electron/scripts/build-builtin-content-pack.js)编入[默认世界内容](../packs/grey-crow-default/world/WORLD.md)。正式加载入口以[内容包清单](../packs/grey-crow-default/manifest.json)和冒险锁定的快照为准。

基础世界是叙事背景；玩家冒险中已发生的事件、物品归属和人物情况由[正式存储](../../engine/session/turn-store.js)管理，不能用基础卡覆盖。内容选择、编译与快照流程见[内容导航](../README.md)，稳定世界与产品范围见 [PRODUCT.md](../../../PRODUCT.md)。
