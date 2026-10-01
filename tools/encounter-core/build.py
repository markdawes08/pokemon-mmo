"""Build two private source encounter modules using the existing pinned compiler."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
EXPORTS = ['encounter_abi_version', 'encounter_reset', 'encounter_step', 'encounter_generate',
           'encounter_state_word_count', 'encounter_state_get', 'encounter_creature_get',
           'encounter_import_begin', 'encounter_import_set', 'encounter_import_commit']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def safe_directory(path):
    if path.resolve() != path or not path.is_relative_to(ROOT / '.local/encounter-core'):
        raise RuntimeError('Refusing redirected or outside-scope encounter output')
    path.mkdir(parents=True, exist_ok=True)
    if any(p.is_symlink() or p.is_junction() for p in path.rglob('*')):
        raise RuntimeError('Refusing redirected paths inside encounter output')


def main():
    lock = read(ROOT / 'tools/battle-spike/toolchain-lock.json')
    compiler_dir = ROOT / '.tools' / lock['directory']
    compiler = compiler_dir / lock['executable']
    receipt_path = compiler_dir / '.pokewaterblue-toolchain.json'
    if not compiler.is_file() or not receipt_path.is_file():
        raise RuntimeError('Missing pinned compiler; run npm.cmd run battle:setup before encounter:check')
    if compiler_dir.resolve() != compiler_dir:
        raise RuntimeError('Redirected compiler directory unsupported')
    receipt = read(receipt_path)
    if receipt['archiveSha256'] != lock['sha256'] or digest(compiler) != receipt['executableSha256']:
        raise RuntimeError('Compiler differs from its verified receipt')
    version = subprocess.run([str(compiler), 'version'], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    if version != lock['version']:
        raise RuntimeError('Compiler version differs from pinned toolchain')
    work = ROOT / '.local/encounter-core'
    safe_directory(work)
    outputs = []
    for name in ('primary', 'rebuild'):
        directory = work / name
        safe_directory(directory)
        extracted = directory / 'extracted'
        safe_directory(extracted)
        subprocess.run([sys.executable, str(ROOT / 'tools/encounter-core/extract.py'), '--out', str(extracted)], cwd=ROOT, check=True)
        wasm = directory / 'encounter.wasm'
        args = ['cc', '-target', 'wasm32-freestanding', '-std=c11', '-O2', '-g0', '-nostdlib',
                '-fno-strict-aliasing', '-Werror=implicit-function-declaration', '-Werror=incompatible-pointer-types',
                '-Wl,--no-entry', '-Wl,-z,stack-size=65536', '-Wl,--initial-memory=262144', '-Wl,--max-memory=262144']
        args += ['-Wl,--export=' + symbol for symbol in EXPORTS]
        args += ['-I', str(extracted), str(extracted / 'encounter.c'), '-o', str(wasm)]
        result = subprocess.run([str(compiler), *args], cwd=ROOT, text=True, capture_output=True)
        (directory / 'compiler-diagnostics.txt').write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            print(result.stdout + result.stderr, file=sys.stderr)
            raise RuntimeError(f'Encounter C compilation failed; see {directory.relative_to(ROOT)}/compiler-diagnostics.txt')
        outputs.append({'wasmSha256': digest(wasm), 'extraction': read(extracted / 'extraction-manifest.json')})
    if outputs[0] != outputs[1]:
        raise RuntimeError('Independent encounter extraction/build differs; preserve outputs and inspect')
    report = {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'scope': 'Private source Route 1 encounter factory only; no live encounter, battle, or durable admission',
              'toolchain': {**lock, 'executableSha256': receipt['executableSha256']},
              'target': 'wasm32-freestanding', 'optimization': '-O2', 'debugInfo': False, 'stackBytes': 65536,
              'abiVersion': 1, 'checkpointWords': 44, 'exports': EXPORTS, 'importsExpected': [],
              'fixedLinearMemoryBytes': 262144, 'independentBuilds': 2,
              'wasm': '.local/encounter-core/primary/encounter.wasm',
              'wasmBytes': (work / 'primary/encounter.wasm').stat().st_size,
              'wasmSha256': outputs[0]['wasmSha256'], 'extraction': outputs[0]['extraction']}
    (ROOT / 'reports/encounter-core-build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: report[key] for key in ('status', 'wasmBytes', 'wasmSha256', 'independentBuilds')}))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
