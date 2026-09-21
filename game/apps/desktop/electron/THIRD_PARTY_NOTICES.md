# Grey Crow Desktop Third-Party Notices

This file records third-party components prepared for the Grey Crow desktop build. It is an engineering inventory, not legal advice. Review the shipped artifact and the upstream licenses again before commercial release.

## Grey Crow application license scope

Grey Crow's original program code is provided under PolyForm Noncommercial License 1.0.0. The complete, unmodified terms are included at `licenses/Grey-Crow-LICENSE.txt` beside this file in packaged resources. Commercial use is not granted by that license. The license covers only the project's original program code; it does not grant reuse rights in game worlds, scenarios, documentation, artwork, audio, fonts, model weights, or brand assets. Those materials retain their separately stated terms, if any. Third-party code and assets remain governed by their own licenses; Grey Crow's noncommercial restriction does not override the rights those licenses grant.

## Early project artwork provenance

The [artwork inventory](renderer/assets/provenance.json) records the SHA-256 and evidence status of 25 retained early project images and the application-icon source master. These are existing resources needed by the game or its build; this inventory does not grant a new license.

- Three early images (the main-menu background, v1 notebook paper, and square narration paper) and the icon source master contain embedded C2PA (Content Credentials, a format for recording media provenance) claims naming OpenAI `gpt-image` 2.0. Independent signature verification was not performed. The claims do not establish the rights in any reference inputs.
- The character-records icon has a historical project production record naming Codex built-in `image_gen`; its recorded final-file SHA-256 matches the retained image. That record used four existing notebook icons as style references and stated that no external stock images were used. The reference icons now carry the maintainer-reported origin described below; their original generation and reference-input records were not supplied. The original character-icon generation output and historical document are not included in this clean source history. This is a documented production statement, not independent rights verification.
- For the other 21 early images (three localized logos, 15 other v1 notebook images, and three older UI images), maintainer zzh8080089 reported on 2026-09-22, after being shown a numbered preview, that they were made using GPT Image 2. The inventory records this as `maintainer-reported-generation`. This is the maintainer's recollection; original generation logs and reference-input records were not supplied, and generation and separate reuse rights were not independently verified.
- The application-icon derivation is documented in `build/README.md`; the source-to-output transformation was not independently reproduced during this source review.

Do not infer additional artwork permissions from the program-code license. The separate notices for photography, its derivatives, fonts, and model resources continue to apply unchanged.

## yauzl 3.4.0

- Source: <https://github.com/thejoshwolfe/yauzl>
- License: MIT
- Purpose: bounded, lazy ZIP reading for local Extension Pack imports.
- Transitive runtime dependency: `pend 1.2.0`, MIT.

## Kokoro-82M-v1.1-zh

- Source: <https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh>
- License: Apache License 2.0
- Any distributed original Kokoro language pack must retain its model license and the license inventory generated from the actual staged runtime.

## Optional local speech input — SenseVoice Small INT8

- Model authors: Tongyi Speech Lab, Alibaba Group. [SenseVoice project](https://github.com/QwenAudio/SenseVoice), [original SenseVoice Small weights](https://huggingface.co/FunAudioLLM/SenseVoiceSmall).
- The SenseVoice **source code is MIT**, but its **model weights use the custom FunASR Model Open Source License Agreement v1.1**, not MIT or Apache-2.0. Commercial use is permitted subject to that agreement; retain the original model name, author and source attribution, and all applicable terms. The agreement's restrictions, termination and revision provisions still apply.
- The INT8 ONNX conversion is provided by sherpa-onnx / Fangjun Kuang (csukuangfj), pinned to [conversion repository commit `2365baeacb507f821a0c8120fcee3d484dba7a07`](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07). Conversion does not replace the original model license. The model's 71-byte `LICENSE` is only a pointer; the complete agreement ships in `speech-input/licenses/FunASR-MODEL_LICENSE-58830eca.txt`, with attribution in `speech-input/licenses/ATTRIBUTION.md`. Offline weights are distributed separately in `speech-input-model/`, including the complete agreement and `SOURCE.json` with author, source, revision and checksums.
- The optional speech-input feature shares the same offline model for Chinese, English and Japanese recognition. A download path remains for development installations without bundled weights. Grey Crow does not redistribute the upstream test recordings with the game.

The native inference runtime uses **sherpa-onnx 1.13.8 (Apache-2.0)** and pinned **ONNX Runtime 1.28.2 CPU libraries (MIT and bundled third-party notices)**. It does not use the experimental Python wheel. The native host-source build links statically and disables TTS, Piper/espeak-ng, Python bindings, PortAudio examples, WebSocket services and speaker diarization. The Windows shared-library route is described below; neither route exposes TTS or device capture through the Grey Crow recognition CLI. This statement does not describe the separate Kokoro playback runtime.

The actual native build also uses kaldi-native-fbank 1.22.3, kaldi-decoder 0.3.0, kaldifst 1.8.0, OpenFst 1.8.5-2026-07-09 and simple-sentencepiece 0.7 (Apache-2.0); KissFFT commit `febd4caeed32e33ad8b2e0bb5ea77542c40f18ec` (BSD-3-Clause); nlohmann/json 3.12.0 (MIT with its upstream third-party attribution); and Eigen (MPL-2.0 and its bundled notices). The full runtime notices, archive origins and checksums must remain with `speech-input/licenses/` and `speech-input/runtime-manifest.json`.

Header code included by those libraries has separate retained notices: Darts-clone by Susumu Yata (BSD-2-Clause), ThreadPool by Jakob Progsch and Václav Zeman (zlib), and the libc++-derived `basic-filebuf.h` used by kaldifst (MIT / University of Illinois dual license; either option is available). Their complete notices and upstream source hashes are included as `darts-clone-BSD-2-Clause.txt`, `ThreadPool-Zlib.txt` and `libcxx-basic-filebuf-notices.txt` under `speech-input/licenses/`; the complete libc++ contributor credits are preserved.

Two Eigen source versions are provided because the outer sherpa build and the precompiled ONNX Runtime use different revisions:

- `speech-input/sources/eigen-5.0.1.tar.gz` is the immutable upstream source archive used by the outer build. Its required notices are under `speech-input/licenses/eigen/`.
- `speech-input/sources/eigen-onnxruntime-1d8b82b0740839c0de7f1242a3585e3390ff5f33/` provides the original Eigen ZIP, the two Microsoft patches, the four resulting modified source files, and restoration instructions. The matching notices are under `speech-input/licenses/eigen-onnxruntime/`. The native archive's embedded ONNX Runtime commit is `33ca9628233dc8f002435e868d4c2e9f82766ca1`; its fixed source dependency and patch recipes are included for traceability. This source mapping was checked against the downloaded archive digest and embedded build metadata, not by independently reproducing ONNX Runtime byte-for-byte.

Recipients may obtain and modify these MPL-covered sources from the included archives and files under their original terms. Grey Crow adds no further Eigen modifications and does not restrict recipients' rights in those sources. Full upstream source archives include tests/examples and their original license files; their presence does not mean those optional components are linked into the game. In particular, nlohmann/json's GPL-licensed `imapdl` test helper is not compiled or included as a runtime dependency.

The Windows cross-build uses the pinned official `sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts` release: its C API and ONNX Runtime DLLs are co-located with the Grey Crow CLI. The CLI is compiled using Zig 0.15.2 for `x86_64-windows-gnu`; complete Zig, MinGW-w64, LLVM libc++ / libc++abi / libunwind notices are retained in `speech-input/licenses/`. The compiler and upstream sample applications are not shipped. Windows 10/11 system Universal CRT is required. Exact file hashes, import dependencies, source attribution and compilation parameters are recorded in the platform manifest.

Platform resource declarations include `bin/`, `lib/` when present, `licenses/`, `sources/` and `runtime-manifest.json`; the verified model has its own `speech-input-model/` directory. macOS arm64 has native execution evidence; Windows x64 has cross-build and dependency evidence only. Windows/Intel Mac execution, signing and commercial release are separate acceptance steps. Recheck the actual platform archive, corresponding sources, notices and package contents before distribution; a source-only packaging check is not artifact acceptance.

## Bundled UI fonts

The Renderer includes the following unmodified variable TTF files from the Google Fonts repository at commit
`7ff85c87f93ea6cca5f41c69f2e4edcb90240f26`:

- Inter — English UI;
- Noto Sans SC — Simplified Chinese UI;
- Noto Sans JP — Japanese UI;
- Noto Serif — English narrative text;
- Noto Serif SC — Simplified Chinese narrative text;
- Noto Serif JP — Japanese narrative text.

Source: <https://github.com/google/fonts>

License: SIL Open Font License 1.1. The upstream copyright notices and complete license texts ship beside each
font under `renderer/assets/fonts/*/OFL.txt`. File origins, sizes and SHA-256 digests are pinned in
`renderer/assets/fonts/manifest.json`.

Windows and macOS proprietary fonts named in CSS are fallback references only. Their font files are not included
in the Grey Crow source or Renderer assets.

## Release gate

The original Kokoro runtime is staged separately into `resources/tts/kokoro-original-zh/` for the full Windows test package; it is not copied automatically by the ordinary Electron build. See [the packaging checklist](../PACKAGING_CHECKLIST.md#windows中文朗读测试包顺序). Regenerate the SBOM and license bundle from each platform's actual staged language pack, include the required notices in the artifact, and review the result again before distribution. Source checkout alone does not supply the model or platform runtime.
