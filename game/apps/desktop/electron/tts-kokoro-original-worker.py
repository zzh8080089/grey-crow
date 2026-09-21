#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import sys
import wave
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = 1
MODEL_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24000
MAX_REQUEST_BYTES = 64 * 1024
MAX_TEXT_CHARS = 1000
MAX_INFERENCE_PHONEMES = 450
CHUNK_MIN_CHARS = 40
CHUNK_TARGET_CHARS = 80
CHUNK_HARD_MAX_CHARS = 90
STRONG_BOUNDARIES = frozenset("\n\r。！？!?…")
WEAK_BOUNDARIES = frozenset("；;：:，,、")
SUPPORTED_VOICES = {"zf_001", "zf_006", "zm_009", "zm_010"}


class WorkerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    bundle_root = args.bundle_root.resolve()
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    protocol_stdout = isolate_protocol_stdout()

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    try:
        with contextlib.redirect_stdout(sys.stderr):
            engine = load_engine(bundle_root)
    except Exception as error:
        emit_notification(
            protocol_stdout,
            "worker/fatal",
            {"code": "KOKORO_MODEL_LOAD_FAILED", "message": safe_error_message(error)},
        )
        raise SystemExit(2) from error

    for raw_line in sys.stdin.buffer:
        if len(raw_line) > MAX_REQUEST_BYTES:
            emit_error(protocol_stdout, None, "KOKORO_PROTOCOL_MESSAGE_TOO_LARGE", "Worker request is too large.")
            continue
        try:
            request = json.loads(raw_line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            emit_error(protocol_stdout, None, "KOKORO_PROTOCOL_INVALID_JSON", "Worker request is not valid JSON.")
            continue

        request_id = request.get("id") if isinstance(request, dict) else None
        try:
            result = dispatch_request(request, engine, output_root)
            emit_result(protocol_stdout, request_id, result)
            if request.get("method") == "worker/shutdown":
                return
        except WorkerError as error:
            emit_error(protocol_stdout, request_id, error.code, str(error))
        except Exception as error:
            emit_error(protocol_stdout, request_id, "KOKORO_SYNTHESIS_FAILED", safe_error_message(error))


def load_engine(bundle_root: Path) -> dict[str, Any]:
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline

    model_root = bundle_root / "models" / "kokoro-original"
    config_path = model_root / "config.json"
    model_path = model_root / "kokoro-v1_1-zh.pth"
    voice_paths = {voice_id: model_root / f"{voice_id}.pt" for voice_id in SUPPORTED_VOICES}
    for required in (config_path, model_path, *voice_paths.values()):
        if not required.is_file():
            raise WorkerError("KOKORO_MODEL_MISSING", "Original Kokoro resources are incomplete.")

    model = KModel(
        repo_id=MODEL_ID,
        config=str(config_path),
        model=str(model_path),
    ).to("cpu").eval()
    pipeline = KPipeline(lang_code="z", repo_id=MODEL_ID, model=model)
    return {
        "np": np,
        "torch": torch,
        "pipeline": pipeline,
        "voice_paths": {voice_id: str(voice_path) for voice_id, voice_path in voice_paths.items()},
    }


def isolate_protocol_stdout() -> Any:
    """Keep one pipe for JSONL and redirect process-level fd 1 noise to stderr."""
    sys.stdout.flush()
    protocol_fd = os.dup(sys.stdout.fileno())
    protocol_stdout = os.fdopen(protocol_fd, "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    return protocol_stdout


def dispatch_request(request: Any, engine: dict[str, Any], output_root: Path) -> dict[str, Any]:
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
        raise WorkerError("KOKORO_PROTOCOL_INVALID_REQUEST", "Worker request must use JSON-RPC 2.0.")
    request_id = request.get("id")
    if not isinstance(request_id, str) or not request_id:
        raise WorkerError("KOKORO_PROTOCOL_INVALID_REQUEST", "Worker request id is required.")

    method = request.get("method")
    params = request.get("params") if isinstance(request.get("params"), dict) else {}
    if method == "worker/initialize":
        if params.get("protocolVersion") != PROTOCOL_VERSION:
            raise WorkerError("KOKORO_PROTOCOL_VERSION_MISMATCH", "Worker protocol version is not supported.")
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "modelId": MODEL_ID,
            "sampleRate": SAMPLE_RATE,
            "voices": sorted(SUPPORTED_VOICES),
        }
    if method == "worker/shutdown":
        return {"stopped": True}
    if method != "tts/synthesize":
        raise WorkerError("KOKORO_PROTOCOL_METHOD_NOT_FOUND", "Worker method is not supported.")

    text = params.get("text")
    if not isinstance(text, str) or not text.strip():
        raise WorkerError("INVALID_TTS_INPUT", "Synthesis text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise WorkerError("TTS_TEXT_TOO_LONG", "Synthesis text exceeds the worker limit.")
    voice_id = params.get("voiceId") or "zf_001"
    if voice_id not in SUPPORTED_VOICES:
        raise WorkerError("KOKORO_VOICE_UNSUPPORTED", "Requested voice is not installed.")
    speed = normalize_number(params.get("speed"), 0.5, 2.0, 1.0)
    output_file = require_output_file(params.get("outputFile"), output_root)

    with contextlib.redirect_stdout(sys.stderr):
        audio, coverage = synthesize(engine, text, speed, voice_id)
    write_pcm16_wav(output_file, audio, SAMPLE_RATE, engine["np"])
    size = output_file.stat().st_size
    if size <= 44:
        raise WorkerError("KOKORO_EMPTY_AUDIO", "Original Kokoro returned empty audio.")
    return {
        "bytes": size,
        "sampleRate": SAMPLE_RATE,
        "durationMs": round((len(audio) / SAMPLE_RATE) * 1000),
        **coverage,
    }


def synthesize(engine: dict[str, Any], text: str, speed: float, voice_id: str) -> tuple[Any, dict[str, Any]]:
    np = engine["np"]
    pipeline = engine["pipeline"]
    chunks = plan_phoneme_safe_chunks(pipeline, text)
    segments = []
    silence = np.zeros(int(SAMPLE_RATE * 0.08), dtype=np.float32)
    for chunk in chunks:
        phonemes = chunk["phonemes"]
        if not phonemes:
            continue
        generated = False
        for result in pipeline.generate_from_tokens(
            phonemes,
            voice=engine["voice_paths"][voice_id],
            speed=speed,
        ):
            generated = True
            if segments:
                segments.append(silence)
            audio = result.audio
            if audio is None:
                raise WorkerError("KOKORO_EMPTY_AUDIO", "Original Kokoro returned an empty inference chunk.")
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            segments.append(np.asarray(audio, dtype=np.float32))
        if not generated:
            raise WorkerError("KOKORO_EMPTY_AUDIO", "Original Kokoro skipped an inference chunk.")
    if not segments:
        raise WorkerError("KOKORO_EMPTY_AUDIO", "Original Kokoro returned no audio segments.")
    reconstructed = "".join(chunk["text"] for chunk in chunks)
    if reconstructed != text:
        raise WorkerError("KOKORO_TEXT_COVERAGE_FAILED", "Original Kokoro chunking did not cover the complete input.")
    return np.concatenate(segments), {
        "inputChars": len(text),
        "inferenceChunks": len(chunks),
        "maxPhonemes": max(len(chunk["phonemes"]) for chunk in chunks),
        "coverageHash": hashlib.sha256(reconstructed.encode("utf-8")).hexdigest(),
    }


def plan_phoneme_safe_chunks(pipeline: Any, text: str) -> list[dict[str, str]]:
    chunks = []
    cursor = 0
    while cursor < len(text):
        end = choose_natural_end(text, cursor)
        candidate = text[cursor:end]
        phonemes = phonemize(pipeline, candidate)
        if len(phonemes) > MAX_INFERENCE_PHONEMES:
            end = find_phoneme_safe_end(pipeline, text, cursor, end)
            candidate = text[cursor:end]
            phonemes = phonemize(pipeline, candidate)
        if end <= cursor or len(phonemes) > MAX_INFERENCE_PHONEMES:
            raise WorkerError("KOKORO_PHONEME_LIMIT", "Original Kokoro could not create a safe inference chunk.")
        chunks.append({"text": candidate, "phonemes": phonemes})
        cursor = end

    if not chunks or "".join(chunk["text"] for chunk in chunks) != text:
        raise WorkerError("KOKORO_TEXT_COVERAGE_FAILED", "Original Kokoro chunking did not cover the complete input.")
    return chunks


def choose_natural_end(text: str, start: int) -> int:
    remaining = len(text) - start
    if remaining <= CHUNK_HARD_MAX_CHARS:
        return len(text)
    minimum = min(len(text), start + CHUNK_MIN_CHARS)
    target = min(len(text), start + CHUNK_TARGET_CHARS)
    hard_max = min(len(text), start + CHUNK_HARD_MAX_CHARS)
    return (
        find_boundary(text, minimum, target, hard_max, STRONG_BOUNDARIES)
        or find_boundary(text, minimum, target, hard_max, WEAK_BOUNDARIES)
        or target
    )


def find_boundary(text: str, minimum: int, target: int, hard_max: int, boundaries: frozenset[str]) -> int:
    for end in range(target, minimum - 1, -1):
        if text[end - 1] in boundaries:
            return end
    for end in range(target + 1, hard_max + 1):
        if text[end - 1] in boundaries:
            return end
    return 0


def find_phoneme_safe_end(pipeline: Any, text: str, start: int, proposed_end: int) -> int:
    low = start + 1
    high = proposed_end
    safe_end = 0
    while low <= high:
        middle = (low + high) // 2
        if len(phonemize(pipeline, text[start:middle])) <= MAX_INFERENCE_PHONEMES:
            safe_end = middle
            low = middle + 1
        else:
            high = middle - 1
    if safe_end <= start:
        return 0

    natural_minimum = max(start + 1, safe_end - CHUNK_MIN_CHARS)
    for boundaries in (STRONG_BOUNDARIES, WEAK_BOUNDARIES):
        for end in range(safe_end, natural_minimum - 1, -1):
            if text[end - 1] in boundaries:
                return end
    return safe_end


def phonemize(pipeline: Any, text: str) -> str:
    phonemes, _tokens = pipeline.g2p(text)
    return phonemes or ""


def require_output_file(value: Any, output_root: Path) -> Path:
    if not isinstance(value, str):
        raise WorkerError("INVALID_KOKORO_OUTPUT", "Output file is required.")
    output_file = Path(value).resolve()
    if output_file.suffix.lower() != ".wav" or not is_inside(output_root, output_file):
        raise WorkerError("INVALID_KOKORO_OUTPUT", "Output file is outside the TTS cache.")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    return output_file


def write_pcm16_wav(output_file: Path, audio: Any, sample_rate: int, np: Any) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype("<i2", copy=False)
    with wave.open(str(output_file), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())


def is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def normalize_number(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return min(maximum, max(minimum, number))


def emit_result(stream: Any, request_id: Any, result: dict[str, Any]) -> None:
    emit(stream, {"jsonrpc": "2.0", "id": request_id, "result": result})


def emit_error(stream: Any, request_id: Any, code: str, message: str) -> None:
    emit(
        stream,
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": message,
                "data": {"code": code},
            },
        },
    )


def emit_notification(stream: Any, method: str, params: dict[str, Any]) -> None:
    emit(stream, {"jsonrpc": "2.0", "method": method, "params": params})


def emit(stream: Any, payload: dict[str, Any]) -> None:
    stream.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()


def safe_error_message(error: Exception) -> str:
    if isinstance(error, WorkerError):
        return str(error)
    return "Original Kokoro worker failed."


if __name__ == "__main__":
    main()
