#!/usr/bin/env python3
from __future__ import annotations

import sysconfig
from pathlib import Path


def main() -> None:
    pipeline_path = Path(sysconfig.get_paths()["purelib"]) / "kokoro/pipeline.py"
    source = pipeline_path.read_text(encoding="utf-8")

    if "# GREY_CROW_ZH_ONLY_LAZY_IMPORT" in source:
        if "from misaki.token import MToken" not in source or "from misaki import en, espeak" not in source:
            raise RuntimeError("Existing Kokoro zh-only patch is incomplete")
        print(f"Kokoro zh-only lazy imports already patched: {pipeline_path}")
        return

    source = source.replace(
        "from misaki import en, espeak\n",
        "from misaki.token import MToken\n",
        1,
    )
    source = source.replace("en.MToken", "MToken")

    source = source.replace(
        "        if lang_code in 'ab':\n            try:\n",
        "        if lang_code in 'ab':\n"
        "            # GREY_CROW_ZH_ONLY_LAZY_IMPORT\n"
        "            from misaki import en, espeak\n"
        "            try:\n",
    )
    source = source.replace(
        "        else:\n            language = LANG_CODES[lang_code]\n",
        "        else:\n"
        "            from misaki import espeak\n"
        "            language = LANG_CODES[lang_code]\n",
    )

    if "from misaki import en, espeak" not in source or "from misaki.token import MToken" not in source:
        raise RuntimeError("Kokoro lazy-import patch did not match the expected 0.9.4 source")

    pipeline_path.write_text(source, encoding="utf-8")
    print(f"Patched Kokoro zh-only lazy imports: {pipeline_path}")


if __name__ == "__main__":
    main()
