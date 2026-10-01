"""Private, pinned source progression supplement. Existing modules are untouched."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'tools/battle-spike'
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('battle_source_extract', BASE / 'extract.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def extract(out):
    if out.resolve() != out or not out.is_relative_to(ROOT / '.local/battle-progression'):
        raise ValueError('Progression extraction must remain private')
    out.mkdir(parents=True, exist_ok=True)
    source = base.Extraction()
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'hold_effects', 'battle', 'trainers', 'opponents'):
        data = source.read(f'include/constants/{name}.h')
        target = out / 'constants' / (name + '.h')
        target.parent.mkdir(exist_ok=True)
        target.write_text(data, encoding='utf-8', newline='\n')
    decl = [source.block('include/pokemon.h', 'SpeciesInfo', 'struct')]
    for path, names in {
        'include/gba/defines.h': ('TRUE', 'FALSE'),
        'include/global.h': ('min',),
        'src/pokemon.c': ('PP_UP_SHIFTS_INV',),
        'include/battle_controllers.h': ('RET_VALUE_LEVELED_UP',),
    }.items():
        for name in names:
            decl.append(source.macro(path, name))
    text = source.read('include/global.h')
    start = text.index('#ifdef UBFIX\n#define SAFE_DIV')
    end = text.index('#endif', start) + len('#endif')
    decl.append(source.record('include/global.h', 'SAFE_DIV:source-build-conditional', 'macro-conditional', start, end, text))
    decl += [source.macro('src/data/pokemon/species_info.h', 'PERCENT_FEMALE'),
             source.macro('src/pokemon.c', 'CALC_STAT'),
             source.macro('src/data/pokemon/level_up_learnsets.h', 'LEVEL_UP_MOVE'),
             source.macro('src/data/pokemon/level_up_learnsets.h', 'LEVEL_UP_END')]
    text = source.read('src/data/pokemon/species_info.h')
    decl.append('static const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES] = {\n')
    for name in ('SQUIRTLE', 'PIDGEY', 'RATTATA'):
        start = text.index('    [SPECIES_' + name + '] =')
        end = text.index('\n    [', start + 1)
        decl.append(source.record('src/data/pokemon/species_info.h', name, 'complete-table-entry', start, end, text))
    decl.append('};\n')
    decl.append(source.read('src/data/pokemon/experience_tables.h'))
    decl.append(source.block('src/pokemon.c', 'sNatureStatTable', 'table'))
    decl.append(source.block('src/pokemon.c', 'sFriendshipEventDeltas', 'table'))
    decl.append(source.block('src/pokemon.c', 'gPPUpClearMask', 'table'))
    decl.append(source.block('src/data/pokemon/level_up_learnsets.h', 'sSquirtleLevelUpLearnset', 'table'))
    decl.append('static const u16 *const gLevelUpLearnsets[NUM_SPECIES] = {[SPECIES_SQUIRTLE]=sSquirtleLevelUpLearnset};\n')
    decl.append(source.block('include/pokemon.h', 'Evolution', 'struct'))
    text = source.read('src/data/pokemon/evolution.h')
    start = text.index('    [SPECIES_SQUIRTLE]')
    end = text.index('\n', start)
    decl.append('static const struct Evolution gEvolutionTable[NUM_SPECIES][EVOS_PER_MON] = {\n')
    decl.append(source.record('src/data/pokemon/evolution.h', 'Squirtle-evolution', 'complete-table-entry', start, end, text))
    decl.append('};\n')
    text = source.read('src/data/battle_moves.h')
    decl.append('static const struct {u8 pp;} gBattleMoves[MOVES_COUNT] = {\n')
    for name in ('TACKLE', 'TAIL_WHIP', 'BUBBLE', 'WITHDRAW', 'WATER_GUN', 'BITE', 'RAPID_SPIN', 'PROTECT', 'RAIN_DANCE', 'SKULL_BASH', 'HYDRO_PUMP'):
        start = text.index('    [MOVE_' + name + '] =')
        end = text.index('\n    [', start + 1)
        match = re.search(r'        \.pp = [^,]+,', text[start:end])
        if match is None: raise ValueError('Missing source move PP')
        decl.append('[MOVE_' + name + '] = {\n')
        decl.append(source.record('src/data/battle_moves.h', name + '.pp', 'selected-field', start + match.start(), start + match.end(), text))
        decl.append('},\n')
    decl.append('};\n')
    (out / 'source_data.inc').write_text(''.join(decl), encoding='utf-8', newline='\n')
    funcs = []
    for name in ('CalculateMonStats', 'GetLevelFromMonExp', 'GetLevelFromBoxMonExp', 'GetNature', 'GetNatureFromPersonality',
                 'ModifyStatByNature', 'GiveMoveToMon', 'GiveMoveToBoxMon', 'MonTryLearningNewMove', 'RemoveMonPPBonus',
                 'SetMonMoveSlot', 'MonGainEVs', 'CheckPartyHasHadPokerus', 'AdjustFriendship', 'GetEvolutionTargetSpecies'):
        funcs.append(source.block('src/pokemon.c', name, 'function'))
    path = 'src/battle_script_commands.c'
    text = source.read(path)
    start = text.index('            calculatedExp = gSpeciesInfo[', text.index('static void Cmd_getexp(void)\n{'))
    end = text.index('\n', start)
    award = source.record(path, 'Cmd_getexp:ordinary-base-award', 'selected-statement', start, end, text)
    start = text.index('                *exp = SAFE_DIV(calculatedExp, viaSentIn);', end)
    end = text.index('                gExpShareExp = 0;', start)
    award += source.record(path, 'Cmd_getexp:no-Exp-Share-award', 'selected-branch', start, end, text)
    funcs.append('static u16 SourceAward(void) {u16 calculatedExp, value, *exp=&value; u32 viaSentIn=1;\n' + award + '\n return value;\n}\n')
    path = 'src/battle_controller_player.c'
    text = source.read(path)
    start = text.index('            if (currExp + gainedExp >= expOnNextLvl)', text.index('static void Task_GiveExpWithExpBar(u8 taskId)\n{'))
    end = text.index('\n        }\n    }\n}', start)
    chunk = source.record(path, 'Task_GiveExpWithExpBar:completed-bar-XP-branch', 'selected-branch', start, end, text)
    source.fragments[-1]['transformation'] = 'Complete completed-bar branch retained with task/controller callbacks projected into the continuation; no frame/audio execution.'
    funcs.append('static void SourceApplyChunk(void) {u8 monId=0,battlerId=0,taskId=0; s16 gainedExp=sRemaining; u8 level=GetMonData(&gPlayerParty[0],MON_DATA_LEVEL); s32 currExp=GetMonData(&gPlayerParty[0],MON_DATA_EXP); u16 species=SPECIES_SQUIRTLE; s32 expOnNextLvl=gExperienceTables[gSpeciesInfo[species].growthRate][level+1];\n' + chunk + '\n}\n')
    (out / 'source_functions.inc').write_text(''.join(funcs), encoding='utf-8', newline='\n')
    evidence = []
    for path, names in {'src/battle_script_commands.c': ('Cmd_getexp', 'Cmd_handlelearnnewmove', 'Cmd_yesnoboxlearnmove'),
                        'src/battle_main.c': ('FreeResetData_ReturnToOvOrDoEvolutions', 'TryEvolvePokemon')}.items():
        for name in names:
            evidence.append(source.block(path, name, 'function'))
            source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    text = source.read('data/battle_scripts_1.s')
    start = text.index('BattleScript_LevelUp::'); end = text.index('BattleScript_RainContinuesOrEnds::', start)
    evidence.append(source.record('data/battle_scripts_1.s', 'level-learning-loop', 'script-evidence-not-compiled', start, end, text))
    source.read('src/evolution_scene.c')
    for name in ('RandomlyGivePartyPokerus', 'PartySpreadPokerus'):
        evidence.append(source.block('src/pokemon.c', name, 'function'))
        source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    (out / 'source_evidence.txt').write_text(''.join(evidence), encoding='utf-8', newline='\n')
    for path in sorted((ROOT / 'tools/battle-progression/c').glob('*')):
        (out / path.name).write_bytes(path.read_bytes())
    report = {'schemaVersion': 1, 'profile': 'firered-route1-progression-v1', 'sourceFingerprint': source.lock['fingerprint']['value'],
              'inputs': [source.inputs[k] for k in sorted(source.inputs)], 'fragments': source.fragments,
              'transformations': ['Private one-Squirtle ordinary-wild victory continuation; no live reward or second numerical engine.',
                'Complete source Pokemon numerical functions use projected named scalar fields, not encrypted save structs.',
                'Source completed experience-bar branch runs without presentation waits, retaining >= comparison, one-level chunks and remainder.',
                'Source reward branch specializes one living participant, ordinary wild, no trade/held-item/Exp Share multiplier. Raw diagnostic override is explicitly separate.',
                'Source friendship metadata must be explicit before a level-up; unknown bridge metadata is never silently guessed.',
                'Evolution query yields a pending external handoff after XP/learning; no species mutation or dex/rename continuation.',
                'Move-selection UI is replaced by explicit slot/decline decisions; all admitted learnset moves are non-HM.',
                'No admitted source function consumes RNG; unexpected random/unsupported services trap.']}
    report['outputs'] = [{'path': str(p.relative_to(out)).replace('\\', '/'), 'bytes': p.stat().st_size, 'sha256': base.sha(p.read_bytes())}
                         for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'extraction-manifest.json']
    report['buildScripts'] = [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': base.sha(p.read_bytes())}
                              for p in (BASE / 'extract.py', Path(__file__), Path(__file__).with_name('build.py'))]
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--out', required=True, type=Path)
    extract(parser.parse_args().out.absolute())
