"""Pinned, bounded source extraction for the private Route 1 encounter factory."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def mask(text):
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
    return re.sub(pattern, lambda m: ''.join('\n' if c == '\n' else ' ' for c in m[0]), text)


class Extraction:
    def __init__(self):
        self.lock = json.loads((ROOT / 'source-lock.json').read_text(encoding='utf-8-sig'))
        manifest = json.loads((ROOT / self.lock['fingerprint']['manifest']).read_text(encoding='utf-8-sig'))
        self.pinned = {row['path']: row for row in manifest['records']}
        self.reference = Path(self.lock['reference']['localPath'])
        self.inputs, self.fragments = {}, []

    def read(self, path):
        target = (self.reference / path).resolve()
        if not target.is_relative_to(self.reference.resolve()):
            raise ValueError(f'Unsafe source path {path}')
        data = target.read_bytes()
        pin = self.pinned.get(path)
        if pin is None or pin['size'] != len(data) or pin['sha256'] != sha(data):
            raise ValueError(f'Source input differs from pinned snapshot: {path}')
        self.inputs[path] = {'path': path, 'bytes': len(data), 'sha256': sha(data)}
        return data.decode('utf-8-sig')

    def record(self, path, name, kind, start, end, text):
        fragment = text[start:end]
        row = {'source': path, 'name': name, 'kind': kind,
               'startLine': text.count('\n', 0, start) + 1,
               'endLine': text.count('\n', 0, end - 1) + 1,
               'sha256': sha(fragment.encode('utf-8')),
               'transformation': 'none; complete selected source text retained'}
        self.fragments.append(row)
        return f'\n/* SOURCE {path}:{row["startLine"]} {name} */\n{fragment}\n'

    def block(self, path, name, kind='function'):
        text = self.read(path)
        clean = mask(text)
        if kind == 'function':
            pattern = rf'(?m)^[A-Za-z_][^;{{}}\n]*\b{re.escape(name)}\s*\([^;{{}}]*\)\s*\{{'
        elif kind == 'struct':
            pattern = rf'(?m)^struct\s+{re.escape(name)}\s*\{{'
        elif kind == 'table':
            pattern = rf'(?m)^(?:static\s+)?const\s+[^;{{}}\n]*\b{re.escape(name)}\s*(?:\[[^\]]*\]\s*)+\s*=\s*\{{'
        else:
            raise ValueError(f'Unknown extraction kind {kind}')
        matches = list(re.finditer(pattern, clean))
        if len(matches) != 1:
            raise ValueError(f'Expected one source {kind} {name}, got {len(matches)}')
        start, opening = matches[0].start(), clean.index('{', matches[0].start())
        depth, end = 1, opening + 1
        while end < len(clean) and depth:
            depth += (clean[end] == '{') - (clean[end] == '}')
            end += 1
        if depth:
            raise ValueError(f'Unclosed source {kind} {name}')
        if kind != 'function':
            while end < len(clean) and clean[end].isspace():
                end += 1
            if clean[end:end + 1] != ';':
                raise ValueError(f'Missing source terminator {name}')
            end += 1
        return self.record(path, name, kind, start, end, text)

    def macro(self, path, name):
        text = self.read(path)
        matches = list(re.finditer(rf'(?m)^#define\s+{re.escape(name)}(?=[\s(]|$)[^\n]*(?:\n|$)', text))
        if len(matches) != 1:
            raise ValueError(f'Expected one source macro {name}, got {len(matches)}')
        start, end = matches[0].span()
        while text[start:end].rstrip('\r\n').endswith('\\'):
            next_line = text.find('\n', end)
            if next_line < 0:
                raise ValueError(f'Unclosed macro {name}')
            end = next_line + 1
        return self.record(path, name, 'macro', start, end, text)

    def enum_containing(self, path, name):
        text = self.read(path)
        matches = [m for m in re.finditer(r'\benum\s*\{[^{}]+\}\s*;', mask(text))
                   if re.search(rf'\b{re.escape(name)}\b', m[0])]
        if len(matches) != 1:
            raise ValueError(f'Expected one enum containing {name}')
        return self.record(path, name, 'enum', matches[0].start(), matches[0].end(), text)

    def declaration(self, path, name):
        text = self.read(path)
        matches = list(re.finditer(rf'(?m)^const struct \w+ {re.escape(name)} = \{{[^;]+;', text))
        if len(matches) != 1:
            raise ValueError(f'Expected one declaration {name}')
        return self.record(path, name, 'declaration', *matches[0].span(), text)


def extract(out):
    import creature_extract
    out = out.absolute()
    allowed = ROOT / '.local/encounter-core'
    if out.resolve() != out or not out.is_relative_to(allowed):
        raise ValueError('Extraction output must be a nonredirected private encounter build directory')
    if out.exists() and any(p.is_symlink() or p.is_junction() for p in out.rglob('*')):
        raise ValueError('Refusing redirected extraction output')
    source = Extraction()
    out.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'flags', 'vars',
                 'metatile_behaviors', 'hold_effects', 'trainers', 'battle', 'opponents'):
        path = f'include/constants/{name}.h'
        target = out / f'constants/{name}.h'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read(path), encoding='utf-8', newline='\n')
        copied.append({'source': path, 'output': str(target.relative_to(out)).replace('\\', '/'), 'transformation': 'none'})

    defs = []
    for name in ('WildPokemon', 'WildPokemonInfo', 'WildPokemonHeader'):
        defs.append(source.block('include/wild_encounter.h', name, 'struct'))
    defs.append(source.block('src/wild_encounter.c', 'WildEncounterData', 'struct'))
    for name in ('METATILE_ATTRIBUTE_BEHAVIOR', 'TILE_ENCOUNTER_NONE', 'PLAYER_AVATAR_STATE_NORMAL'):
        defs.append(source.enum_containing('include/global.fieldmap.h', name))
    defs.append(source.enum_containing('src/wild_encounter.c', 'WILD_AREA_LAND'))
    macros = {
        'include/gba/defines.h': ('TRUE', 'FALSE'),
        'include/global.h': ('ARRAY_COUNT', 'HIHALF', 'LOHALF', 'min', 'max'),
        'include/random.h': ('RAND_MULT', 'ISO_RANDOMIZE1', 'ISO_RANDOMIZE2'),
        'include/wild_encounter.h': ('LAND_WILD_COUNT',),
        'include/global.fieldmap.h': ('PLAYER_AVATAR_FLAG_MACH_BIKE', 'PLAYER_AVATAR_FLAG_ACRO_BIKE', 'PLAYER_AVATAR_FLAG_SURFING'),
        'src/wild_encounter.c': ('MAX_ENCOUNTER_RATE', 'HEADER_NONE', 'WILD_CHECK_REPEL'),
        'src/data/wild_encounters.h': tuple(f'ENCOUNTER_CHANCE_LAND_MONS_SLOT_{i}' for i in range(12)) + ('ENCOUNTER_CHANCE_LAND_MONS_TOTAL',),
    }
    for path, names in macros.items():
        defs.extend(source.macro(path, name) for name in names)
    for name in ('sMetatileAttrMasks', 'sMetatileAttrShifts'):
        defs.append(source.block('src/fieldmap.c', name, 'table'))
    defs.append(source.block('src/data/wild_encounters.h', 'sRoute1_FireRed_LandMons', 'table'))
    defs.append(source.declaration('src/data/wild_encounters.h', 'sRoute1_FireRed_LandMonsInfo'))
    # Check the source-generated C table against its canonical pinned JSON input.
    table = json.loads(source.read('src/data/wild_encounters.json'))
    route = [row for group in table['wild_encounter_groups'] for row in group.get('encounters', [])
             if row.get('base_label') == 'sRoute1_FireRed']
    if len(route) != 1:
        raise ValueError('Expected unique FireRed Route 1 encounter table')
    c_table = defs[-2]
    c_rows = [(int(lo), int(hi), species) for lo, hi, species in re.findall(r'\{\s*(\d+),\s*(\d+),\s*(SPECIES_\w+)\s*\}', c_table)]
    j_rows = [(row['min_level'], row['max_level'], row['species']) for row in route[0]['land_mons']['mons']]
    if c_rows != j_rows or len(c_rows) != 12 or route[0]['land_mons']['encounter_rate'] != 21:
        raise ValueError('Pinned generated C Route 1 table differs from canonical JSON')
    (out / 'encounter_defs.h').write_text(''.join(defs), encoding='utf-8', newline='\n')

    random = ['#define Random SourceRandom\n', source.block('src/random.c', 'Random'), '#undef Random\n',
              '#define WildEncounterRandom SourceWildEncounterRandom\n',
              source.block('src/wild_encounter.c', 'WildEncounterRandom'), '#undef WildEncounterRandom\n']
    (out / 'source_random.inc').write_text(''.join(random), encoding='utf-8', newline='\n')
    # Read-only evidence for excluded environment paths and explicit portable Random32 ordering.
    for path, name in (('include/random.h', 'Random32'),):
        source.macro(path, name)
        source.fragments[-1]['kind'] = 'evidence-not-compiled'
    for path, name in (('src/roamer.c', 'TryStartRoamerEncounter'), ('src/roamer.c', 'IsRoamerAt'),
                       ('src/field_control_avatar.c', 'CheckStandardWildEncounter'),
                       ('src/battle_setup.c', 'StartWildBattle'),
                       ('src/battle_setup.c', 'DoStandardWildBattle'),
                       ('src/battle_main.c', 'CB2_InitBattleInternal'),
                       ('src/wild_encounter.c', 'GenerateWildMon')):
        source.block(path, name)
        source.fragments[-1]['kind'] = 'evidence-not-compiled'

    functions = ['ChooseWildMonIndex_Land', 'ChooseWildMonLevel', 'TryGenerateWildMon',
                 'DoWildEncounterRateDiceRoll', 'DoWildEncounterRateTest', 'GetAbilityEncounterRateModType',
                 'DoGlobalWildEncounterDiceRoll', 'StandardWildEncounter', 'IsWildLevelAllowedByRepel',
                 'ApplyFluteEncounterRateMod', 'GetFluteEncounterRateModType',
                 'ApplyCleanseTagEncounterRateMod', 'IsLeadMonHoldingCleanseTag', 'SeedWildEncounterRng',
                 'GetMapBaseEncounterCooldown', 'ResetEncounterRateModifiers',
                 'HandleWildEncounterCooldown', 'TryStandardWildEncounter', 'AddToWildEncounterRateBuff']
    parts = [source.block('src/fieldmap.c', 'ExtractMetatileAttribute')]
    parts.extend(source.block('src/wild_encounter.c', name) for name in functions)
    (out / 'encounter_source.inc').write_text(''.join(parts), encoding='utf-8', newline='\n')
    (out / 'creature_source.inc').write_text(creature_extract.generate(source), encoding='utf-8', newline='\n')

    adapters = []
    for path in sorted((ROOT / 'tools/encounter-core/c').glob('*')):
        if path.is_file():
            data = path.read_bytes()
            (out / path.name).write_bytes(data)
            adapters.append({'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha(data), 'bytes': len(data)})
    scripts = [{'path': f'tools/encounter-core/{name}', 'sha256': sha((ROOT / 'tools/encounter-core' / name).read_bytes())}
               for name in ('build.py', 'extract.py', 'creature_extract.py')]
    outputs = [{'path': str(path.relative_to(out)).replace('\\', '/'), 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
               for path in sorted(out.rglob('*')) if path.is_file() and path.name != 'extraction-manifest.json']
    manifest = {'schemaVersion': 1, 'profile': 'firered-route1-encounter-v1',
                'sourceFingerprint': source.lock['fingerprint']['value'], 'upstreamCommit': None,
                'selectedBuild': source.lock['selectedBuild'], 'inputs': sorted(source.inputs.values(), key=lambda r: r['path']),
                'fragments': source.fragments, 'copiedHeaders': copied, 'adapters': adapters,
                'buildScripts': scripts, 'outputs': outputs,
                'boundary': 'Route 1 standard land check through wild identity/stat/move creation and held-item setup; no battle initialization or gameplay persistence',
                'adaptations': [
                    'Random and WildEncounterRandom bodies retained behind counted wrappers; logical state contains both streams and draw counters.',
                    'Random32 explicitly sequences the low-half draw first and casts high half unsigned; pinned compiler/fixtures bind this portable adaptation. Original-ROM evaluation order is not verified.',
                    'Environment is fixed to Route 1, walking/running on foot, no Repel/flutes/held lead item/roamer; Squirtle Torrent lead. Unsupported requests fail before source execution.',
                    'Source Pokemon encryption/storage/controllers are projected into private logical creature fields; creature adapter records its bounded accessors.',
                    'Direct generation enters at TryGenerateWildMon, then resets cooldown as an encounter boundary; it bypasses step eligibility explicitly.',
                ]}
    (out / 'extraction-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    extract(args.out)
