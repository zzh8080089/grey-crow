# ONNX Runtime 内部 Eigen 的对应源码

此目录与旁边的 `upstream.zip` 一起提供 ONNX Runtime 静态库使用的 Eigen 源码及修改，不是新的可执行依赖。

1. 解压 `upstream.zip`，得到 `eigen-1d8b82b0740839c0de7f1242a3585e3390ff5f33/`。
2. 将 `patched-files/` 中的四个文件按相对路径覆盖解压目录中的同名文件，即可取得对应修改后的源码。未列出的文件保持上游原样。
3. 也可以在原始解压目录依次运行 `patch --binary --ignore-whitespace -p1 -i ../patches/s390x-build.patch` 与 `patch --binary --ignore-whitespace -p1 -i ../patches/s390x-build-werror.patch`；路径按放置位置调整。补丁顺序由随附 `onnxruntime-eigen.cmake` 指定。两种恢复方式已逐文件对照。

源码采用 MPL-2.0 及原始归档内的相应第三方条款；原作者标记及完整许可均保留于原始归档与运行层 `licenses/eigen-onnxruntime/`。四个覆盖文件来自 Microsoft ONNX Runtime 上游补丁，Grey Crow 未额外修改 Eigen 源码，也不以游戏的许可条款限制此处源码的权利。原始源码归档包含未编入运行程序的上游测试、示例及其各自许可证，它们不代表游戏可执行文件新增了这些运行依赖。

来源核对：所用 macOS arm64 静态库归档的 SHA-256 与 GitHub release asset 的 digest 一致；实际二进制中 `ORT Build Info` 报告提交 `33ca96282`，对应 Microsoft 完整提交 `33ca9628233dc8f002435e868d4c2e9f82766ca1`。该提交的依赖清单指定 Eigen `1d8b82b...` 及 SHA-1 `05b19b49...`，构建规则指定上述两份补丁。下载源码同时核验这个上游 SHA-1 和本地锁定的 SHA-256；完整值与固定来源见 `SOURCE.json`。

这些证据是“固定归档及内置版本信息对应上游源码”的核对，尚未独立重建 ONNX Runtime 做逐字节重现。后续平台构建必须核对其二进制的实际 ORT 提交，不能只凭文件名沿用本说明；准备脚本对不匹配的提交拒绝生成运行层清单。
