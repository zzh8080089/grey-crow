#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import shutil
import sys
import zipfile
from pathlib import Path


# This allowlist is intentionally based on the modules loaded by the zh-CN
# worker corpus, then widened for stable Torch/Transformers imports. It is not
# derived from the upstream `kokoro` extra because that extra pulls English G2P.
RUNTIME_DISTRIBUTIONS = (
    "addict",
    "anyio",
    "attrs",
    "certifi",
    "click",
    "cn2an",
    "filelock",
    "fsspec",
    "h11",
    "httpcore",
    "httpx",
    "huggingface-hub",
    "idna",
    "jieba",
    "jinja2",
    "kokoro",
    "loguru",
    "markupsafe",
    "misaki",
    "mpmath",
    "networkx",
    "numpy",
    "ordered-set",
    "packaging",
    "proces",
    "pygments",
    "pypinyin",
    "pypinyin-dict",
    "pyyaml",
    "regex",
    "rich",
    "safetensors",
    "setuptools",
    "socksio",
    "sympy",
    "tokenizers",
    "torch",
    "tqdm",
    "transformers",
    "typing-extensions",
)

WINDOWS_RUNTIME_DISTRIBUTIONS = (
    "colorama",
    "win32-setctime",
)

FORBIDDEN_NAMES = (
    "_soundfile",
    "_soundfile_data",
    "soundfile",
    "libsndfile",
    "espeak",
    "phonemizer",
    "pyopenjtalk",
)

PYTHON_BASE_EXCLUDES = {
    "__pycache__",
    "Doc",
    "Tools",
    "ensurepip",
    "include",
    "idlelib",
    "lib2to3",
    "libs",
    "site-packages",
    "tcl",
    "test",
    "tkinter",
    "turtledemo",
    "venv",
}

PYTHON_ROOT_FILE_EXCLUDES = {
    "NEWS.txt",
    "python3.exe",
    "pythonw.exe",
}

PURE_PYTHON_BUNDLE_ITEMS = (
    "addict",
    "anyio",
    "attr",
    "attrs",
    "click",
    "cn2an",
    "filelock",
    "fsspec",
    "h11",
    "httpcore",
    "httpx",
    "huggingface_hub",
    "idna",
    "jinja2",
    "loguru",
    "mpmath",
    "networkx",
    "ordered_set",
    "packaging",
    "proces",
    "pygments",
    "rich",
    "socksio",
    "sympy",
    "torchgen",
    "tqdm",
    "typing_extensions.py",
)

NATIVE_MODULE_SUFFIXES = (".dll", ".dylib", ".pyd", ".so")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-base", type=Path, required=True)
    parser.add_argument("--site-packages", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--platform-label", default="macos-arm64")
    parser.add_argument("--python-layout", choices=("unix", "windows"), default="unix")
    parser.add_argument(
        "--python-version",
        default=f"{sys.version_info.major}.{sys.version_info.minor}",
    )
    args = parser.parse_args()

    python_base = args.python_base.resolve()
    site_packages = args.site_packages.resolve()
    output = args.output.resolve()
    require_directory(python_base, "Python base")
    require_directory(site_packages, "site-packages")
    if (
        output == python_base
        or output == site_packages
        or output in python_base.parents
        or python_base in output.parents
        or site_packages in output.parents
    ):
        raise SystemExit("Refusing to overwrite the source Python runtime.")

    distributions = {
        canonicalize(dist.metadata["Name"]): dist
        for dist in metadata.Distribution.discover(path=[str(site_packages)])
        if dist.metadata.get("Name")
    }
    requested_distributions = RUNTIME_DISTRIBUTIONS + (
        WINDOWS_RUNTIME_DISTRIBUTIONS if args.python_layout == "windows" else ()
    )
    missing = [name for name in requested_distributions if canonicalize(name) not in distributions]
    if missing:
        raise SystemExit(f"Missing required runtime distributions: {', '.join(missing)}")

    shutil.rmtree(output, ignore_errors=True)
    copy_python_base(python_base, output)
    output_site = (
        output / "Lib" / "site-packages"
        if args.python_layout == "windows"
        else output / "lib" / python_version_dir(site_packages) / "site-packages"
    )
    output_site.mkdir(parents=True, exist_ok=True)

    copied_files: set[str] = set()
    inventory: list[dict[str, object]] = []
    for requested_name in requested_distributions:
        dist = distributions[canonicalize(requested_name)]
        files = copy_distribution(dist, site_packages, output_site, copied_files)
        inventory.append({
            "name": dist.metadata["Name"],
            "version": dist.version,
            "license": normalize_license(dist.metadata.get("License")),
            "files": files,
        })

    prune_zh_only_modules(output_site)
    pruned_development_files = prune_runtime_development_files(output_site)
    remove_python_cache(output)
    bundled_pure_python_entries = bundle_pure_python_packages(output_site)
    remove_python_cache(output)
    forbidden = find_forbidden(output)
    if forbidden:
        joined = "\n".join(f"- {item}" for item in forbidden)
        raise SystemExit(f"Forbidden runtime files survived pruning:\n{joined}")

    manifest = {
        "schemaVersion": 1,
        "platform": args.platform_label,
        "pythonVersion": args.python_version,
        "pythonLayout": args.python_layout,
        "distributionCount": len(inventory),
        "distributions": sorted(inventory, key=lambda item: str(item["name"]).lower()),
        "forbiddenNames": list(FORBIDDEN_NAMES),
        "pruningProfile": "player-extract-v1",
        "prunedDevelopmentFiles": pruned_development_files,
        "bundledPurePythonEntries": bundled_pure_python_entries,
    }
    inventory_path = output / "runtime-inventory.json"
    inventory_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    manifest["runtimeFileCount"] = count_files(output)
    inventory_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True,
        "distributionCount": len(inventory),
        "copiedFiles": len(copied_files),
        "runtimeFileCount": manifest["runtimeFileCount"],
        "prunedDevelopmentFiles": pruned_development_files,
        "bundledPurePythonEntries": bundled_pure_python_entries,
        "output": str(output),
    }, ensure_ascii=False))


def copy_python_base(source: Path, destination: Path) -> None:
    def ignore(directory: str, names: list[str]) -> set[str]:
        current = Path(directory)
        ignored = {name for name in names if name in PYTHON_BASE_EXCLUDES}
        if current.resolve() == source.resolve():
            ignored.update(name for name in names if name in PYTHON_ROOT_FILE_EXCLUDES)
            ignored.update(
                name
                for name in names
                if name.lower().startswith("python-") and name.lower().endswith("-amd64.exe")
            )
        if current.name in {"bin", "share"}:
            ignored.update(name for name in names if name not in {"python3", "python3.12"})
        return ignored

    shutil.copytree(source, destination, symlinks=True, ignore=ignore)


def copy_distribution(
    dist: metadata.Distribution,
    source_root: Path,
    destination_root: Path,
    copied_files: set[str],
) -> int:
    copied = 0
    for package_file in dist.files or ():
        relative = Path(str(package_file))
        source = (source_root / relative).resolve()
        try:
            safe_relative = source.relative_to(source_root)
        except ValueError:
            continue
        if not source.is_file():
            continue
        destination = destination_root / safe_relative
        key = safe_relative.as_posix()
        if key in copied_files:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination, follow_symlinks=True)
        copied_files.add(key)
        copied += 1
    if copied == 0:
        raise SystemExit(f"Distribution {dist.metadata['Name']} did not contribute runtime files.")
    return copied


def remove_python_cache(root: Path) -> None:
    for path in sorted(root.rglob("__pycache__"), reverse=True):
        shutil.rmtree(path, ignore_errors=True)
    for path in root.rglob("*.pyc"):
        path.unlink(missing_ok=True)


def prune_runtime_development_files(site_packages: Path) -> int:
    before = count_files(site_packages)
    for relative in ("torch/include", "torch/share"):
        shutil.rmtree(site_packages / relative, ignore_errors=True)
    torch_lib = site_packages / "torch" / "lib"
    if torch_lib.is_dir():
        for suffix in ("*.a", "*.lib"):
            for path in torch_lib.glob(suffix):
                path.unlink(missing_ok=True)

    transformers_models = site_packages / "transformers" / "models"
    if transformers_models.is_dir():
        for path in transformers_models.iterdir():
            if path.is_dir() and path.name not in {"albert", "auto", "__pycache__"}:
                shutil.rmtree(path)

    test_directories = [
        path
        for path in site_packages.rglob("*")
        if path.is_dir() and path.name.lower() in {"test", "tests"}
    ]
    for path in sorted(test_directories, key=lambda item: len(item.parts), reverse=True):
        shutil.rmtree(path, ignore_errors=True)
    return before - count_files(site_packages)


def bundle_pure_python_packages(site_packages: Path) -> int:
    archive_path = site_packages / "grey-crow-pure-python.zip"
    bundled_paths: list[Path] = []
    files: list[Path] = []
    for relative in PURE_PYTHON_BUNDLE_ITEMS:
        path = site_packages / relative
        if not path.exists():
            raise SystemExit(f"Pure-Python bundle input is missing: {relative}")
        bundled_paths.append(path)
        candidates = [path] if path.is_file() else list(path.rglob("*"))
        for candidate in candidates:
            if not candidate.is_file():
                continue
            if candidate.name.lower().endswith(NATIVE_MODULE_SUFFIXES):
                raise SystemExit(f"Pure-Python bundle input contains a native module: {candidate}")
            files.append(candidate)

    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for path in sorted(files, key=lambda item: item.relative_to(site_packages).as_posix()):
            archive.write(path, path.relative_to(site_packages).as_posix())

    for path in bundled_paths:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    (site_packages / "grey-crow-pure-python.pth").write_text(
        "grey-crow-pure-python.zip\n",
        encoding="utf-8",
    )
    return len(files)


def prune_zh_only_modules(site_packages: Path) -> None:
    misaki_root = site_packages / "misaki"
    for relative in (
        "cutlet.py",
        "data",
        "en.py",
        "espeak.py",
        "g2pkc",
        "he.py",
        "ja.py",
        "ko.py",
        "num2kana.py",
        "vi.py",
        "vi_cleaner",
    ):
        path = misaki_root / relative
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)


def find_forbidden(root: Path) -> list[str]:
    findings = []
    for path in root.rglob("*"):
        lowered = path.name.lower().replace("-", "_")
        if any(name in lowered for name in FORBIDDEN_NAMES):
            findings.append(path.relative_to(root).as_posix())
    return sorted(findings)


def count_files(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file())


def python_version_dir(site_packages: Path) -> str:
    parent = site_packages.parent.name
    if not parent.startswith("python"):
        raise SystemExit(f"Unexpected site-packages path: {site_packages}")
    return parent


def canonicalize(value: str) -> str:
    return value.lower().replace("_", "-").replace(".", "-")


def normalize_license(value: str | None) -> str:
    if not value:
        return "NOASSERTION"
    first_line = next((line.strip() for line in value.splitlines() if line.strip()), "NOASSERTION")
    return first_line[:160]


def require_directory(path: Path, label: str) -> None:
    if not path.is_dir():
        raise SystemExit(f"{label} does not exist: {path}")


if __name__ == "__main__":
    main()
