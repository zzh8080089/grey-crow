# Grey Crow 桌面打包检查

仅用于已授权的打包与分发任务；产品目标见 [PRODUCT.md](../../../PRODUCT.md)，当前产物与未验收项见 [REBUILD.md](../../../REBUILD.md)。普通源码开发无需进入本流程。启动和检查见[游戏目录说明](../../README.md)，实际配置与命令以 [package.json](electron/package.json) 为准。

## 从代码核对打包输入

- 从待验证源码重新构建并记录版本；`electron/dist/` 中的旧产物不能代表当前源码。玩家安装包应可直接打开，不要求安装开发工具。
- `build.files` 封装桌面程序，`extraResources` 携带当前引擎、内容及依赖；排除测试、开发材料、凭据和试玩存档。打包态使用 `process.resourcesPath`，不依赖开发机路径。
- 文字核心包可以不带朗读模型。朗读包携带私有运行环境，不要求玩家安装 Python / PyTorch，不开端口；各语言按实际资源分别验证，中文结果不代表英日通过。材料见[语音资源说明](../../vendor/tts/README.md)。
- 本地语音输入按[原生运行层说明](electron/speech-input/native/README.md)准备目标平台组件；`build.mac/win.extraResources` 携带程序、完整许可、对应源码及 `runtime-manifest.json`，不带录音、测试样本或构建缓存。执行 `npm run prepare:speech-input:model` 准备固定模型，独立打入 `resources/speech-input-model/`，玩家可离线使用；打包检查同时核对引擎与完整模型，不能只附下载入口。
- 源码检查核对声明与已有组件；实际包还需核对平台、文件及哈希，不能把缺失的目标平台组件当作通过。最终产物重新核对第三方许可与组件清单，历史实验报告不能代替。

## 验证与分发层级

| 用途 | 必要证据与限制 |
| --- | --- |
| 本机目录包验证 | 未签名或临时签名目录包；验证资源、桥接、界面流程、权限说明及启动，不等于可外部分发 |
| Windows外部测试包 | 从当前源码生成整个 `win-unpacked/` 或ZIP，附未签名/SmartScreen提示；仍需Windows实机验证，不等于发布候选 |
| macOS外部分发 / 发布候选 | Developer ID签名、强化运行时、Apple公证，并在启用Gatekeeper的机器完成下载隔离后的启动验证；外部测试也不跳过这些要求 |
| Windows发布候选 | 签名安装器，验证安装/卸载、发布者信息、数据目录与设置流程；现有目录包命令不等于已具备安装器和签名产物 |

Windows开发验证优先在目标真机或虚拟机检查依赖、`npm run check`、`npm run smoke:dev-startup` 与开发启动；通过后再进入目标产物验证，NSIS安装器另行处理。macOS交叉构建不能替代Windows运行验收。

## 玩家安装包与安全边界

- 首屏为主菜单/新游戏，密钥仅在设置中填写、测试。连接测试提示会发起出站 HTTPS 请求并可能产生模型调用费用。
- 验证成功的密钥通过系统安全存储保存，重启后可恢复。打包前核对 Keychain / Credential Store 路线及目标机器行为；普通JSON、存档、日志、诊断、提示词与界面存储不保存密钥。
- 数据目录由 Electron `app.getPath("userData")` 提供；不写死开发机路径，不向玩家展示原始接口响应、请求头或调试轨迹。
- 默认不开放 Gateway，不绑定公网端口；若另行决定引入本地服务，仅绑定 `127.0.0.1`，由应用创建与关闭。界面保持内容安全策略 `connect-src 'none'`，联网由主进程的受限接口承担。
- 分发整个 `.app`、Windows目录或ZIP，不单独复制EXE；产物不得混入旧OpenClaw启动入口、真实凭据或玩家数据。

## 图标与平台检查

图标母版、派生尺寸与来源见[图标说明](electron/build/README.md)。当前母版为 `electron/build/source-masters/grey-crow-ai-app-icon-master.png`，Electron消费 `electron/build/` 中的 `icon.png`、`icon.ico`、`icon.icns`。应用图标与界面Logo分开；Windows图标保留256像素及常用小尺寸，macOS图标可由 `iconutil` 解析。改图后检查源码清单，任务栏/Dock验收使用新构建产物；实验商店页面不是打包输入。

**macOS：** 签名前完成权限、时间戳、应用标识、图标和属性清单配置。保留麦克风用途说明，并验证签名产物的系统许可与实际录音；摄像头和屏幕采集继续不开放。`pack:dir:mac` 在属性清单处理后执行临时重签名与 `codesign --verify --deep --strict`，只证明本机测试包完整性；正式签名、公证及下载后Gatekeeper检查另验。未签名或未公证可能出现系统拦截提示。

**Windows：** 未签名可能触发SmartScreen或杀软提示；目标机器检查系统凭据存储、重启、资源路径、动态依赖、实际朗读与进程释放。签名、发布者和安装器信息及安装/卸载体验属于发布候选验收。

## Windows中文朗读测试包顺序

从 `electron/` 目录执行，模型资源必须是已验证的目标平台版本：

1. 运行适用的源码检查和 `npm run check`；默认检查未涵盖的改动场景另做定向验证。
2. 确认 `speech-input/.runtime/win32-x64/` 与 `.model/` 已准备并校验，执行 `npm run pack:dir:win` 重建主体；不能向过期应用包只贴入新语音目录。
3. 从已核验的Windows x64资源挂入 `resources/tts/kokoro-original-zh`，不复制macOS Python或临时下载未记录组件。
4. `npm run check:packaged:win:tts` 核对应用归档、引擎/内容新鲜度、四音色、私有运行环境、组件清单与许可证。不含朗读的核心包使用 `npm run check:packaged:win`；本地语音输入组件与离线识别模型仍必须完整，交叉构建另外检查 PE 导入和完整通知。
5. 在完整目录加入测试说明与未签名提示，再压ZIP并检查条目完整性、记录SHA-256校验值。
6. 在Windows x64实机验证启动、凭据、四音色、暂停/继续、进程释放与内存；记录源码、产物、自动检查和人工体验各自结论。

任何封装路线变更先审查其资源、安全和分发边界，再按目标平台验证。源码检查、交叉构建或旧包存在都不能代替最终产物与人工验收。
