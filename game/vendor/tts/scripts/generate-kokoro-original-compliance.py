#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime
import hashlib
import importlib.metadata as metadata
import json
import shutil
from pathlib import Path


LICENSE_NAMES = ("license", "licence", "notice", "copying", "copyright")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-root", type=Path, required=True)
    args = parser.parse_args()

    stage_root = args.stage_root.resolve()
    python = stage_root / "python"
    site_packages = find_site_packages(python)
    model_root = stage_root / "models" / "kokoro-original"
    inventory_path = python / "runtime-inventory.json"
    if not site_packages or not site_packages.is_dir() or not model_root.is_dir():
        raise SystemExit("Staging is missing its Python or Kokoro model runtime.")
    if not inventory_path.is_file():
        raise SystemExit("Staging is missing runtime-inventory.json.")

    compliance_root = stage_root / "compliance"
    licenses_root = compliance_root / "licenses"
    shutil.rmtree(compliance_root, ignore_errors=True)
    licenses_root.mkdir(parents=True)

    components = []
    unresolved = []
    for dist in sorted(
        metadata.Distribution.discover(path=[str(site_packages)]),
        key=lambda item: (item.metadata.get("Name") or "").lower(),
    ):
        name = dist.metadata.get("Name")
        if not name:
            continue
        license_files = copy_license_files(dist, site_packages, licenses_root / safe_name(name))
        license_value = normalized_license(dist.metadata)
        if not license_files:
            unresolved.append(name)
        components.append({
            "name": name,
            "version": dist.version,
            "licenseDeclared": license_value,
            "homepage": dist.metadata.get("Home-page") or dist.metadata.get("Project-URL") or "",
            "licenseFiles": license_files,
        })

    model_files = []
    for name in ("LICENSE", "README.md"):
        source = model_root / name
        if source.is_file():
            destination = licenses_root / "kokoro-model" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            model_files.append(destination.relative_to(compliance_root).as_posix())
    if not any(path.endswith("LICENSE") for path in model_files):
        unresolved.append("hexgrad/Kokoro-82M-v1.1-zh model LICENSE")

    python_license = python / "LICENSE"
    if python_license.is_file():
        destination = licenses_root / "python" / "LICENSE"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(python_license, destination)
    else:
        unresolved.append("CPython LICENSE")

    modification_notice = compliance_root / "MODIFICATIONS.md"
    modification_notice.write_text(
        "# Grey Crow TTS Runtime Modifications\n\n"
        "- The bundled Kokoro 0.9.4 pipeline uses a Grey Crow lazy-import patch so the zh-CN "
        "runtime does not import or distribute the English eSpeak path.\n"
        "- Grey Crow writes PCM16 WAV with Python's standard library instead of SoundFile/libsndfile.\n"
        "- The runtime contains only four curated zh-CN voices and a pruned Python dependency set.\n",
        encoding="utf-8",
    )

    file_entries = collect_files(stage_root)
    spdx = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": "Grey-Crow-Kokoro-zh-CN-runtime",
        "documentNamespace": f"https://grey-crow.local/spdx/kokoro-zh-cn/{tree_digest(file_entries)}",
        "creationInfo": {
            "created": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "creators": ["Tool: Grey Crow offline compliance generator"],
        },
        "packages": [
            {
                "name": item["name"],
                "SPDXID": f"SPDXRef-Package-{safe_name(item['name'])}",
                "versionInfo": item["version"],
                "downloadLocation": "NOASSERTION",
                "filesAnalyzed": False,
                "licenseConcluded": "NOASSERTION",
                "licenseDeclared": item["licenseDeclared"],
                "copyrightText": "NOASSERTION",
            }
            for item in components
        ],
        "files": file_entries,
    }
    (compliance_root / "sbom.spdx.json").write_text(
        json.dumps(spdx, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (compliance_root / "third-party-components.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "components": components,
            "model": {
                "name": "hexgrad/Kokoro-82M-v1.1-zh",
                "licenseDeclared": "Apache-2.0",
                "licenseFiles": model_files,
            },
            "unresolved": unresolved,
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_notice(compliance_root / "THIRD_PARTY_NOTICES.md", components, model_files, unresolved)

    if unresolved:
        raise SystemExit("Compliance inventory has unresolved licenses: " + ", ".join(unresolved))
    print(json.dumps({
        "ok": True,
        "components": len(components),
        "files": len(file_entries),
        "treeSha256": tree_digest(file_entries),
        "output": str(compliance_root),
    }, ensure_ascii=False))


def find_site_packages(python: Path) -> Path | None:
    windows_site = python / "Lib" / "site-packages"
    if windows_site.is_dir():
        return windows_site
    return next((python / "lib").glob("python*/site-packages"), None)


def copy_license_files(
    dist: metadata.Distribution,
    source_root: Path,
    destination_root: Path,
) -> list[str]:
    copied = []
    candidates = {(source_root / Path(str(package_file))).resolve() for package_file in dist.files or ()}
    dist_info = Path(getattr(dist, "_path", ""))
    if dist_info.is_dir():
        candidates.update(path.resolve() for path in dist_info.rglob("*") if path.is_file())
    for source in sorted(candidates):
        if not any(token in source.name.lower() for token in LICENSE_NAMES):
            continue
        try:
            source.relative_to(source_root)
        except ValueError:
            continue
        if not source.is_file():
            continue
        destination_root.mkdir(parents=True, exist_ok=True)
        destination = destination_root / source.name
        suffix = 2
        while destination.exists() and destination.read_bytes() != source.read_bytes():
            destination = destination_root / f"{source.stem}-{suffix}{source.suffix}"
            suffix += 1
        if not destination.exists():
            shutil.copy2(source, destination)
        copied.append(destination.relative_to(destination_root.parent.parent).as_posix())
    return sorted(set(copied))


def collect_files(stage_root: Path) -> list[dict[str, object]]:
    entries = []
    for path in sorted(stage_root.rglob("*")):
        if not path.is_file() or "compliance" in path.relative_to(stage_root).parts:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = "./" + path.relative_to(stage_root).as_posix()
        file_id = hashlib.sha256(f"{relative}\0{digest}".encode()).hexdigest()[:20]
        entries.append({
            "fileName": relative,
            "SPDXID": "SPDXRef-File-" + file_id,
            "checksums": [{"algorithm": "SHA256", "checksumValue": digest}],
            "licenseConcluded": "NOASSERTION",
            "licenseInfoInFiles": ["NOASSERTION"],
            "copyrightText": "NOASSERTION",
        })
    return entries


def tree_digest(entries: list[dict[str, object]]) -> str:
    digest = hashlib.sha256()
    for item in entries:
        digest.update(str(item["fileName"]).encode())
        digest.update(str(item["checksums"][0]["checksumValue"]).encode())
    return digest.hexdigest()


def write_notice(path: Path, components: list[dict[str, object]], model_files: list[str], unresolved: list[str]) -> None:
    rows = [
        "# Grey Crow Kokoro zh-CN Third-Party Notices",
        "",
        "This inventory is generated from the actual pruned staging directory. It is engineering evidence, not legal advice.",
        "",
        "## Model",
        "",
        "- `hexgrad/Kokoro-82M-v1.1-zh` - Apache-2.0",
        f"- Included model materials: {', '.join(model_files) or 'MISSING'}",
        "",
        "## Python runtime components",
        "",
        "| Component | Version | Declared license | Included license files |",
        "|---|---:|---|---|",
    ]
    for item in components:
        files = ", ".join(item["licenseFiles"]) or "metadata only"
        rows.append(f"| `{item['name']}` | `{item['version']}` | {item['licenseDeclared']} | {files} |")
    rows.extend([
        "",
        "## Modifications",
        "",
        "See `MODIFICATIONS.md` beside this notice.",
        "",
        "## Release gate",
        "",
        "This notice must be regenerated separately from the exact macOS and Windows artifacts before release.",
    ])
    if unresolved:
        rows.extend(["", "Unresolved license materials: " + ", ".join(unresolved)])
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")


def normalized_license(package_metadata: metadata.PackageMetadata) -> str:
    expression = package_metadata.get("License-Expression")
    if expression:
        return expression.strip()
    value = package_metadata.get("License")
    classifiers = package_metadata.get_all("Classifier", [])
    if not value or value.strip().upper() == "UNKNOWN":
        if "License :: OSI Approved :: MIT License" in classifiers:
            return "MIT"
        if "License :: OSI Approved :: Apache Software License" in classifiers:
            return "Apache-2.0"
        if "License :: OSI Approved :: BSD License" in classifiers:
            return "BSD-3-Clause"
        return "NOASSERTION"
    first = next((line.strip() for line in value.splitlines() if line.strip()), "NOASSERTION")
    aliases = {
        "Apache 2.0": "Apache-2.0",
        "Apache 2.0 License": "Apache-2.0",
        "Apache License 2.0": "Apache-2.0",
        "Apache License": "Apache-2.0",
        "MIT License": "MIT",
        "BSD 3-Clause License": "BSD-3-Clause",
        "BSD": "BSD-3-Clause",
    }
    return aliases.get(first, first[:160])


def safe_name(value: str) -> str:
    return "".join(character.lower() if character.isalnum() else "-" for character in value).strip("-")


if __name__ == "__main__":
    main()
