# Grey Crow 桌面源码导航

产品目标见 [PRODUCT.md](../../../PRODUCT.md)，当前工作与验证边界见 [REBUILD.md](../../../REBUILD.md)。本页按桌面代码职责导航，不另设产品要求或开发计划。

## 按问题查看入口

| 位置 | 职责 |
| --- | --- |
| [主进程](electron/main.js)、[预加载桥](electron/preload.js) | 窗口、宿主生命周期与受限进程通信 |
| [界面](electron/renderer/app.js)、[日记本样式](electron/renderer/notebook.css) | 渲染与交互；素材在同目录 `assets/`，语言文案在 `locales/` |
| [设置](electron/settings-store.js)、[模型连接](electron/model-connections.js)、[凭据](electron/credential-store.js) | 配置与安全存储 |
| [语音输入宿主](electron/speech-input/desktop.js) | 权限、生命周期与通信；同目录 service/resources/settings 负责识别、模型资源与设置 |
| [语音输入界面](electron/renderer/speech-input.js) | 录音、快捷键与草稿保护；同名前缀样式与采集线程文件负责外观和采集 |
| [桌面会话桥](../../engine/bridge/session-desktop-bridge.js)、[会话子进程](../../engine/session/session-process.js) | 请求适配、模型请求转发与取消 |
| [核心源码导航](../../engine/README.md) | 故事、记忆、章节、正式存储与投影的进一步入口 |

界面通过 preload 调用宿主，不直接读写存档或调用模型。凭据由宿主保管，不能进入提示词、存档、普通日志或浏览器存储。正式状态来自会话的 SQLite 存档，界面与章节消费对应版本的数据。

## 启动、检查与分发

启动、默认与定向检查见[游戏说明](../../README.md)，脚本定义见 [package.json](electron/package.json)。真实模型、资源下载、打包与发布按具体授权执行。

只有处理相应任务时再查：

- [打包清单](PACKAGING_CHECKLIST.md)：目标平台、资源、凭据、签名和分发检查。
- [图标说明](electron/build/README.md)：美术母版与图标派生。
- [语音资源说明](../../vendor/tts/README.md)：可选语音包及许可证材料。
- [本地识别运行层](electron/speech-input/native/README.md)：原生组件、协议与许可证。`npm run smoke:speech-input` 运行真实本地识别，需显式指定已校验模型与预录音频，见[脚本参数](electron/scripts/check-speech-input-desktop.js)；不自动下载资源，不代表真人麦克风验收。

验证随包模型时，从 `electron/` 运行以下专用场景；模型和预录音频路径必须替换为已准备的绝对路径。测试逐文件验证模型，不创建个人模型副本，禁止网络下载；图形界面与本地识别是真实执行，麦克风由预录音频代替。目标平台需先具备同平台原生组件。

```bash
GREY_CROW_SPEECH_TEST_MODEL='/absolute/path/to/verified/model' \
GREY_CROW_SPEECH_TEST_AUDIO='/absolute/path/to/official/zh.wav' \
node scripts/check-speech-input-desktop.js --suite=trial --bundled
```

源码启动不等于已有可分发安装包，历史实验或打包结果不代表当前版本。
