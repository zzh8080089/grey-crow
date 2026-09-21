# 本地朗读资源

本目录只保留正式朗读所需的模型准备、运行环境封装和许可证输入，不包含音色试听台、候选模型评测或历史报告。正式朗读代码使用原版 Kokoro 中文语言包，提供四套音色。完整 Windows 测试包将模型、音色和平台私有运行环境放在 `resources/tts/kokoro-original-zh/`；这些大文件不随源码克隆提供，也不由普通 Electron 主体构建自动准备。

## 模型下载与开发准备

官方来源为 [hexgrad/Kokoro-82M-v1.1-zh 固定版本](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/tree/01e7505bd6a7a2ac4975463114c3a7650a9f7218)。主权重、配置及四音色的直接下载链接列在根目录 [README](../../../README.md#下载模型资源)；无需下载其他音色或样本。

若已有安装 `huggingface_hub` 的 Python 环境，可从仓库根目录使用固定版本下载脚本：

```sh
python3 game/vendor/tts/scripts/download-kokoro-original-model.py --output game/vendor/tts/.runtime/kokoro-original/model-download
```

脚本只下载六个模型文件并记录来源与哈希，不安装游戏语言包。运行包中的最终位置为 `<运行包根目录>/models/kokoro-original/`，包含 `config.json`、`kokoro-v1_1-zh.pth`、`zf_001.pt`、`zf_006.pt`、`zm_009.pt`、`zm_010.pt`；音色在这里平铺，不保留上游的 `voices/` 子目录。完整运行包还需私有 Python、依赖、许可证和组件清单。

- Windows x64 开发准备入口：[stage-kokoro-original-windows.ps1](scripts/stage-kokoro-original-windows.ps1)。需可用的 Python 3.12 和 PowerShell，会联网安装依赖、下载固定模型并重建其输出目录；这是开发构建脚本，不是玩家安装器。默认输出 `game/vendor/tts/.runtime/kokoro-original/stage-windows-x64-minimal/`。
- macOS Apple Silicon 开发准备入口：[setup-kokoro.sh](scripts/setup-kokoro.sh)及[stage-kokoro-original-macos.sh](scripts/stage-kokoro-original-macos.sh)。前者准备依赖，后者要求事先备齐脚本指定的固定模型缓存和 `voice-library/voices/` 四音色，不会自动补齐它们。开发默认读取 `game/vendor/tts/.runtime/kokoro-original/stage-macos-arm64-minimal/`。
- 使用其他运行包位置时，通过绝对路径环境变量 `GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT` 指向完整运行包根目录。开发启动按当前平台与架构查找上述目录；安装包仍从应用资源目录读取。已有工作站的语音资源无需搬动，可用这个变量明确指定。

以上说明依据现有脚本静态核对；下载模型不代表运行环境已经准备完成，目标平台实际发声仍需验证。

## 打包与许可

打包时先准备并核验目标平台的独立语言包，再按[Windows 中文朗读测试包顺序](../../apps/desktop/PACKAGING_CHECKLIST.md#windows中文朗读测试包顺序)装入和检查。Windows 运行环境不能直接用于 macOS；缺少对应资源不影响文字冒险。当前分发与验证状态见根目录 [REBUILD.md](../../../REBUILD.md)。

Kokoro 模型采用 Apache-2.0，运行依赖分别遵守各自许可。每个平台都需从实际语言包生成组件清单与完整许可证，保留在包内；见[第三方通知](../../apps/desktop/electron/THIRD_PARTY_NOTICES.md)。本地语音输入是另一条资源链路，见[识别运行层说明](../../apps/desktop/electron/speech-input/native/README.md)。

旧 sherpa Kokoro 资源已移除，不再从本目录准备或打包。
