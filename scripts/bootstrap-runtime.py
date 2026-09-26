"""Install a checksum-verified, project-local Node runtime (no system changes)."""
from pathlib import Path
import hashlib
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "24.21.0"
name = f"node-v{VERSION}-win-x64.zip"
base = f"https://nodejs.org/dist/v{VERSION}/"
target = ROOT / ".tools" / f"node-v{VERSION}-win-x64"
cache = ROOT / ".tools" / "downloads"
cache.mkdir(parents=True, exist_ok=True)
checksums = urllib.request.urlopen(base + "SHASUMS256.txt").read().decode()
expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == name)
archive = cache / name
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    urllib.request.urlretrieve(base + name, archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit("Node download checksum mismatch")
if not (target / "node.exe").exists():
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(ROOT / ".tools")
(ROOT / ".tools" / "node-runtime.json").write_text(json.dumps({
    "version": VERSION, "url": base + name, "sha256": expected,
    "executable": str((target / "node.exe").relative_to(ROOT)).replace("\\", "/")
}, indent=2) + "\n")
print(f"Verified Node {VERSION}: {target / 'node.exe'}")
