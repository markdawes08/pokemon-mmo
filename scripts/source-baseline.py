"""Create/verify a byte-addressed private reference baseline without Git.

Only reads the reference tree. Snapshot metadata is fixed for repeatability.
The manifest records every included input, including generated assets retained
in the supplied tree, so later importers can check the exact bytes they consume.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIR_NAMES = {".git", "build", "__pycache__", ".cache", ".idea", ".vscode", "node_modules"}
EXCLUDED_TREE_PREFIXES = ("tools/agbcc/", "tools/binutils/")
EXCLUDED_SUFFIXES = {".o", ".elf", ".exe", ".dll", ".sav", ".sgm", ".map", ".pyc"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def ignored(rel: str) -> str | None:
    parts = rel.split("/")
    if any(p in EXCLUDED_DIR_NAMES or p.startswith(("cmake-build-", "build-cmake-")) for p in parts[:-1]):
        return "build/cache/metadata directory"
    if rel.startswith(EXCLUDED_TREE_PREFIXES):
        return "external original-ROM toolchain"
    suffix = Path(rel).suffix.lower()
    if suffix in EXCLUDED_SUFFIXES or re.fullmatch(r"\.(?:ss|sa|sg)\d+", suffix):
        return "compiled output/save/cache"
    if suffix == ".gba" and not rel.startswith("data/"):
        return "compiled ROM (not a browser input)"
    return None


def inventory(source: Path) -> tuple[list[dict], list[dict]]:
    records, excluded = [], []
    for folder, dirs, files in os.walk(source, followlinks=False):
        dirs.sort()
        for name in sorted(files):
            path = Path(folder) / name
            rel = path.relative_to(source).as_posix()
            reason = ignored(rel)
            if reason:
                excluded.append({"path": rel, "reason": reason})
                continue
            if path.is_symlink():
                raise ValueError(f"Reference symlink needs explicit handling: {rel}")
            data = path.read_bytes()
            records.append({"path": rel, "size": len(data), "sha256": sha(data)})
    records.sort(key=lambda item: item["path"])
    excluded.sort(key=lambda item: item["path"])
    return records, excluded


def fingerprint(records: list[dict]) -> str:
    # Encoding is part of schema v1. No absolute paths or modification times.
    payload = "".join(f"{r['sha256']}  {r['size']}  {r['path']}\n" for r in records)
    return sha(payload.encode("utf-8"))


def create(source: Path) -> None:
    records, excluded = inventory(source)
    value = fingerprint(records)
    archive_rel = f"reference/source-{value[:16]}.zip"
    archive = ROOT / archive_rel
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=archive.parent, suffix=".zip", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for record in records:
                data = (source / record["path"]).read_bytes()
                if sha(data) != record["sha256"]:
                    raise ValueError(f"Source changed while capturing: {record['path']}")
                info = zipfile.ZipInfo(record["path"], (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        if archive.exists() and sha(archive.read_bytes()) != sha(temp_path.read_bytes()):
            raise ValueError("Existing archive differs for the same input fingerprint; refusing overwrite")
        temp_path.replace(archive)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    manifest = {
        "schemaVersion": 1,
        "fingerprintAlgorithm": "SHA256 of UTF8 lines '<sha256>  <size>  <relativePath>\\n', sorted by relativePath",
        "sourceFingerprint": value,
        "recordCount": len(records),
        "totalBytes": sum(r["size"] for r in records),
        "records": records,
        "excluded": excluded,
    }
    lock = {
        "schemaVersion": 1,
        "reference": {
            "repositoryUrl": "https://github.com/pret/pokefirered",
            "upstreamCommit": None,
            "revisionStatus": "unknown: supplied source directory has no Git metadata; Git explicitly deferred by user",
            "localPath": source.as_posix(),
            "dirtyState": "unknown against upstream; exact local included bytes are pinned below",
        },
        "selectedBuild": {"game": "FIRERED", "revision": 0, "language": "ENGLISH", "evidence": "config.mk:3-5"},
        "fingerprint": {"algorithm": "sha256", "value": value, "manifest": "reports/source-manifest.json"},
        "snapshot": {"path": archive_rel, "sha256": sha(archive.read_bytes()), "format": "zip", "private": True},
        "scope": {
            "profile": "firered-private",
            "normalCampaign": "through Champion and source-defined normal Sevii/postgame",
            "eventOnly": "inventory and preserve source gates; disabled unless separately configured",
            "deferred": "original wireless/link presentation/minigames/distribution/external connectivity; see reports/source-scope.json",
        },
        "capturePolicy": {
            "includes": "all supplied regular files except explicit compiled outputs, saves, caches, metadata, and original-ROM toolchain trees; existing generated input assets are retained",
            "excludedDirectories": sorted(EXCLUDED_DIR_NAMES),
            "excludedTreePrefixes": list(EXCLUDED_TREE_PREFIXES),
            "excludedSuffixes": sorted(EXCLUDED_SUFFIXES),
            "otherExclusions": ["non-data/*.gba", "*.ssN / *.saN / *.sgN", "cmake-build-* / build-cmake-*"],
            "upstreamCleanlinessVerified": False,
            "romBuildVerified": False,
        },
    }
    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "reports/source-manifest.json").write_bytes(encode(manifest))
    (ROOT / "source-lock.json").write_bytes(encode(lock))
    print(json.dumps({"sourceFingerprint": value, "fileCount": len(records), "inputBytes": manifest["totalBytes"], "archive": archive_rel, "archiveSha256": lock["snapshot"]["sha256"]}))


def verify(source: Path, report: Path | None) -> None:
    lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / lock["fingerprint"]["manifest"]).read_text(encoding="utf-8"))
    records, _ = inventory(source)
    if records != manifest["records"] or fingerprint(records) != lock["fingerprint"]["value"]:
        raise ValueError("Current reference inputs differ from source-lock; do not use stale generated content")
    archive = ROOT / lock["snapshot"]["path"]
    if sha(archive.read_bytes()) != lock["snapshot"]["sha256"]:
        raise ValueError("Snapshot archive hash mismatch")
    with zipfile.ZipFile(archive) as zf:
        if zf.namelist() != [r["path"] for r in records]:
            raise ValueError("Archive entry list differs from manifest")
        for record in records:
            data = zf.read(record["path"])
            if len(data) != record["size"] or sha(data) != record["sha256"]:
                raise ValueError(f"Archive entry differs: {record['path']}")
    result = {"status": "passed", "sourceFingerprint": lock["fingerprint"]["value"], "verifiedFiles": len(records), "checks": ["current included reference bytes match manifest", "aggregate fingerprint matches lock", "archive SHA256 matches lock", "every archive entry matches path, size, and SHA256"], "upstreamCommitVerified": False, "romBuildVerified": False}
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_bytes(encode(result))
    print(json.dumps(result))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["create", "verify"])
    parser.add_argument("--source", type=Path, default=Path("C:/Users/mrkda/Projects/pokefirered-master"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    if not (source / "config.mk").is_file():
        parser.error("Source must contain config.mk")
    if args.mode == "create":
        create(source)
    else:
        verify(source, args.report)


if __name__ == "__main__":
    main()
