# 本地语音输入组件与模型来源

本目录是语音输入模块的分发许可入口，不能用运行库许可证替代模型权重协议。

- **SenseVoice Small**：Alibaba Group / Tongyi Speech Lab（阿里巴巴通义实验室）。[模型项目](https://github.com/QwenAudio/SenseVoice)、[原始权重](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)。项目源码为 MIT，模型权重适用随附 `FunASR-MODEL_LICENSE-58830eca.txt`（FunASR Model Open Source License Agreement v1.1）。遵循协议可商用；保留模型名称、出处、作者与完整协议。模型名称不得改成 Grey Crow 自有模型。
- **INT8 ONNX 转换**：sherpa-onnx / csukuangfj，使用[固定转换仓库提交](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07)。转换不改变原模型的权重协议。模型文件由独立模型资源管理器校验，可随包离线提供或按需下载，不与原生运行层源码混放；随包目录另附完整模型协议。
- **sherpa-onnx 1.13.8**：k2-fsa 项目及其贡献者，Apache-2.0。本机源码构建仅编译识别运行层，禁用 TTS、espeak-ng、Piper、说话人分离、Python、网络服务和音频设备示例；Windows shared-no-tts 路线见下文，仅向游戏提供离线识别接口。
- **ONNX Runtime 1.28.2**：Microsoft 与贡献者，MIT 及随附完整第三方 notices。本机源码构建使用 sherpa-onnx 项目指定且校验 SHA-256 的 [csukuangfj/onnxruntime-libs](https://github.com/csukuangfj/onnxruntime-libs/releases/tag/v1.28.2) 静态 CPU 库；Windows 交叉路线使用同版官方 sherpa 资产中的动态库，不是 Python wheel。

开发准备脚本从固定源码构建，并把实际依赖的完整 LICENSE / COPYING / NOTICE 文件复制到运行层 `licenses/`。依赖包括 kaldi-native-fbank 1.22.3、kissfft、kaldi-decoder 0.3.0、kaldifst 1.8.0、OpenFst 1.8.5-2026-07-09、Eigen 5.0.1、simple-sentencepiece 0.7、nlohmann/json 3.12.0。版本与下载哈希由 sherpa-onnx 及其递归 CMake 清单锁定，具体产物清单记录在 `runtime-manifest.json`。

Windows 交叉准备另有固定路线：Zig 0.15.2 只编译本项目的 C API 调用器，链接官方 `sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts` 资产（SHA-256 `4b0a94f7b5c606b1b64a19a831c2127559e4b3d34e195465ebc7be73d9ed4783`）的 C API / ONNX Runtime 动态库。仅分发调用器、`sherpa-onnx-c-api.dll`、`onnxruntime.dll` 与 `onnxruntime_providers_shared.dll`；不分发上游示例、C++ API、TTS 或编译工具。相同固定依赖的 notices/Eigen 源码由已校验的本机源码构建产物复用，再添加 Zig（MIT）、MinGW-w64 完整 COPYING，以及 LLVM libc++ / libc++abi / libunwind 的 Apache-2.0 WITH LLVM-exception 等完整通知。实际复制文件、编译参数、依赖导入与校验值见 Windows manifest，不能拿 Mac 可执行文件代替 Windows 文件。

该 Windows 调用器使用系统 Universal CRT，最低支持 Windows 10 x64，不支持 Windows 7/8；上游 MT 标签不表示调用器也完全静态链接 CRT。Windows ONNX Runtime 内置提交号为 `33ca962`，映射至下述同一完整源码提交及 Eigen 材料。二进制格式和导入检查不代表 Windows 真机识别或许可证法律审查。

实际编译依赖头还包括 simple-sentencepiece 内的 Darts-clone（Susumu Yata，BSD-2-Clause）、ThreadPool（Jakob Progsch / Václav Zeman，zlib），以及 kaldifst 内源自 libc++ 的 `basic-filebuf.h`（MIT / University of Illinois 双许可）。各文件内嵌的完整许可、出处和源码哈希已单独保留为 `darts-clone-BSD-2-Clause.txt`、`ThreadPool-Zlib.txt`、`libcxx-basic-filebuf-notices.txt`，最后一项保留完整贡献者名单；不得仅用这些外层库的 Apache 根许可证替代。

Eigen 采用 MPL-2.0 与兼容的第三方条款。外层构建的原始源码及完整通知在运行层 `sources/eigen-5.0.1.tar.gz` 和 `licenses/eigen/` 一并提供。静态 ONNX Runtime 内部另用 `1d8b82b0740839c0de7f1242a3585e3390ff5f33` 及两份 Microsoft 补丁；对应原始ZIP、完整补丁、四个修改后源码文件和恢复方法在 `sources/eigen-onnxruntime-1d8b82b0740839c0de7f1242a3585e3390ff5f33/`，完整通知在 `licenses/eigen-onnxruntime/`。来源依据为固定归档校验值、二进制内置的 ORT 提交号及该提交的固定依赖/补丁规则，不声称已经独立重建 ONNX Runtime 做逐字节重现。Grey Crow 未额外修改 Eigen，不以游戏自身条款限制这些源码的权利；其他游戏代码不因此统一改为 MPL。其余已查看直接依赖主要为 Apache-2.0、BSD-3-Clause、MIT；最终分发仍保留各组件的实际完整通知。

截至 2026-09-15，[SenseVoice 官方许可说明](https://github.com/QwenAudio/SenseVoice#license) 明确允许遵约商用及私有微调权重；专用协议中的归因、行为、终止及自动修订条款仍有效，不能宣传为无条件 MIT 权重。协议的固定快照用于回查，不取消协议自身的修订条款。

本模块不随游戏分发上游测试录音。许可证准备、原生构建及本机测试不等于完成游戏发布、签名或 Windows 实机验收。
