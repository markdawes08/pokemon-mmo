"""Pinned, private source capture continuation and exact English input codec."""
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


def extract(out):
    if out.resolve() != out or not out.is_relative_to(ROOT / '.local/battle-capture'):
        raise ValueError('Capture extraction must remain private')
    out.mkdir(parents=True, exist_ok=True)
    source = base.Extraction()
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'hold_effects', 'battle',
                 'flags', 'vars', 'game_stat', 'pokedex', 'region_map_sections', 'trainers', 'opponents'):
        target = out / 'constants' / (name + '.h'); target.parent.mkdir(exist_ok=True)
        target.write_text(source.read(f'include/constants/{name}.h'), encoding='utf-8', newline='\n')
    (out / 'characters.h').write_text(source.read('include/characters.h'), encoding='utf-8', newline='\n')
    decl = [source.block('include/pokemon.h', 'SpeciesInfo', 'struct'), source.enum_containing('include/pokedex.h', 'FLAG_GET_SEEN')]
    for path, names in {'include/gba/defines.h': ('TRUE', 'FALSE'), 'include/global.h': ('min', 'ARRAY_COUNT', 'NELEMS'),
                        'src/pokemon.c': ('PP_UP_SHIFTS', 'CALC_STAT', 'SPECIES_TO_NATIONAL'),
                        'src/data/pokemon/species_info.h': ('PERCENT_FEMALE',),
                        'src/data/pokemon/level_up_learnsets.h': ('LEVEL_UP_MOVE', 'LEVEL_UP_END'),
                        'include/pokemon_storage_system.h': ('TOTAL_BOXES_COUNT', 'IN_BOX_ROWS', 'IN_BOX_COLUMNS', 'IN_BOX_COUNT')}.items():
        for name in names: decl.append(source.macro(path, name))
    text = source.read('include/config.h'); start = text.index('#if defined(FIRERED)'); end = text.index('#endif', start) + 6
    decl.append(source.record('include/config.h', 'selected-game-version', 'macro-conditional', start, end, text))
    text = source.read('src/data/pokemon/species_info.h'); decl.append('static const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES]={\n')
    for name in ('PIDGEY', 'RATTATA'):
        start = text.index('    [SPECIES_' + name + '] ='); end = text.index('\n    [', start + 1)
        decl.append(source.record('src/data/pokemon/species_info.h', name, 'complete-table-entry', start, end, text))
    decl.append('};\n'); decl.append(source.read('src/data/pokemon/experience_tables.h'))
    for name in ('sNatureStatTable', 'gPPUpGetMask', 'sSpeciesToNationalPokedexNum'): decl.append(source.block('src/pokemon.c', name, 'table'))
    for name in ('Pidgey', 'Rattata'): decl.append(source.block('src/data/pokemon/level_up_learnsets.h', 's' + name + 'LevelUpLearnset', 'table'))
    decl.append('static const u16 *const gLevelUpLearnsets[NUM_SPECIES]={[SPECIES_PIDGEY]=sPidgeyLevelUpLearnset,[SPECIES_RATTATA]=sRattataLevelUpLearnset};\n')
    text = source.read('src/data/battle_moves.h'); decl.append('static const struct {u8 pp;} gBattleMoves[MOVES_COUNT]={\n')
    for name in ('TACKLE', 'TAIL_WHIP', 'SAND_ATTACK'):
        start = text.index('    [MOVE_' + name + '] ='); end = text.index('\n    [', start + 1)
        field = re.search(r'        \.pp = [^,]+,', text[start:end])
        if field is None: raise ValueError('Missing source PP')
        decl += ['[MOVE_' + name + ']={\n', source.record('src/data/battle_moves.h', name + '.pp', 'selected-field', start + field.start(), start + field.end(), text), '},\n']
    decl.append('};\n')

    # Decode only literal one-byte characters from the pinned charmap and actual keyboard.
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
    for name, number in (('PIDGEY', 16), ('RATTATA', 19)):
        match = re.search(r'    \[SPECIES_' + name + r'\] = _\("([^"\\]+)"\),', text)
        if not match: raise ValueError('Missing species name')
        source.record('src/data/text/species_names.h', name, 'source-charmap-encoded-name', match.start(), match.end(), text)
        source.fragments[-1]['transformation'] = 'Source text encoded using pinned one-byte charmap; EOS padding is explicit.'
        codec['speciesNames'][str(number)] = match[1]
        data = [charmap[c] for c in match[1]] + [255] * (11 - len(match[1]))
        decl.append('[SPECIES_' + name + ']={' + ','.join(map(str, data)) + '},\n')
    decl.append('};\n')
    (out / 'codec.json').write_text(json.dumps(codec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    (out / 'source_data.inc').write_text(''.join(decl), encoding='utf-8', newline='\n')
    funcs = []
    for path, names in {
        'src/pokemon.c': ('GetSpeciesName', 'CalculateMonStats', 'GetLevelFromMonExp', 'GetLevelFromBoxMonExp', 'GetNature', 'GetNatureFromPersonality',
            'ModifyStatByNature', 'GiveMoveToBoxMon', 'GiveBoxMonInitialMoveset', 'DeleteFirstMoveAndGiveMoveToBoxMon',
            'GetAbilityBySpecies', 'GetMonAbility', 'GetMonGender', 'GetBoxMonGender', 'CalculatePPWithBonus', 'MonRestorePP', 'BoxMonRestorePP',
            'GiveMonToPlayer', 'SendMonToPC', 'CalculatePlayerPartyCount', 'IsPlayerPartyAndPokemonStorageFull', 'IsPokemonStorageFull',
            'SpeciesToNationalPokedexNum', 'NationalPokedexNumToSpecies', 'HandleSetPokedexFlag'),
        'src/field_specials.c': ('SetPCBoxToSendMon', 'GetPCBoxToSendMon', 'ShouldShowBoxWasFullMessage', 'IsDestinationBoxFull'),
        'src/pokemon_storage_system.c': ('StorageGetCurrentBox',),
        'src/pokedex_screen.c': ('DexScreen_GetSetPokedexFlag',),
        'src/pokedex.c': ('GetSetPokedexFlag',),
        'src/overworld.c': ('IncrementGameStat', 'GetGameStat', 'SetGameStat'),
        'src/string_util.c': ('StringCopy', 'StringCopyN'),
        'src/naming_screen.c': ('SaveInputText',),
    }.items():
        for name in names: funcs.append(source.block(path, name, 'function'))
    # The original factory deliberately omitted these non-random fields.
    text = source.read('src/pokemon.c'); start = text.index('    GetSpeciesName(speciesName, species);', text.index('void CreateBoxMon(')); end = text.index('\n\n', start)
    funcs.append('static void SourceCreationMetadata(struct BoxPokemon *boxMon,u16 species,u8 level){u8 speciesName[POKEMON_NAME_LENGTH+1];u32 value;\n' + source.record('src/pokemon.c', 'CreateBoxMon:nonrandom-metadata', 'selected-statements', start, end, text) + '\n}\n')
    for path, name in (('src/battle_script_commands.c', 'Cmd_trysetcaughtmondexflags'), ('src/battle_script_commands.c', 'Cmd_givecaughtmon'),
                       ('src/battle_script_commands.c', 'Cmd_trygivecaughtmonnick'), ('src/item_use.c', 'BattleUseFunc_PokeBallEtc'),
                       ('src/naming_screen.c', 'MainState_PressedOKButton'), ('src/naming_screen.c', 'DisplaySentToPCMessage'),
                       ('src/pokemon.c', 'BoxMonToMon')):
        source.block(path, name, 'function'); source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    # Source caught-bit branch replaces only bytecode cursor movement with a private boolean.
    text = source.read('src/battle_script_commands.c'); start = text.index('        HandleSetPokedexFlag(', text.index('static void Cmd_trysetcaughtmondexflags(void)\n{')); end = text.index('\n', start)
    statement = source.record('src/battle_script_commands.c', 'Cmd_trysetcaughtmondexflags:set-caught', 'selected-statement', start, end, text)
    funcs.append('static void SourceSetCaught(u16 species,u32 personality){\n' + statement + '\n}\n')
    (out / 'source_functions.inc').write_text(''.join(funcs), encoding='utf-8', newline='\n')
    evidence = []
    for path in ('data/battle_scripts_2.s', 'data/maps/Route1/map.json', 'src/battle_main.c', 'src/naming_screen.c'):
        evidence.append(source.read(path))
    (out / 'source_evidence.txt').write_text('\n'.join(evidence), encoding='utf-8', newline='\n')
    for path in sorted((ROOT / 'tools/battle-capture/c').glob('*')): (out / path.name).write_bytes(path.read_bytes())
    report = {'schemaVersion': 1, 'profile': 'firered-route1-capture-v1', 'sourceFingerprint': source.lock['fingerprint']['value'],
              'inputs': [source.inputs[k] for k in sorted(source.inputs)], 'fragments': source.fragments,
              'transformations': [
                  'Separate private captured Route1 continuation, preserving all five previous source modules.',
                  'Source scalar Pokemon fields and exact string bytes replace encrypted source save structs; no source save-file compatibility claimed.',
                  'Missing nonrandom CreateBoxMon metadata is applied from the explicit Route1/trainer context; no creature recreation or RNG draws.',
                  'Previously omitted source battle-entry seen flag is deferred to the capture continuation before success-script capture count and caught flag.',
                  'Complete source naming SaveInputText receives validated source keyboard bytes without UI/frame callbacks; blank input retains species name.',
                  'Complete source party/PC allocation and naming PC preflight operate on immutable occupancy projections; unchanged occupants are opaque, not fabricated creatures.',
                  'Only occupied-species reads and one destination copy are required by allocation; boxed copies exclude party runtime fields.',
                  'Source message branch IDs are projected without box-name formatting, audio, dex display, or UI waits.',
                  'Result remains pending trusted ownership application, not a persistent grant or broadened battle admission.']}
    report['outputs'] = [{'path': str(p.relative_to(out)).replace('\\', '/'), 'bytes': p.stat().st_size, 'sha256': base.sha(p.read_bytes())}
                         for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'extraction-manifest.json']
    report['buildScripts'] = [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': base.sha(p.read_bytes())}
                              for p in (BASE / 'extract.py', Path(__file__), Path(__file__).with_name('build.py'))]
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--out', required=True, type=Path)
    extract(parser.parse_args().out.absolute())
