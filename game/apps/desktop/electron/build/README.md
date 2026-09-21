# Grey Crow 桌面应用图标

本目录只保存 Electron 打包直接消费的平台图标及其已确认源母版，不是测试美术仓。

## 单一来源

当前应用图标母版：

`source-masters/grey-crow-ai-app-icon-master.png`

识别特征为向左的黑灰色灰鸦、蓝色眼睛、无文字。测试型 Steam 商店页面已经移出正式项目；
本目录的源母版是构建图标的唯一项目内来源，平台图标由它生成。

## Electron 构建文件

- `icon.png`：1024 x 1024 通用源图。
- `icon.ico`：Windows 图标，包含 16、20、24、32、40、48、64、128、256 px 九档尺寸。
- `icon.icns`：macOS 标准 iconset 尺寸组。
- `source-masters/grey-crow-ai-app-icon-master.png`：1254 x 1254 已确认源母版，不直接进入玩家 UI。

`../package.json` 将 Windows 指向 `build/icon.ico`，将 macOS 指向 `build/icon.icns`；
`icon.png` 同时作为打包源边界检查的一部分保留。

## 边界

- 应用图标只影响操作系统窗口、任务栏、快捷方式和安装/分发表面。
- 主菜单使用 `../renderer/assets/branding/grey-crow-ai-logo-{zh-CN,en-US,ja-JP}.png` 三语 Logo，与本目录分离；旧无语言后缀 Logo 已退役，仅在本地保留。
- 主菜单背景和 Steam 商店胶囊图也不从本目录读取。
- 不在派生图标上单独手工改字、调色或覆盖母版；需要视觉修改时先更新并确认美术母版，再重新生成三种格式。

## 验证

更新图标后至少运行：

```bash
cd game/apps/desktop/electron
npm run check:packaging-source
```

图标只有在重新执行对应平台打包后才会进入新产物。已有 ZIP、`dist/` 或安装包不会因为源文件变化而
自动更新，不能用旧包判断本目录是否已替换成功。
