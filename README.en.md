# Grey Crow

[简体中文](README.md) | English | [日本語](README.ja.md)

Act in natural language, and let the story remember your choices.

Grey Crow is a local-first desktop text adventure. You play the protagonist: talk with characters, explore the environment, make promises, and then face the consequences of those choices. The default scenario begins around the tenth day after the outbreak in Shanghai.

The game progresses through interaction between the player and AI. It does not use health points, attack power, or hidden scores to decide actions. Characters’ physical condition, established facts, and relationships constrain the narrative. Model generation remains uncertain, so story consistency and long-term memory still need ongoing validation through actual play.

> The project is in player testing. Implemented features, passing automated checks, and formal release acceptance are different states; a stable release or compatibility across all platforms is not currently promised.

## What you can do

- **Express actions freely**: Describe what you want to say or do directly, without memorizing commands.
- **See the changes left by the story**: The journal sidebar provides character, reference, status, and chapter recaps; important experiences contribute to later context and memory retrieval.
- **Save and continue**: Each adventure is saved separately, with restoration, chapter recaps, and story export.
- **Speak and listen to the story**: Optional local Chinese, English, and Japanese speech input is available; Chinese read-aloud offers four voice sets. Players review the recognized text before sending it.
- **Learn the interface step by step**: The game includes an introductory tutorial, DeepSeek registration help, in-game step-by-step overlay guidance, and options in Settings to replay or reset the guidance.

The interface supports Simplified Chinese, English, and Japanese, as well as light and dark journal themes. Language and visual presentation still need feedback from players and native speakers.

## Models and resources

**The source repository does not include story-generation or local speech-model weights, API keys, or free API credits.** The model selector and custom connection settings configure access to model services; they do not include the models themselves.

- **Story generation**: Use your own configured model service and API key. Connection tests and gameplay may incur provider charges.
- **Speech input and read-aloud**: The source includes integration code and resource preparation instructions. Developers need to obtain model weights and platform-specific runtime components separately. The complete Windows test package supplied separately by the maintainer includes local speech resources; a source download is not that test package.

### Download model resources

These links point to the fixed revisions used by the current code. There is no need to download the entire model repository:

| Purpose | Direct downloads | Source |
| --- | --- | --- |
| Speech recognition: SenseVoice Small INT8, about 240 MB | [model.int8.onnx](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx) · [tokens.txt](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt) · [LICENSE](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE) | [Conversion by the sherpa-onnx maintainer](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07) |
| Chinese read-aloud: Kokoro-82M-v1.1-zh | [kokoro-v1_1-zh.pth](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/kokoro-v1_1-zh.pth) · [config.json](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/config.json) | [Pinned official Kokoro revision](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/tree/01e7505bd6a7a2ac4975463114c3a7650a9f7218) |
| Four Kokoro voices | [zf_001.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zf_001.pt) · [zf_006.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zf_006.pt) · [zm_009.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zm_009.pt) · [zm_010.pt](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/01e7505bd6a7a2ac4975463114c3a7650a9f7218/voices/zm_010.pt) | Same revision; obtain these alongside the main weights |

**Quick setup for speech recognition**: In `game/apps/desktop/electron`, run `npm run prepare:speech-input:model`. It downloads and verifies the files, writes them to `speech-input/.model/`, and includes the complete model license. If you downloaded the three recognition files manually, keep their original names in one cache directory and run `node scripts/prepare-speech-input-model.js --work-dir <cache-directory>`; quote paths containing spaces. Prepare the native recognition program separately using the [runtime instructions](game/apps/desktop/electron/speech-input/native/README.md).

**Kokoro also needs a platform-specific runtime**: The weights and voice files alone are not a complete language pack that the game can import. See the [read-aloud resource instructions](game/vendor/tts/README.md) for the directory layout, download script, and platform preparation entry points. The complete Windows test package already includes these resources, so players do not need to download them again. These links use Hugging Face. If it is inaccessible on your network, use the complete test package supplied by the maintainer; availability in every region is not guaranteed.

## Start testing

The test package is provided separately by the maintainer. After obtaining the complete Windows test ZIP, extract it in full, then run `Grey Crow.exe` inside it; do not copy only the program file. The complete audio package includes the resources required for local recognition and Chinese read-aloud, so Python installation and model downloads are unnecessary. An unsigned test package may show an unknown-publisher warning.

On first launch, follow the tutorial to enter your own model API key (the credential used to call a model service) in Settings, click “Test & Use,” then create an adventure. If you already have a save, you can choose to continue it.

**Local-first does not mean fully offline.** Saves and settings remain on your computer; story generation sends the necessary story context to the model service you select, and connection tests and gameplay may incur provider charges. Speech recognition and local read-aloud run on your machine. The project supplies no shared keys, and its source repository does not include cloud story-model weights.

Replacing the program directory does not automatically delete saves and settings in your system user directory. If you run into a problem, choose “Export problem report” in Settings and include your system version, steps, displayed message, or screenshots; do not submit API keys, private saves, or recordings.

## Run from source

The local validation environment uses Node.js `22.22.1` and npm. Install dependencies, run tests, and start the desktop application from the Electron directory. Electron is the desktop application framework used by this project.

```sh
git clone https://github.com/zzh8080089/grey-crow.git
cd grey-crow/game/apps/desktop/electron
npm ci
npm start
```

`npm ci` installs the locked dependencies and downloads Electron. After launch, configure a model connection in the game settings. Successful installation, source checks, or connection probes do not mean that the narrative experience of any model has been accepted.

**A source clone does not include local speech-model weights or platform-native components.** The text adventure can run independently first. Before enabling speech, prepare the recognition program and models for the relevant platform according to the [speech input runtime instructions](game/apps/desktop/electron/speech-input/native/README.md), and prepare language packs according to the [read-aloud resource instructions](game/vendor/tts/README.md). Recognition and read-aloud are two separate resource chains.

The source repository contains the production game code, content and assets, build scripts, regression tests, and necessary documentation and licenses. All labs, prototypes, historical experiment reports, temporary outputs, and personal development settings stay in the maintainer's local workspace. Production speech-resource preparation tools live in `game/vendor/tts/`.

Early production artwork is documented through embedded generator claims, historical production records, or the maintainer's report of GPT Image 2 generation; see the [per-file provenance inventory](game/apps/desktop/electron/renderer/assets/provenance.json). Maintainer reports are not independent verification, and the program-code license grants no additional artwork reuse rights.

For preparation, license retention, and verification order for the complete model package, see the [packaging checklist](game/apps/desktop/PACKAGING_CHECKLIST.md). A normal main build does not automatically create the Kokoro read-aloud runtime environment; a successful Windows cross-build also cannot replace validation on a physical Windows machine.

## Architecture and source entry points

| Part | Responsibility | Entry point |
| --- | --- | --- |
| Desktop and interface | Journal, input, settings, speech, and restricted host communication | [desktop](game/apps/desktop/README.md) |
| Agent and Harness | One primary agent; Harness is the framework that organizes context, model calls, tool execution, and correction | [session](game/engine/session/) |
| Runtime and memory | The runtime handles action submission, cancellation, and recovery; each adventure has its own SQLite database and memory retrieval | [engine](game/engine/README.md) |
| Content and projection | World, facilitator, and capability content are compiled into adventure snapshots; canonical state is turned into player-readable interface and chapters | [content](game/content/README.md) |

The model proposes narrative and tool requests, the program validates and commits canonical results, and the interface shows the corresponding version of the data. Source code is authoritative for implementation details; this README is only a public entry point and does not define separate product goals or development status.

## Development checks

Run the checks that match your changes in `game/apps/desktop/electron`:

```sh
npm run check:session              # automated tests for sessions, bridge, and saves
npm run check:renderer-boundaries  # automated tests for interface boundaries
npm run check:player-guide         # tutorial records and script checks
npm run smoke:ui:game-tour         # interface-guidance check in the real desktop app
npm run check                     # full default check; opens a desktop window
```

The desktop checks above use isolated temporary data and synthetic model responses, and do not require a real story-model key. Run only one group of desktop interface checks at a time to prevent window-focus interference. Speech, memory, narrative quality, and actual behavior on target platforms each require separate verification. See the [test guide](game/README.md) for more entry points.

## Directions under discussion

- **Continue an adventure in WeChat**: The next phase will focus on an optional, independent messaging entry point that lets players continue the same game from their computer through WeChat. Binding, permissions, message ordering, segmentation, and error responses still need design.
- **AI-assisted world and scenario creation**: The project is considering gradually opening world settings, world-book, and scenario editing, and connecting authoring tools through MCP (Model Context Protocol, a protocol that lets external AI call application capabilities) or similar interfaces. The exact scope, interfaces, and authorization model have not been decided.

Both are directions for later discussion. There is currently no formal WeChat integration or public MCP authoring service. Existing content-management code does not mean a general-purpose world editor has been publicly opened.

## Contributions and feedback

For memory-system contributions, start with `turn-memory.js`, `session-memory-source.js`, and adjacent tests in `game/engine/session/`. Check retrieval and use after a restart as well as successful writes. Describe the player benefit and scope in an issue, then submit a focused change with relevant tests.

When filing an issue, describe the actual behavior, expected behavior, reproduction steps, and system version. For player experience, distinguish program defects, model-generation deviations, and personal preference. For changes, prioritize a clearly bounded, verifiable contribution.

Read [AGENTS.md](AGENTS.md) before contributing. See [PRODUCT.md](PRODUCT.md) for stable product goals, and [REBUILD.md](REBUILD.md) for current work, representative evidence, and boundaries that remain to be verified. New files should support running, building, verifying, or documenting the production game; experimental materials do not belong in this source repository.

Product direction and maintenance: [zzh8080089](https://github.com/zzh8080089). AI development assistance: **OpenAI Codex**. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for credits and the reconstruction milestone.

## License

The project's original program source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Use, study, modification, and distribution are permitted for the noncommercial purposes specified in its terms; **this license does not grant permission for commercial use**. The project is currently source-available for noncommercial use, rather than open source under the [Open Source Initiative's definition](https://opensource.org/osd). The English LICENSE text provides the complete terms; this explanation is only a summary.

This license applies only to the project's original program source code. It does not cover game worlds, scenarios, documentation, artwork, audio, fonts, model weights, or brand assets. Reuse of those materials is governed by their individual notices; the source-code license grants no reuse rights in materials without a separate notice. Third-party code and separately licensed files retain their own terms. This project's noncommercial restriction does not override rights granted by those licenses.

- [Third-party component and resource notices](game/apps/desktop/electron/THIRD_PARTY_NOTICES.md)
- [Local recognition dependencies, model sources, and full agreements](game/apps/desktop/electron/speech-input/native/licenses/ATTRIBUTION.md)
- [Font sources and bundled licenses](game/apps/desktop/electron/renderer/assets/fonts/manifest.json)
- Feather photography and derivative visuals use CC BY-SA 4.0. See the attribution, source, modification, and license information for the [journal stills](game/apps/desktop/electron/renderer/assets/theme-study/ATTRIBUTION.md), [opening-book video](game/apps/desktop/electron/renderer/assets/page-reveal/LEAF_ATTRIBUTION.md), and [writing animation](game/apps/desktop/electron/renderer/assets/quill-writing/ATTRIBUTION.md).

SenseVoice model weights and source code use different licenses. Kokoro models, voices, and runtime dependencies also require their notices to be retained separately.
