"""Test-only storage for independently derived fixture literals; no oracle logic."""
from __future__ import annotations
import gzip
import hashlib
import io
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("manifest.json")


def fixture_entries():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("fixtures"), list):
        raise ValueError("Unsupported fixture manifest")
    rows = manifest["fixtures"]
    for row in rows:
        if (not re.fullmatch(r"tools/(battle-[a-z0-9-]+|encounter-core)/fixtures/(source|items)-cases\.json", row["path"])
                or row["archive"] != row["path"] + ".gz"
                or not 0 < row["canonicalBytes"] <= 64 * 1024 * 1024
                or not 0 < row["archiveBytes"] <= row["canonicalBytes"]
                or not re.fullmatch(r"[a-f0-9]{64}", row["canonicalSha256"])
                or not re.fullmatch(r"[a-f0-9]{64}", row["archiveSha256"])
                or not row["caseCollections"]
                or any(name not in ("cases", "factoryCases", "stepCases") for name in row["caseCollections"])
                or not row["sourcePaths"]
                or any(not isinstance(path, str) or "\\" in path or ":" in path
                       or any(part in ("", ".", "..") for part in path.split("/")) for path in row["sourcePaths"])
                or not isinstance(row["cases"], int) or row["cases"] < 1):
            raise ValueError("Invalid fixture manifest entry")
    if len({row["path"] for row in rows}) != len(rows):
        raise ValueError("Duplicate fixture manifest entry")
    return rows


def fixture_entry(path):
    logical = Path(path).resolve().relative_to(ROOT).as_posix()
    return next((row for row in fixture_entries() if row["path"] == logical), None) or _unknown(logical)


def _unknown(path):
    raise ValueError(f"Unregistered fixture: {path}")


def _verify(data, row, prefix):
    if len(data) != row[prefix + "Bytes"] or hashlib.sha256(data).hexdigest() != row[prefix + "Sha256"]:
        raise ValueError(f"Fixture {prefix} differs from its pin: {row['path']}")


def compress_fixture(data):
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=output, mtime=0) as writer:
        writer.write(data)
    return output.getvalue()


def decode_fixture(archive, row):
    _verify(archive, row, "archive")
    with gzip.GzipFile(fileobj=io.BytesIO(archive), mode="rb") as reader:
        data = reader.read(row["canonicalBytes"] + 1)
    _verify(data, row, "canonical")
    return data


def read_fixture_bytes(path):
    row = fixture_entry(path)
    return decode_fixture((ROOT / row["archive"]).read_bytes(), row)


def read_fixture_text(path):
    # Match the previous Path.read_text universal-newline behavior exactly.
    return read_fixture_bytes(path).decode("utf-8").replace("\r\n", "\n")


def write_fixture_text(path, text):
    row = fixture_entry(path)
    # Retain the original canonical CRLF bytes on every operating system.
    data = text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
    _verify(data, row, "canonical")
    archive = compress_fixture(data)
    _verify(archive, row, "archive")
    (ROOT / row["archive"]).write_bytes(archive)
