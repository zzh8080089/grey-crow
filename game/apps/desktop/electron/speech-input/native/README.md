# 原生语音识别运行层

本模块只把本地 WAV 转为文字，不采集麦克风、不联网、不提交行动、不读取游戏配置或存档。由 Node 语音服务提供每任务私有临时目录，并负责超时、取消、终止子进程以及删除输入/输出文件。

## 构建与接口

开发机需要 Node.js、CMake 3.15+ 和 C++17 编译器；macOS 使用 Xcode Command Line Tools，Windows x64 使用 Visual Studio C++ 工具。玩家不需要 Python 或开发工具。

从 Electron 目录运行 `node scripts/prepare-speech-input-runtime.js`；可通过 `--cmake` 指定 CMake，`--work-dir` 指定开发缓存，`--source-archive` 提供已下载的固定源码包。脚本校验 sherpa 源码 SHA-256，递归依赖由上游 CMake 固定哈希；它只构建本机架构，不跨平台冒充验证。第一次需要联网下载免费源码和开发依赖，不调用云端识别服务。产物位于 `speech-input/.runtime/<platform>-<arch>/`，仅 `bin/`、`licenses/`、`sources/`、`runtime-manifest.json` 供日后平台分发；构建缓存不得进游戏包。

也可在 macOS/Linux 交叉准备 Windows 10/11 x64 组件：

```sh
node scripts/prepare-speech-input-windows.js --zig /absolute/path/to/zig-0.15.2/zig --notice-bundle /absolute/path/to/verified-native-runtime
node scripts/prepare-speech-input-model.js
```

交叉路线使用官方固定的 sherpa-onnx 1.13.8 Windows shared-MT-no-tts 资产；只编译本项目 C API 调用器，三个动态库与调用器放同一 `bin/` 目录，检查 PE 架构及导入依赖。Zig 从[官方下载页](https://ziglang.org/download/)取得并按其公布 SHA-256 校验。`--notice-bundle` 必须是前述源码构建脚本生成、哈希完整且依赖版本相同的运行层；脚本只复用许可证与对应源码，不复制其本机可执行文件。新增编译运行库的通知单独保留。调用器使用 Windows 10/11 系统自带 Universal CRT，不支持 Windows 7/8；仍须在目标 Windows 检查加载、中文路径和真实麦克风，不能把交叉构建称为实机通过。

模型准备脚本生成 `speech-input/.model/`，逐文件校验固定版本的大小及 SHA-256，附完整 FunASR 模型协议。打包后位于独立 `resources/speech-input-model/`；服务优先使用已验证的个人下载，再回退到随包资源。随包模型可直接离线识别，不必复制到玩家数据目录或再次下载；界面不提供删除安装目录的操作。识别组件缺失时拒绝无效下载，已有按需下载路径保留给未带资源的开发环境。模型权重、编译器、测试录音均不进入原生运行层目录。

调用 `bin/speech-input-cli --model ABS_ONNX --tokens ABS_TOKENS --input ABS_WAV --language zh|en|ja --output ABS_JSON`。Windows 文件名为 `speech-input-cli.exe`。所有文件参数必须是绝对路径；输出路径不能与输入、模型或 tokens 相同。`--version` 单独使用，输出协议版本信息。任务成功退出码为 0，JSON 仅写入指定输出文件：

```json
{"protocolVersion":1,"text":"识别文字","durationSeconds":3.5,"modelLoadSeconds":0.4,"inferenceSeconds":0.1,"segments":[{"startSeconds":0,"endSeconds":3.5,"text":"识别文字"}]}
```

输入只接受 PCM16、小端 RIFF WAV、单声道、16000 Hz、0.1–120 秒；其他格式及损坏文件在加载模型前拒绝。stderr 的自有错误消息仅为有限错误码，不打印录音或识别文字；模型配置关闭 debug。服务仍须限量捕获第三方库输出，禁止向玩家原样展示内部路径/诊断。输出在成功退出后才可采纳，异常或取消留下的任何输出均删除。

每次任务只加载一次模型，最多 25 秒一段串行识别，完成后进程退出。超过 25 秒时优先在当前段第 15–25 秒之间的低能量停顿中间切开，否则在 25 秒硬切。样本范围连续、无重叠、无缺口；英语片段间补空格，中日直接拼接。不会用文本去重删除玩家主动重复的话。接近数字静音的片段直接返回空文本；整段无声时不加载模型，避免静音幻听。此拦截不是人声分类器，噪声仍可能产生错误文字。音频连续覆盖不等于切词后的识别准确率已验收：无停顿长句、噪声、弱音和三语母语效果仍需真人录音对照。

完整来源与许可见 [licenses/ATTRIBUTION.md](licenses/ATTRIBUTION.md)。依赖及文件哈希以实际构建的 `runtime-manifest.json` 为准；本机运行日志与性能报告不纳入源码仓库。macOS 构建目标为 13.0，实际最小版本还要检查链接依赖；Windows 源码支持不等于 Windows 实机通过。
