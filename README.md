# 灰鸦 · Grey Crow

简体中文 | [English](README.en.md) | [日本語](README.ja.md)

用自然语言行动，让故事记住你的选择。

灰鸦是一款本地优先的桌面文字冒险。你以主角身份与人物交谈、探索环境、作出承诺，再面对这些选择带来的后果。默认剧本从上海爆发后第十天前后开始。

游戏通过玩家与 AI 的交互推进，不采用血量、攻击力或隐藏分数来裁决行动。人物的身体状况、已有事实与关系为叙事提供约束；模型生成仍有不确定性，剧情一致性与长期记忆需要持续通过实际游玩检验。

> 项目正在进行玩家测试。已实现的功能、自动检查通过和正式发布验收是不同状态；当前不承诺稳定发行版或全平台兼容。

## 可以怎样玩

- **自由表达行动**：直接描述想说的话、想做的事，不必记忆指令。
- **查看故事留下的变化**：日记本侧栏提供人物、资料、状态和章节回顾；重要经历参与后续上下文与记忆检索。
- **保存与继续**：每个冒险独立保存，支持恢复、章节回顾和故事导出。
- **说话与听故事**：可选本地中文、英文、日文语音输入；中文朗读提供四套音色。识别后的文字由玩家检查并发送。
- **逐步认识界面**：提供入门教程、DeepSeek 注册帮助、游戏内逐项遮罩引导，以及设置中的重看与重置入口。

界面支持简体中文、英文和日文，以及亮、暗日记本主题。语言和视觉效果仍需玩家及母语者反馈。

## 模型与资源

**源码仓库不附带故事生成模型或本地语音模型的权重，也不提供 API 密钥或免费调用额度。** 设置中的模型选择与自定义连接用于配置模型服务，不包含模型本体。

- **故事生成**：使用自己配置的模型服务与 API 密钥；连接测试和游玩可能产生服务商费用。
- **语音输入与朗读**：源码包含接入代码与资源准备说明，开发者需另外准备模型权重和对应平台运行组件。维护者单独提供的 Windows 完整测试包已带本地语音资源，下载源码不等于下载该测试包。

### 下载模型资源

以下链接指向当前代码使用的固定版本，无需下载整个模型仓库：

| 用途 | 直接下载 | 来源 |
| --- | --- | --- |
| 语音识别：SenseVoice Small INT8，约240 MB | [model.int8.onnx](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx) · [tokens.txt](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt) · [LICENSE](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE) | [sherpa-onnx 维护者转换版本](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07) |
| 中文朗读：Kokoro-82M-v1.1-zh | [kokoro-v1_1-zh.pth](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/kokoro-v1_1-zh.pth) · [config.json](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/config.json) | [Kokoro 官方固定版本](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/tree/01e7505bd6a7a2ac4975463114c3a7650a9f7218) |
| Kokoro 四套音色 | [zf_001.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zf_001.pt) · [zf_006.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zf_006.pt) · [zm_009.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zm_009.pt) · [zm_010.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zm_010.pt) | 同上，需与主权重一起准备 |

**语音识别的快捷准备方式**：在 `game/apps/desktop/electron` 目录执行 `npm run prepare:speech-input:model`，自动下载、校验并写入 `speech-input/.model/`，同时补齐完整模型协议。若已通过上面的链接手动下载，将识别用的三个文件保持原名放在同一缓存目录，再运行 `node scripts/prepare-speech-input-model.js --work-dir <缓存目录>`；有空格的路径需加引号。原生识别程序另按[运行层说明](game/apps/desktop/electron/speech-input/native/README.md)准备。

**Kokoro 下载后还需要平台运行环境**：权重与音色文件本身不是可直接导入游戏的完整语言包。目录结构、下载脚本与平台准备入口见[朗读资源说明](game/vendor/tts/README.md)。完整 Windows 测试包已带这些资源，玩家不必重复下载。上述地址使用 Hugging Face；若所在网络无法访问，可使用维护者提供的完整测试包，此处不承诺各地区的下载可达性。

## 开始测试

测试包由维护者单独提供。取得 Windows 完整测试 ZIP 后，请先完整解压，再运行其中的 `Grey Crow.exe`；不要只复制程序文件。完整声音包带有本地识别和中文朗读所需资源，无需另装 Python 或下载模型。未签名测试包可能显示未知发布者提示。

首次启动时，按照教程在设置中填写自己的模型 API 密钥（调用模型服务所用的访问凭据），点击“测试并使用”，然后创建冒险。已经有存档时可选择继续。

**本地优先不等于完全离线。** 存档与设置保存在本机；剧情生成会把必要的故事上下文发送到你选择的模型服务，连接测试和游玩可能产生服务商费用。语音识别与本地朗读在本机运行。项目不提供共享密钥，也不在源码中包含云端大模型权重。

替换程序目录不会自动删除系统用户目录中的存档和设置。遇到问题，可在设置中选择“导出问题报告”，并附上系统版本、操作步骤、提示文字或截图；不要提交 API 密钥、私人存档或录音。

## 从源码启动

本地验证环境使用 Node.js `22.22.1` 和 npm；依赖安装、测试与桌面启动均从 Electron 目录执行。Electron 是本项目采用的桌面应用框架。

```sh
git clone https://github.com/zzh8080089/grey-crow.git
cd grey-crow/game/apps/desktop/electron
npm ci
npm start
```

`npm ci` 会安装锁定依赖并下载 Electron。启动后仍需在游戏设置中配置模型连接。安装、源代码检查或连接探测通过，均不代表某个模型的叙事体验已被接受。

**源码克隆不附带本地语音模型和平台原生组件。** 文字冒险可以先独立运行；启用语音前，按[语音输入运行层说明](game/apps/desktop/electron/speech-input/native/README.md)准备对应平台的识别程序和模型，按[朗读资源说明](game/vendor/tts/README.md)准备语言包。识别、朗读是两条不同的资源链路。

源码仓库只保留正式游戏代码、内容与资源、构建脚本、回归测试，以及必要的使用说明和许可证。所有实验室、候选方案、历史实验报告、临时产物和个人开发配置留在维护者的本地工作站；正式语音资源准备工具位于 `game/vendor/tts/`。

早期正式美术按内嵌生成器声明、历史制作记录或维护者的 GPT Image 2 生成说明分别登记，见[素材来源记录](game/apps/desktop/electron/renderer/assets/provenance.json)。维护者说明不等于独立核验，程序源码许可不额外授予素材再使用权。

完整模型包的准备、许可保留与检查顺序见[打包清单](game/apps/desktop/PACKAGING_CHECKLIST.md)。普通主体构建不会自动生成 Kokoro 朗读运行环境；Windows 交叉构建通过也不能替代 Windows 实机验证。

## 架构与源码入口

| 部分 | 职责 | 入口 |
| --- | --- | --- |
| 桌面与界面 | 日记本、输入、设置、语音、受限宿主通信 | [desktop](game/apps/desktop/README.md) |
| Agent 与 Harness | 一个主智能体；Harness 是组织上下文、模型调用、工具执行与纠正的框架 | [session](game/engine/session/) |
| Runtime 与记忆 | 运行时负责行动提交、取消与恢复、每个冒险独立的 SQLite 数据库及记忆检索 | [engine](game/engine/README.md) |
| 内容与投影 | 世界、主持与能力内容编译为冒险快照；正式状态转成玩家可读的界面与章节 | [content](game/content/README.md) |

模型提出叙事与工具请求，程序校验并提交正式结果，界面显示对应版本的数据。详细实现以源码为准；README 只做公开入口，不另设产品目标或开发状态。

## 开发检查

在 `game/apps/desktop/electron` 中按改动范围运行：

```sh
npm run check:session              # 会话、桥与存档自动测试
npm run check:renderer-boundaries  # 界面边界自动测试
npm run check:player-guide         # 教程记录与脚本检查
npm run smoke:ui:game-tour         # 真实桌面的界面引导检查
npm run check                     # 完整默认检查，会打开桌面窗口
```

上述桌面检查使用隔离临时数据、合成模型响应，不需要真实故事模型密钥。同一时间只运行一组桌面界面检查，避免窗口焦点相互干扰。语音、记忆、叙事质量和目标平台的实际表现需分别验证，更多入口见[测试导航](game/README.md)。

## 正在讨论的方向

- **微信继续冒险**：下一阶段重点讨论可选、独立的消息入口，让玩家通过微信延续电脑中的同一局；绑定、权限、消息顺序、分段和错误返回尚待设计。
- **AI 辅助世界与剧本创作**：考虑逐步开放世界设定、世界书与剧本编辑，并通过 MCP（模型上下文协议，用于让外部 AI 调用应用能力）或同类接口连接创作工具。具体范围、接口和授权方式尚未确定。

这两项均为后续讨论方向，当前没有正式微信接入或开放的 MCP 创作服务。既有内容管理代码不等于通用世界编辑器已经对外开放。

## 贡献与反馈

改进记忆系统可从 `game/engine/session/` 的 `turn-memory.js`、`session-memory-source.js` 与相邻测试开始；修改应验证实际召回和重启后的使用，不能只看记录是否写入。建议先用一个问题说明玩家收益与改动边界，再提交小范围修改和相应测试。

提交问题时，请说明实际行为、预期行为、复现步骤与系统版本。涉及玩家体验时，区分程序错误、模型生成偏差和个人偏好；涉及修改时，优先提交一个边界明确、可验证的改动。

贡献前请阅读 [AGENTS.md](AGENTS.md)。稳定产品目标见 [PRODUCT.md](PRODUCT.md)，当前工作、代表证据和待验证边界见 [REBUILD.md](REBUILD.md)。新增文件应服务正式产品的运行、构建、验证或必要说明；实验材料不直接并入源码仓库。

产品方向与维护：[zzh8080089](https://github.com/zzh8080089)。AI 开发协作：**OpenAI Codex**。完整署名与重构里程碑见 [CONTRIBUTORS.md](CONTRIBUTORS.md)。

## 许可证

项目自有程序源码采用 [PolyForm Noncommercial License 1.0.0](LICENSE)：允许在条款规定的非商业用途下使用、研究、修改和分发，**本许可不授予商业用途的使用权**。本项目目前属于源码可查看、限非商业用途的软件，不属于[开放源代码促进会所定义的开源软件](https://opensource.org/osd)。完整许可条件以英文 LICENSE 原文为准，本说明只作摘要。

该许可仅适用于项目自有程序源码，不覆盖游戏世界、剧本、文档、美术、音频、字体、模型权重或品牌资源；这些内容的复用权以其各自声明为准，未单独声明的不因源码许可而取得复用授权。第三方代码及单独声明许可的文件继续遵守各自条款，不能用本项目的非商业限制覆盖它们已授予的权利。

- [第三方组件与资源通知](game/apps/desktop/electron/THIRD_PARTY_NOTICES.md)
- [本地识别依赖、模型来源及完整协议](game/apps/desktop/electron/speech-input/native/licenses/ATTRIBUTION.md)
- [字体来源与随附许可证](game/apps/desktop/electron/renderer/assets/fonts/manifest.json)
- 羽毛摄影及其衍生画面采用 CC BY-SA 4.0：见[日记本静帧](game/apps/desktop/electron/renderer/assets/theme-study/ATTRIBUTION.md)、[开书影片](game/apps/desktop/electron/renderer/assets/page-reveal/LEAF_ATTRIBUTION.md)和[书写动效](game/apps/desktop/electron/renderer/assets/quill-writing/ATTRIBUTION.md)的作者、来源、修改与许可说明。

SenseVoice 的模型权重与源码使用不同许可；Kokoro 的模型、音色及其运行依赖也需分别保留通知。
