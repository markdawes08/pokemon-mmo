"""Install the pinned optional P03 compiler inside the workspace only."""
from __future__ import annotations

import hashlib
import json
import platform
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    if platform.system() != 'Windows' or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise RuntimeError('The optional battle compiler bootstrap currently supports Windows x64 only.')
    lock = json.loads((ROOT / 'tools/battle-spike/toolchain-lock.json').read_text(encoding='utf-8'))
    parent = ROOT / '.tools'
    parent.mkdir(exist_ok=True)
    if parent.resolve() != parent:
        raise RuntimeError('Refusing a redirected toolchain directory.')
    archive = parent / (lock['directory'] + '.zip')
    if not archive.exists() or archive.stat().st_size != lock['bytes'] or digest(archive) != lock['sha256']:
        temporary = archive.with_suffix('.zip.part')
        print('Downloading the pinned optional battle compiler...', flush=True)
        with urllib.request.urlopen(lock['url'], timeout=60) as response, temporary.open('wb') as target:
            shutil.copyfileobj(response, target)
        if temporary.stat().st_size != lock['bytes'] or digest(temporary) != lock['sha256']:
            raise RuntimeError('Compiler archive does not match its pinned official size/SHA256.')
        temporary.replace(archive)
    target = parent / lock['directory']
    receipt = target / '.pokewaterblue-toolchain.json'
    executable = target / lock['executable']
    if target.exists():
        if target.resolve() != target or not receipt.is_file():
            raise RuntimeError('Existing compiler directory is redirected or lacks a verified receipt; preserve it and inspect manually.')
        prior = json.loads(receipt.read_text(encoding='utf-8'))
        if prior['archiveSha256'] != lock['sha256'] or digest(executable) != prior['executableSha256']:
            raise RuntimeError('Existing compiler differs from its verified receipt.')
    else:
        print('Verified archive SHA256; extracting locally...', flush=True)
        with zipfile.ZipFile(archive) as source:
            for entry in source.infolist():
                parts = PurePosixPath(entry.filename).parts
                if not parts or parts[0] != lock['directory'] or '..' in parts or '\\' in entry.filename or PurePosixPath(entry.filename).is_absolute():
                    raise RuntimeError('Unsafe compiler archive path.')
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise RuntimeError('Compiler archive contains an unsupported symlink.')
            source.extractall(parent)
        receipt.write_text(json.dumps({'archiveSha256': lock['sha256'], 'executableSha256': digest(executable)}, indent=2) + '\n', encoding='utf-8')
    result = subprocess.run([str(executable), 'version'], cwd=ROOT, capture_output=True, text=True, check=True)
    if result.stdout.strip() != lock['version']:
        raise RuntimeError('Unexpected compiler version after setup.')
    print(json.dumps({'status': 'ready', 'tool': 'zig', 'version': lock['version'], 'path': str(executable.relative_to(ROOT)), 'archiveSha256': lock['sha256']}))


if __name__ == '__main__':
    main()
