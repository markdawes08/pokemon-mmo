"""Pinned source evolution continuation; all previous modules remain untouched."""
from __future__ import annotations
import argparse
import ast
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'tools/battle-spike'
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('battle_source_extract', BASE / 'extract.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
SPECIES = [('Squirtle', 7), ('Wartortle', 8), ('Blastoise', 9), ('Pidgey', 16),
           ('Pidgeotto', 17), ('Pidgeot', 18), ('Rattata', 19), ('Raticate', 20)]


def extract(out):
    if out.resolve() != out or not out.is_relative_to(ROOT / '.local/battle-evolution'):
        raise ValueError('Evolution extraction must remain private')
    out.mkdir(parents=True, exist_ok=True)
    source = base.Extraction()
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'hold_effects', 'battle', 'game_stat', 'pokedex'):
        target = out / 'constants' / (name + '.h'); target.parent.mkdir(exist_ok=True)
        target.write_text(source.read(f'include/constants/{name}.h'), encoding='utf-8', newline='\n')
    (out / 'characters.h').write_text(source.read('include/characters.h'), encoding='utf-8', newline='\n')
    decl = [source.block('include/pokemon.h', 'SpeciesInfo', 'struct'), source.block('include/pokemon.h', 'Evolution', 'struct'),
            source.enum_containing('include/pokedex.h', 'FLAG_GET_SEEN')]
    for path, names in {'include/gba/defines.h': ('TRUE', 'FALSE'), 'include/global.h': ('min', 'ARRAY_COUNT', 'NELEMS'),
                        'src/pokemon.c': ('PP_UP_SHIFTS', 'PP_UP_SHIFTS_INV', 'CALC_STAT', 'SPECIES_TO_NATIONAL', 'HM_MOVES_END'),
                        'src/data/pokemon/species_info.h': ('PERCENT_FEMALE',),
                        'src/data/pokemon/level_up_learnsets.h': ('LEVEL_UP_MOVE', 'LEVEL_UP_END'),
                        'src/evolution_scene.c': ('tPreEvoSpecies', 'tPostEvoSpecies')}.items():
        for name in names: decl.append(source.macro(path, name))
    text = source.read('src/data/pokemon/species_info.h'); decl.append('static const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES]={\n')
    for name, _ in SPECIES:
        start = text.index('    [SPECIES_' + name.upper() + '] ='); end = text.index('\n    [', start + 1)
        decl.append(source.record('src/data/pokemon/species_info.h', name, 'complete-table-entry', start, end, text))
    decl.append('};\n'); decl.append(source.read('src/data/pokemon/experience_tables.h'))
    for name in ('sNatureStatTable', 'gPPUpGetMask', 'gPPUpClearMask', 'sSpeciesToNationalPokedexNum', 'sHMMoves'):
        decl.append(source.block('src/pokemon.c', name, 'table'))
    moves = set()
    for name, _ in SPECIES:
        block = source.block('src/data/pokemon/level_up_learnsets.h', 's' + name + 'LevelUpLearnset', 'table')
        moves.update(re.findall(r'LEVEL_UP_MOVE\(\s*\d+,\s*MOVE_(\w+)\)', block)); decl.append(block)
    decl.append('static const u16 *const gLevelUpLearnsets[NUM_SPECIES]={\n')
    decl += ['[SPECIES_' + name.upper() + ']=s' + name + 'LevelUpLearnset,\n' for name, _ in SPECIES]
    decl.append('};\nstatic const struct Evolution gEvolutionTable[NUM_SPECIES][EVOS_PER_MON]={\n')
    text = source.read('src/data/pokemon/evolution.h')
    for name in ('SQUIRTLE', 'WARTORTLE', 'PIDGEY', 'PIDGEOTTO', 'RATTATA'):
        start = text.index('    [SPECIES_' + name + ']'); end = text.index('\n', start)
        decl.append(source.record('src/data/pokemon/evolution.h', name, 'complete-table-entry', start, end, text))
    decl.append('};\nstatic const struct {u8 pp;} gBattleMoves[MOVES_COUNT]={\n')
    text = source.read('src/data/battle_moves.h')
    for name in sorted(moves):
        start = text.index('    [MOVE_' + name + '] ='); end = text.index('\n    [', start + 1)
        field = re.search(r'        \.pp = [^,]+,', text[start:end])
        if field is None: raise ValueError('Missing source PP')
        decl += ['[MOVE_' + name + ']={\n', source.record('src/data/battle_moves.h', name + '.pp', 'selected-field', start + field.start(), start + field.end(), text), '},\n']
    decl.append('};\nstatic const struct {u8 holdEffect;} gItems[ITEMS_COUNT]={\n')
    text = source.read('src/data/items.h')
    for name in ('NONE', 'EVERSTONE'):
        start = text.index('.itemId = ITEM_' + name + ','); end = text.index('}', start)
        field = re.search(r'        \.holdEffect = [^,]+,', text[start:end])
        if field is None: raise ValueError('Missing source hold effect')
        decl += ['[ITEM_' + name + ']={\n', source.record('src/data/items.h', name + '.holdEffect', 'selected-field', start + field.start(), start + field.end(), text), '},\n']
    decl.append('};\n')

    charmap = {}
    for line in source.read('charmap.txt').splitlines():
        match = re.match(r"^('(?:\\.|[^'])*')\s*=\s*([0-9A-F]{2})\s*$", line)
        if match: charmap[ast.literal_eval(match[1])] = int(match[2], 16)
    keyboard = source.block('src/naming_screen.c', 'sKeyboardChars', 'table')
    allowed = set(''.join(json.loads('"' + value + '"') for value in re.findall(r'__\("((?:\\.|[^"\\])*)"\)', keyboard)))
    if not allowed or any(char not in charmap for char in allowed): raise ValueError('Unresolved source keyboard glyph')
    codec = {'eos': 255, 'nicknameLength': 10, 'trainerNameLength': 7,
             'characters': [{'text': char, 'byte': charmap[char]} for char in sorted(allowed)], 'speciesNames': {}}
    decl.append('static const u8 sAllowedNameByte[256]={' + ','.join(f'[{value}]=1' for value in sorted({charmap[c] for c in allowed})) + '};\n')
    text = source.read('src/data/text/species_names.h'); decl.append('static const u8 gSpeciesNames[NUM_SPECIES][POKEMON_NAME_LENGTH+1]={\n')
    for name, number in SPECIES:
        match = re.search(r'    \[SPECIES_' + name.upper() + r'\] = _\("([^"\\]+)"\),', text)
        if not match: raise ValueError('Missing species name')
        source.record('src/data/text/species_names.h', name, 'source-charmap-encoded-name', match.start(), match.end(), text)
        source.fragments[-1]['transformation'] = 'Pinned one-byte charmap; canonical EOS padding replaces unused string storage.'
        codec['speciesNames'][str(number)] = match[1]
        data = [charmap[c] for c in match[1]] + [255] * (11 - len(match[1]))
        decl.append('[SPECIES_' + name.upper() + ']={' + ','.join(map(str, data)) + '},\n')
    decl.append('};\n')
    (out / 'codec.json').write_text(json.dumps(codec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    (out / 'source_data.inc').write_text(''.join(decl), encoding='utf-8', newline='\n')
    funcs = []
    for path, names in {
        'src/pokemon.c': ('CalculateMonStats', 'GetLevelFromMonExp', 'GetLevelFromBoxMonExp', 'GetNature', 'GetNatureFromPersonality',
            'ModifyStatByNature', 'GiveMoveToMon', 'GiveMoveToBoxMon', 'MonTryLearningNewMove', 'RemoveMonPPBonus', 'SetMonMoveSlot',
            'GetAbilityBySpecies', 'GetMonAbility', 'GetMonGender', 'GetBoxMonGender', 'CalculatePPWithBonus', 'GetEvolutionTargetSpecies',
            'EvolutionRenameMon', 'SpeciesToNationalPokedexNum', 'IsHMMove2'),
        'src/item.c': ('SanitizeItemId', 'ItemId_GetHoldEffect'),
        'src/pokedex_screen.c': ('DexScreen_GetSetPokedexFlag',), 'src/pokedex.c': ('GetSetPokedexFlag',),
        'src/overworld.c': ('IncrementGameStat', 'GetGameStat', 'SetGameStat'), 'src/string_util.c': ('StringCompare',),
    }.items():
        for name in names: funcs.append(source.block(path, name, 'function'))
    text = source.read('src/evolution_scene.c')
    start = text.index('            SetMonData(mon, MON_DATA_SPECIES', text.index('case EVOSTATE_SET_MON_EVOLVED:'))
    end = text.index('\n', text.index('            IncrementGameStat(GAME_STAT_EVOLVED_POKEMON);', start))
    body = source.record('src/evolution_scene.c', 'EVOSTATE_SET_MON_EVOLVED:mechanical-effects', 'selected-statements', start, end, text)
    funcs.append('static void SourceEvolve(struct Pokemon *mon){u8 taskId=0;\n' + body + '\n}\n')
    (out / 'source_functions.inc').write_text(''.join(funcs), encoding='utf-8', newline='\n')
    evidence = []
    for path, names in {'src/evolution_scene.c': ('EvolutionScene', 'Task_EvolutionScene', 'CreateShedinja'),
                        'src/battle_main.c': ('FreeResetData_ReturnToOvOrDoEvolutions', 'TryEvolvePokemon')}.items():
        for name in names:
            evidence.append(source.block(path, name, 'function')); source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    evidence.append(source.read('src/evolution_graphics.c'))
    (out / 'source_evidence.txt').write_text('\n'.join(evidence), encoding='utf-8', newline='\n')
    for path in sorted((ROOT / 'tools/battle-evolution/c').glob('*')): (out / path.name).write_bytes(path.read_bytes())
    report = {'schemaVersion': 1, 'profile': 'firered-route1-evolution-v1', 'sourceFingerprint': source.lock['fingerprint']['value'],
              'inputs': [source.inputs[k] for k in sorted(source.inputs)], 'fragments': source.fragments,
              'transformations': [
                  'Separate private evolution continuation; six prior modules remain byte-identical.',
                  'Named scalar Pokemon fields and exact English nickname bytes replace encrypted source save structures; no source-save binary compatibility.',
                  'Source normal target query retains Everstone. Eight species admit five level evolutions and one scene only; the battle party bit is not reintroduced.',
                  'Complete numerical/learning/rename/dex/stat functions and exact evolved-state statements run without graphical callbacks, text waits, or presentation Random calls.',
                  'Accept/cancel and replacement/decline decisions replace scene input. Cancel still executes one old-species MonTryLearningNewMove before the source stopped guard.',
                  'The source learning cursor and first-call flag survive every boundary; no level cap, move suppression, or chained evolution is introduced.',
                  'Status is opaque carried u32 metadata, not implemented status mechanics. Foreign languages, HM/TM moves, non-level evolution families, and other held items are rejected.',
                  'Target-only dex mirrors and saturated evolution statistic are explicit context projections; result remains pending trusted ownership application.',
                  'No admitted mechanical function consumes RNG; presentation RNG is deliberately omitted, not claimed equivalent to a ROM frame timeline.']}
    report['outputs'] = [{'path': str(p.relative_to(out)).replace('\\', '/'), 'bytes': p.stat().st_size, 'sha256': base.sha(p.read_bytes())}
                         for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'extraction-manifest.json']
    report['buildScripts'] = [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': base.sha(p.read_bytes())}
                              for p in (BASE / 'extract.py', Path(__file__), Path(__file__).with_name('build.py'))]
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--out', required=True, type=Path)
    extract(parser.parse_args().out.absolute())
