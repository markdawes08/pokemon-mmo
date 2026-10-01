"""Compile the separately versioned real-team profile from the shared C engine."""
from __future__ import annotations
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('shared_battle_build', ROOT / 'tools/battle-spike/build.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
EXPORTS = base.EXPORTS + ['family_'+name for name in ('choose_wild','run','get')] + ['party_'+name for name in ('input_word_count','input_begin','input_set','input_commit','mon_get','start','sync','order','switch','replacement_begin','replacement_decide','residual_order','faint_cleanup','get','roster_get')]


def main():
    lock = base.read(ROOT / 'tools/battle-spike/toolchain-lock.json')
    compiler_dir = ROOT / '.tools' / lock['directory']
    compiler = compiler_dir / lock['executable']
    receipt = base.read(compiler_dir / '.pokewaterblue-toolchain.json')
    if compiler_dir.resolve() != compiler_dir or receipt['archiveSha256'] != lock['sha256'] or base.digest(compiler) != receipt['executableSha256']:
        raise RuntimeError('Battle compiler differs from the pinned receipt')
    version = subprocess.run([str(compiler), 'version'], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    if version != lock['version']: raise RuntimeError('Unexpected compiler version')
    work = ROOT / '.local/battle-party'
    outputs = []
    for name in ('primary', 'rebuild'):
        directory = work / name
        if directory.resolve() != directory: raise RuntimeError('Redirected private build directory')
        directory.mkdir(parents=True, exist_ok=True)
        if any(p.is_symlink() or p.is_junction() for p in directory.rglob('*')): raise RuntimeError('Redirected private build output')
        extracted = directory / 'extracted'
        subprocess.run([sys.executable, str(ROOT / 'tools/battle-party/extract.py'), '--out', str(extracted)], cwd=ROOT, check=True)
        wasm = directory / 'party.wasm'
        args = ['cc', '-target', 'wasm32-freestanding', '-std=c11', '-O2', '-g0', '-nostdlib',
                '-fno-strict-aliasing', '-Werror=implicit-function-declaration', '-Werror=incompatible-pointer-types',
                '-Wl,--no-entry', '-Wl,-z,stack-size=65536', '-Wl,--initial-memory=262144', '-Wl,--max-memory=262144']
        args += ['-Wl,--export=' + name for name in EXPORTS]
        args += ['-I', str(extracted), str(extracted / 'battle_spike.c'), str(extracted / 'creature.c'), '-o', str(wasm)]
        result = subprocess.run([str(compiler), *args], cwd=ROOT, text=True, capture_output=True)
        (directory / 'compiler-diagnostics.txt').write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            print(result.stdout + result.stderr, file=sys.stderr)
            raise RuntimeError('Real-team battle compilation failed')
        outputs.append({'wasmSha256': base.digest(wasm), 'extraction': base.read(extracted / 'extraction-manifest.json')})
    if outputs[0] != outputs[1]: raise RuntimeError('Independent real-team battle builds differ')
    report = {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'profile': 'firered-family-party-v1', 'scope': 'Private source mechanics; not live battle or persistence',
              'toolchain': {**lock, 'executableSha256': receipt['executableSha256']}, 'target': 'wasm32-freestanding',
              'abiVersion': 1, 'checkpointVersion': 5, 'checkpointWords': 512, 'exports': EXPORTS,
              'fixedLinearMemoryBytes': 262144, 'importsExpected': [], 'independentBuilds': 2,
              'wasm': '.local/battle-party/primary/party.wasm', 'wasmBytes': (work / 'primary/party.wasm').stat().st_size,
              'wasmSha256': outputs[0]['wasmSha256'], 'extraction': outputs[0]['extraction']}
    (ROOT / 'reports/battle-party-build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: report[k] for k in ('status', 'wasmBytes', 'wasmSha256', 'independentBuilds')}))


if __name__ == '__main__':
    try: main()
    except (RuntimeError, subprocess.CalledProcessError) as error: raise SystemExit(str(error)) from error
