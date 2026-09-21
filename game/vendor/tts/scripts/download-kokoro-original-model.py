#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download


MODEL_ID = "hexgrad/Kokoro-82M-v1.1-zh"
REVISION = "01e7505bd6a7a2ac4975463114c3a7650a9f7218"
MODEL_FILES = {
    "config.json": "config.json",
    "kokoro-v1_1-zh.pth": "kokoro-v1_1-zh.pth",
    "voices/zf_001.pt": "zf_001.pt",
    "voices/zf_006.pt": "zf_006.pt",
    "voices/zm_009.pt": "zm_009.pt",
    "voices/zm_010.pt": "zm_010.pt",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest_files = []
    for remote_name, local_name in MODEL_FILES.items():
        downloaded = Path(hf_hub_download(
            repo_id=MODEL_ID,
            filename=remote_name,
            revision=REVISION,
        ))
        destination = output / local_name
        shutil.copy2(downloaded, destination)
        manifest_files.append({
            "source": remote_name,
            "target": local_name,
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
        })

    manifest = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "revision": REVISION,
        "files": manifest_files,
    }
    (output / "model-downloads.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True,
        "modelId": MODEL_ID,
        "revision": REVISION,
        "files": len(manifest_files),
        "output": str(output),
    }, ensure_ascii=False))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
