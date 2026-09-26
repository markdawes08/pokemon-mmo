"""Build two independent copies of the bounded source probe and compare bytes."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
EXPORTS = ['spike_abi_version', 'spike_reset', 'spike_set_battler', 'spike_set_stage', 'spike_set_capabilities',
           'spike_damage', 'spike_get_result', 'spike_get_rng', 'spike_rng_next', 'spike_get_event',
           'spike_get_battler', 'spike_battle_mon_size',
           'spike2_set_status', 'spike2_set_speed', 'spike2_set_move', 'spike2_set_stage', 'spike2_get_stage',
           'spike2_get_move', 'spike2_begin_turn', 'spike2_order', 'spike2_residual_order', 'spike2_attack',
           'spike2_switch_cleanup', 'spike2_faint_cleanup', 'spike2_residual', 'spike2_check_teams_lost',
           'spike2_get_outcome', 'spike2_set_party', 'spike2_get_party',
           'spike3_checkpoint_version', 'spike3_checkpoint_word_count', 'spike3_checkpoint_export',
           'spike3_checkpoint_get', 'spike3_import_begin', 'spike3_import_set', 'spike3_import_commit',
           'spike3_get_rng_draws']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    lock = read(ROOT / 'tools/battle-spike/toolchain-lock.json')
    compiler_dir = ROOT / '.tools' / lock['directory']
    compiler = compiler_dir / lock['executable']
    receipt_path = compiler_dir / '.pokewaterblue-toolchain.json'
    if not compiler.is_file() or not receipt_path.is_file():
        raise RuntimeError('Missing optional battle compiler. Run npm.cmd run battle:setup, then retry.')
    if compiler_dir.resolve() != compiler_dir:
        raise RuntimeError('Redirected battle compiler directory is unsupported.')
    receipt = read(receipt_path)
    if receipt['archiveSha256'] != lock['sha256'] or digest(compiler) != receipt['executableSha256']:
        raise RuntimeError('Battle compiler differs from its verified receipt.')
    version = subprocess.run([str(compiler), 'version'], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    if version != lock['version']:
        raise RuntimeError('Battle compiler version does not match the lock.')
    work = ROOT / '.local/battle-spike'
    work.mkdir(parents=True, exist_ok=True)
    if work.resolve() != work:
        raise RuntimeError('Refusing redirected battle experiment output.')
    outputs = []
    for name in ('primary', 'rebuild'):
        directory = work / name
        directory.mkdir(exist_ok=True)
        if directory.resolve() != directory:
            raise RuntimeError('Refusing redirected build directory.')
        extracted = directory / 'extracted'
        if extracted.resolve() != extracted:
            raise RuntimeError('Refusing redirected extraction output.')
        if extracted.exists() and any(path.is_symlink() or path.is_junction() for path in extracted.rglob('*')):
            raise RuntimeError('Refusing redirected paths within extraction output.')
        subprocess.run([sys.executable, str(ROOT / 'tools/battle-spike/extract.py'), '--out', str(extracted)], cwd=ROOT, check=True)
        manifest = read(extracted / 'extraction-manifest.json')
        wasm = directory / 'probe.wasm'
        args = ['cc', '-target', 'wasm32-freestanding', '-std=c11', '-O2', '-g0', '-nostdlib',
                '-fno-strict-aliasing', '-Werror=implicit-function-declaration', '-Werror=incompatible-pointer-types',
                '-Wl,--no-entry', '-Wl,-z,stack-size=65536', '-Wl,--initial-memory=262144', '-Wl,--max-memory=262144']
        args += ['-Wl,--export=' + symbol for symbol in EXPORTS]
        args += ['-I', str(extracted), str(extracted / 'battle_spike.c'), '-o', str(wasm)]
        result = subprocess.run([str(compiler), *args], cwd=ROOT, text=True, capture_output=True)
        (directory / 'compiler-diagnostics.txt').write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            print(result.stdout + result.stderr, file=sys.stderr)
            raise RuntimeError(f'Battle C compilation failed; see {directory.relative_to(ROOT)}/compiler-diagnostics.txt')
        outputs.append({'wasmSha256': digest(wasm), 'extraction': manifest})
    if outputs[0] != outputs[1]:
        raise RuntimeError('Independent battle extraction/compilation differs; preserve both outputs and inspect.')
    report = {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'scope': 'P03 batch 3 restricted source turns and portable logical checkpoints; not a complete source battle engine',
        'toolchain': {**lock, 'executableSha256': receipt['executableSha256']},
        'target': 'wasm32-freestanding', 'optimization': '-O2', 'debugInfo': False, 'stackBytes': 65536,
        'abiVersion': 1, 'exports': EXPORTS,
        'fixedLinearMemoryBytes': 262144, 'importsExpected': [], 'independentBuilds': 2,
        'wasm': '.local/battle-spike/primary/probe.wasm',
        'wasmBytes': (work / 'primary/probe.wasm').stat().st_size,
        'wasmSha256': outputs[0]['wasmSha256'], 'extraction': outputs[0]['extraction'],
    }
    (ROOT / 'reports/battle-spike-build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'wasmBytes', 'wasmSha256', 'independentBuilds')}))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
