#!/usr/bin/env python3
from __future__ import annotations

import argparse
import time
import wave
from pathlib import Path

import numpy as np
import torch
from kokoro import KModel, KPipeline


SAMPLE_RATE = 24000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    bundle_root = args.bundle_root.resolve()
    model_root = bundle_root / "models/kokoro-original"
    load_started = time.perf_counter()
    model = KModel(
        repo_id="hexgrad/Kokoro-82M-v1.1-zh",
        config=str(model_root / "config.json"),
        model=str(model_root / "kokoro-v1_1-zh.pth"),
    ).to("cpu").eval()
    pipeline = KPipeline(
        lang_code="z",
        repo_id="hexgrad/Kokoro-82M-v1.1-zh",
        model=model,
    )
    load_seconds = time.perf_counter() - load_started

    synthesis_started = time.perf_counter()
    segments: list[np.ndarray] = []
    silence = np.zeros(int(SAMPLE_RATE * 0.08), dtype=np.float32)
    voice_path = str(model_root / "zf_001.pt")
    for result in pipeline(args.text, voice=voice_path, speed=1.0):
        if segments:
            segments.append(silence)
        segments.append(np.asarray(result.audio, dtype=np.float32))
    if not segments:
        raise RuntimeError("Kokoro original package smoke returned no audio")
    audio = np.concatenate(segments)
    synthesis_seconds = time.perf_counter() - synthesis_started

    args.output.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype("<i2", copy=False)
    with wave.open(str(args.output), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16.tobytes())
    print(
        "package_smoke_ok "
        f"load_seconds={load_seconds:.4f} "
        f"synth_seconds={synthesis_seconds:.4f} "
        f"audio_seconds={len(audio) / SAMPLE_RATE:.4f} "
        f"output={args.output}"
    )


if __name__ == "__main__":
    main()
