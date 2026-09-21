# 旧运行规则参考

[grey-crow-runtime-policy.md](grey-crow-runtime-policy.md)是旧运行链规则草案。它不是当前执行入口，当前[打包配置](../../apps/desktop/electron/package.json)也不将该草案作为运行资源。

当前规则落实在[会话执行](../../engine/session/)、[正式存储](../../engine/session/turn-store.js)与[桌面桥](../../engine/bridge/session-desktop-bridge.js)中；不要按旧手册恢复已删除的上下文装配器或提交检查器。产品边界见 [PRODUCT.md](../../../PRODUCT.md)，内容加载流程见[内容导航](../README.md)。
