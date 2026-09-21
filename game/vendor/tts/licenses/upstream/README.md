# Pinned Upstream License Materials

These files are copied into the generated Kokoro zh-CN staging only when the
installed wheel does not carry a complete license file of its own.

| Path | Upstream version / revision | Source |
|---|---|---|
| `cpython/LICENSE` | CPython `v3.12.13` | `python/cpython` |
| `jieba/LICENSE` | jieba `v0.42.1` | `fxsjy/jieba` |
| `loguru/LICENSE` | Loguru `0.7.3` | `Delgan/loguru` |
| `ordered-set/LICENSE` | ordered-set release `4.1.0`, commit `d921651b...` | `rspeer/ordered-set` |
| `tokenizers/LICENSE` | tokenizers `v0.22.2` | `huggingface/tokenizers` |
| `kokoro-model/README.md` | model revision `01e7505b...` | `hexgrad/Kokoro-82M-v1.1-zh` |

The generated staging also includes the full Apache-2.0 text from the pinned
`kokoro==0.9.4` wheel beside the model card, because the model repository
declares Apache-2.0 in its card but does not publish a separate `LICENSE` file.

These materials are engineering inputs, not a substitute for reviewing the
exact macOS and Windows release artifacts before commercial distribution.
