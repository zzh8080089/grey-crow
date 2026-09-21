# 模型供应商适配导航

Provider 指模型供应商适配器。会话通过 `provider.generate()` 调用模型，供应商协议转换集中在本目录。

## 按职责查看

- [注册表](provider-registry.js)、[能力目录](model-catalog.js)：模型默认值、能力状态与请求上限；目录是仓库配置，不是供应商实时承诺。
- [协议转换](openai-compatible.js)、[DeepSeek 配置](deepseek.js)：请求/响应转换与默认配置。
- [共用错误与脱敏](provider-contracts.js)、[传输错误与地址校验](provider-errors.js)；正式行动的错误处理在 [session-provider-error.js](../session/session-provider-error.js)。
- [连接探测](connection-probe.js)：工具往返与语言检查；不写游戏状态，但真实连接会调用模型并可能产生费用。
- [合成模型](mock.js)：本地检查的确定性替身，不代表真实模型能力。

## 消息与能力边界

内部工具调用使用 `toolCalls[]`、工具返回使用 `toolCallId`；协议层负责与供应商字段互转。`transportState` 只承载同一轮工具回放所需的数据，不能进入界面、存档、普通日志或压缩摘要。

能力按 `verified / unsupported / unverified`（已验证／不支持／未验证）区分；自定义模型档案为 `custom`。`providerMaxOutputTokens` 是目录记录的供应商能力，`adapterRequestCapTokens` 是本程序的请求保护上限。具体模型名称、状态与数值直接查能力目录，不在本文重复维护。

自定义连接的配置与探测门槛由桌面[连接模块](../../apps/desktop/electron/model-connections.js)和[主进程](../../apps/desktop/electron/main.js)消费；探测通过不代表叙事或母语体验合格。

## 安全与检查入口

- 连接密钥只用于请求鉴权，不进入模型档案、提示词、存档或普通日志；注册表的档案查询只返回能力元数据。
- 自定义端点使用公共 HTTPS，地址检查见上方传输模块，实际连接的域名解析校验与禁止重定向见[桌面传输](../../apps/desktop/electron/provider-https-transport.js)。
- 桌面 `scripts/check-model-connections.js`、`scripts/check-provider-https-transport.js` 是默认 `npm run check` 中的离线检查。运行目录见[游戏说明](../../README.md)；真实连接探测按具体授权执行。
