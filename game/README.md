# Grey Crow 游戏目录

产品目标见 [PRODUCT.md](../PRODUCT.md)，当前工作与验证边界见 [REBUILD.md](../REBUILD.md)。本页只做源码与命令导航。

## 按代码找入口

- [桌面](apps/desktop/README.md)：窗口、设置、界面、语音输入与打包。
- [引擎](engine/README.md)：会话、存储、记忆、内容编译与模型适配。
- [游戏内容](content/)：运行时使用的世界、主持与内容包；[正式界面资源](apps/desktop/electron/renderer/assets/)仍随当前源码保留；候选美术与独立美术实验室在本地管理，不纳入源码仓库。
- [朗读资源](vendor/tts/README.md)：可选语音包及许可证。

## 启动桌面程序

需要 Node.js、npm 和已准备好的桌面依赖；会话检查还需要 Node.js 支持内置 `node:sqlite`。在本目录运行：

```bash
./start.sh
```

也可在仓库根目录运行 `./start.sh`。macOS 双击本目录的 `Grey Crow.command`；Windows 双击 `Grey Crow.bat`。这是正常游戏入口，会使用玩家配置；真实模型调用按具体授权执行。

## 按改动选择检查

以下检查不调用真实故事模型，按受影响范围选择，无需每次全部重跑。

```bash
./start.sh bridge     # 仅桌面会话桥测试
./start.sh check      # 会话测试、桌面静态检查、源码打包边界
./start.sh ui-smoke   # 默认真实 Electron 流程，使用合成模型与临时存档
```

完整默认检查定义在 [package.json](apps/desktop/electron/package.json)，从桌面目录运行：

```bash
cd apps/desktop/electron
npm run check  # 含自动 precheck、静态/自动测试及隔离 Electron 流程，会打开窗口
```

| 定向命令（同一目录） | 检查范围 |
| --- | --- |
| `npm run check:session` | 会话、桌面桥与存档槽自动测试 |
| `npm run check:content-regression` | 内容编译与锁定快照回归 |
| `npm run check:renderer-boundaries`、`npm run check:speech-input` | 界面边界、语音输入隔离测试；不代表真实渲染或识别验收 |
| `npm run smoke:sqlite-node`、`npm run smoke:sqlite-electron` | 两种运行环境中的临时 SQLite 存储；后者不开窗口 |
| `npm run smoke:ui:layout`、`npm run smoke:ui:display` | 日记本布局与显示模式的真实桌面检查 |
| `npm run smoke:ui:feedback` | 隔离故事中打开亮暗侧栏，检查内部模块图标、侧签背景与原生键盘焦点 |
| `npm run smoke:ui:player-report` | 无连接/无冒险时导出问题报告，检查成功/取消/失败、重启保留、智能篇幅及三语双尺寸设置；保存路径选择与连接拒绝使用合成适配器 |
| `npm run smoke:ui:observability` | 合成模型故障、跨进程恢复与重试，实际下载诊断文件并检查脱敏；不覆盖语音或通用界面故障 |

默认检查不覆盖全部专用场景。等待/恢复、整理、章节阅读等按需查看[桌面检查脚本](apps/desktop/electron/scripts/check-session-desktop.js)的 `--suite` 分支；真实本地识别与朗读见[桌面说明](apps/desktop/README.md)。

独立审核修复的桌面回归：`--suite=delete-recovery` 验证部分删档失败、重启发现与确认清理；`--suite=notebook-legacy-layout` 包含缺音色旧配置仅改主题后保存及重启；`--suite=notebook-layout` 验证历史阅读锚点与固定错误入口；`--suite=action-errors` 验证正式行动链的失败、重试与取消。均使用隔离临时数据和合成接口，不代表真实模型或 Windows 验收。

桌面联验会打开真实窗口，同一时间只运行一组，避免焦点相互干扰；测试使用临时配置和合成存档，不读取正式玩家存档。跨平台原生组件和麦克风权限仍需对应实机，源码与 Mac 上通过不能代替 Windows 验收。

自动测试、真实桌面、真实模型、人工体验与发布验收分别记录，历史结果见根工作记录。

## 平台分发

源码启动不代表已有对应安装包。macOS 分发完整 `.app`；Windows 分发整个 `win-unpacked/` 或由它生成的 ZIP，不能只复制 EXE。打包、签名与发布按具体授权执行，产物与目标平台须独立验证，见[打包清单](apps/desktop/PACKAGING_CHECKLIST.md)。
