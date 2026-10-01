"""Pinned source extraction for the private loss/whiteout continuation."""
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
    if out.resolve() != out or not out.is_relative_to(ROOT / '.local/battle-loss'):
        raise ValueError('Loss extraction must remain private')
    out.mkdir(parents=True, exist_ok=True)
    source = base.Extraction()
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'hold_effects', 'battle',
                 'trainers', 'opponents', 'flags', 'vars', 'maps', 'map_groups', 'map_types', 'map_event_ids', 'heal_locations'):
        data = source.read(f'include/constants/{name}.h')
        target = out / 'constants' / (name + '.h')
        target.parent.mkdir(exist_ok=True)
        target.write_text(data, encoding='utf-8', newline='\n')
    decl = [source.block('include/pokemon.h', 'SpeciesInfo', 'struct'),
            source.block('include/global.h', 'WarpData', 'struct'),
            source.block('include/heal_location.h', 'HealLocation', 'struct'),
            source.block('src/overworld.c', 'InitialPlayerAvatarState', 'struct')]
    for path, names in {
        'include/gba/defines.h': ('TRUE', 'FALSE'),
        'include/global.h': ('min', 'ARRAY_COUNT', 'NELEMS'),
        'src/pokemon.c': ('PP_UP_SHIFTS', 'CALC_STAT'),
        'src/data/pokemon/species_info.h': ('PERCENT_FEMALE',),
        'src/data/pokemon/level_up_learnsets.h': ('LEVEL_UP_MOVE', 'LEVEL_UP_END'),
        'src/money.c': ('MAX_MONEY',),
        'include/global.fieldmap.h': ('PLAYER_AVATAR_FLAG_ON_FOOT',),
    }.items():
        for name in names:
            decl.append(source.macro(path, name))
    decl.append(source.enum_containing('include/global.fieldmap.h', 'PLAYER_AVATAR_STATE_NORMAL'))
    text = source.read('src/data/pokemon/species_info.h')
    start = text.index('    [SPECIES_SQUIRTLE] ='); end = text.index('\n    [', start + 1)
    decl += ['static const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES] = {\n',
             source.record('src/data/pokemon/species_info.h', 'Squirtle', 'complete-table-entry', start, end, text), '};\n']
    decl.append(source.read('src/data/pokemon/experience_tables.h'))
    for name in ('sNatureStatTable', 'sFriendshipEventDeltas', 'gPPUpGetMask'):
        decl.append(source.block('src/pokemon.c', name, 'table'))
    decl.append(source.block('src/data/pokemon/level_up_learnsets.h', 'sSquirtleLevelUpLearnset', 'table'))
    for name in ('sWhiteOutMoneyLossMultipliers', 'sWhiteOutMoneyLossBadgeFlagIDs'):
        decl.append(source.block('src/overworld.c', name, 'table'))
    decl.append(source.read('src/data/heal_locations.h'))
    text = source.read('src/data/battle_moves.h')
    decl.append('static const struct {u8 pp;} gBattleMoves[MOVES_COUNT] = {\n')
    for name in ('TACKLE', 'TAIL_WHIP', 'BUBBLE', 'WITHDRAW', 'WATER_GUN', 'BITE', 'RAPID_SPIN', 'PROTECT', 'RAIN_DANCE', 'SKULL_BASH', 'HYDRO_PUMP'):
        start = text.index('    [MOVE_' + name + '] ='); end = text.index('\n    [', start + 1)
        match = re.search(r'        \.pp = [^,]+,', text[start:end])
        if match is None: raise ValueError('Missing source move PP')
        decl += ['[MOVE_' + name + '] = {\n', source.record('src/data/battle_moves.h', name + '.pp', 'selected-field', start + match.start(), start + match.end(), text), '},\n']
    decl.append('};\n')

    # Turn this one finite source script into an operation list; not a script VM.
    text = source.read('data/scripts/hall_of_fame.inc')
    start = text.index('EventScript_ResetEliteFourEnd::')
    entry = text[start:text.index('EventScript_ResetEliteFour::', start)]
    if entry.split() != ['EventScript_ResetEliteFourEnd::', 'call', 'EventScript_ResetEliteFour', 'end']:
        raise ValueError('Unexpected Elite Four reset entry')
    start_body = text.index('EventScript_ResetEliteFour::', start)
    end = text.index('\treturn', start_body) + len('\treturn')
    source.record('data/scripts/hall_of_fame.inc', 'EventScript_ResetEliteFourEnd-and-callee', 'script-to-operation-table', start, end, text)
    source.fragments[-1]['transformation'] = 'Exact finite call target and clearflag/cleartrainerflag/setvar operations compiled into a private operation table; rejects any new opcode.'
    operations = []; flags = []; trainers = []; variables = []
    for line in text[start_body:end].splitlines()[1:-1]:
        parts = line.strip().replace(',', '').split()
        if not parts: continue
        if parts[0] == 'clearflag' and len(parts) == 2:
            operations.append('{1,' + parts[1] + ',0},'); flags.append(parts[1])
        elif parts[0] == 'cleartrainerflag' and len(parts) == 2:
            operations.append('{2,' + parts[1] + ',0},'); trainers.append(parts[1])
        elif parts[0] == 'setvar' and len(parts) == 3 and parts[2] == '0':
            operations.append('{3,' + parts[1] + ',0},'); variables.append(parts[1])
        else: raise ValueError('Unsupported reset script operation ' + line)
    decl.append('static const struct {u16 kind,id,value;} sEliteFourReset[] = {' + ''.join(operations) + '};\n')
    decl.append('static const u16 sEliteFlags[] = {' + ','.join(flags) + '};\n')
    decl.append('static const u16 sChampionFlags[] = {' + ','.join(trainers) + '};\n')
    decl.append('static const u16 sLeagueVars[] = {' + ','.join(variables) + '};\n')
    reset = source.block('src/overworld.c', 'Overworld_ResetStateAfterWhitingOut', 'function')
    field_flags = re.findall(r'FlagClear\((FLAG_\w+)\);', reset)
    field_vars = re.findall(r'VarSet\((VAR_\w+), 0\);', reset)
    if len(field_flags) != 6 or len(field_vars) != 3 or len(flags) != 5 or len(trainers) != 6 or len(variables) != 1:
        raise ValueError('Context table layout changed')
    decl.append('static const u16 sFieldFlags[] = {' + ','.join(field_flags) + '};\n')
    decl.append('static const u16 sFieldVars[] = {' + ','.join(field_vars) + '};\n')
    (out / 'source_data.inc').write_text(''.join(decl), encoding='utf-8', newline='\n')
    funcs = []
    for path, names in {
        'src/pokemon.c': ('CalculateMonStats', 'GetLevelFromMonExp', 'GetLevelFromBoxMonExp', 'GetNature', 'GetNatureFromPersonality', 'ModifyStatByNature', 'AdjustFriendship', 'CalculatePPWithBonus', 'GetPlayerPartyHighestLevel'),
        'src/battle_util2.c': ('AdjustFriendshipOnBattleFaint',),
        'src/money.c': ('GetMoney', 'SetMoney', 'RemoveMoney'),
        'src/script_pokemon_util.c': ('HealPlayerParty',),
        'src/heal_location.c': ('GetHealLocationIndexFromMapGroupAndNum', 'GetHealLocation', 'SetWhiteoutRespawnHealerNpcAsLastTalked', 'SetWhiteoutRespawnWarpAndHealerNpc'),
        'src/safari_zone.c': ('ResetSafariZoneFlag',),
        'src/overworld.c': ('CountBadgesForOverworldWhiteOutLossCalculation', 'ComputeWhiteOutMoneyLoss', 'ResetInitialPlayerAvatarState', 'SetInitialPlayerAvatarStateWithDirection', 'Overworld_SetWhiteoutRespawnPoint', 'DoWhiteOut', 'ResetSafariZoneFlag_'),
    }.items():
        for name in names: funcs.append(source.block(path, name, 'function'))
    funcs.append(reset)
    text = source.read('src/field_screen_effect.c')
    start = text.index('        loc = GetHealLocation(HEAL_LOCATION_PALLET_TOWN);', text.index('static void Task_RushInjuredPokemonToCenter(u8 taskId)\n{'))
    end = text.index('        break;', start)
    branch = source.record('src/field_screen_effect.c', 'Task_RushInjuredPokemonToCenter:last-heal-script-choice', 'selected-branch', start, end, text)
    funcs.append('static bool8 SourceMomArrival(void) {const struct HealLocation *loc;u8 taskId=0;\n' + branch + '\nreturn gTasks[0].tState==4;\n}\n')
    text = source.read('src/overworld.c')
    start = text.index('        ResetSafariZoneFlag_();', text.index('void CB2_WhiteOut(void)\n{'))
    end = text.index('        ScriptContext_Init();', start)
    funcs.append('static void SourceWhiteoutMechanics(void) {\n' + source.record('src/overworld.c', 'CB2_WhiteOut:mechanical-sequence', 'selected-statements', start, end, text) + '\n}\n')
    (out / 'source_functions.inc').write_text(''.join(funcs), encoding='utf-8', newline='\n')
    evidence = []
    for path, names in {
        'src/battle_script_commands.c': ('Cmd_tryfaintmon', 'Cmd_getmoneyreward'),
        'src/battle_setup.c': ('CB2_EndWildBattle', 'IsPlayerDefeated'),
        'src/overworld.c': ('CB2_WhiteOut', 'WarpIntoMap'),
        'src/field_screen_effect.c': ('Task_RushInjuredPokemonToCenter', 'FieldCB_RushInjuredPokemonToCenter'),
        'src/scrcmd.c': ('ScrCmd_setvar', 'ScrCmd_clearflag', 'ScrCmd_cleartrainerflag'),
    }.items():
        for name in names:
            evidence.append(source.block(path, name, 'function')); source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    for path in ('data/scripts/white_out.inc', 'data/scripts/pkmn_center_nurse.inc'):
        evidence.append(source.read(path))
    text = source.read('data/battle_scripts_1.s'); start = text.index('BattleScript_LocalBattleLost::'); end = text.index('\nBattleScript_', start + 1)
    evidence.append(source.record('data/battle_scripts_1.s', 'BattleScript_LocalBattleLost', 'script-evidence-not-compiled', start, end, text))
    text = source.read('data/event_scripts.s'); start = text.index('EventScript_OutOfCenterPartyHeal::'); end = text.index('\n\n', start)
    evidence.append(source.record('data/event_scripts.s', 'EventScript_OutOfCenterPartyHeal', 'script-evidence-not-compiled', start, end, text))
    # Pin the two nurse text branches, and reject drift in the projected choice.
    whiteout = source.read('data/scripts/white_out.inc')
    for expected in ('call_if_unset FLAG_DEFEATED_BROCK, EventScript_AfterWhiteOutHealMsgPreBrock', 'call_if_set FLAG_DEFEATED_BROCK, EventScript_AfterWhiteOutHealMsg', 'Text_MonsHealedShouldBuyPotions', 'Text_MonsHealed'):
        if expected not in whiteout: raise ValueError('Whiteout nurse branch changed: ' + expected)
    (out / 'source_evidence.txt').write_text(''.join(evidence), encoding='utf-8', newline='\n')
    for path in sorted((ROOT / 'tools/battle-loss/c').glob('*')): (out / path.name).write_bytes(path.read_bytes())
    report = {'schemaVersion': 1, 'profile': 'firered-route1-loss-v1', 'sourceFingerprint': source.lock['fingerprint']['value'],
              'inputs': [source.inputs[k] for k in sorted(source.inputs)], 'fragments': source.fragments,
              'transformations': [
                  'Private sole-Squirtle lost/draw continuation; deferred source faint friendship executes exactly once per admitted continuation.',
                  'Complete Pokemon/money/heal/respawn functions use projected scalar state; save money encryption key is fixed zero, not a source save-file representation.',
                  'Elite Four reset is the exact finite source call/operation list, not a general event-script VM.',
                  'CB2 mechanical sequence runs without 120-frame/audio/map-load/presentation waits. WarpIntoMap records a pending external application; no map is loaded.',
                  'All20 canonical heal rows are supported; invalid last-heal and Trainer Tower override context reject before source indexing.',
                  'Source full-tuple home/center branch plus Brock text branch selects pending arrival script only; dialogue/NPC/fanfare/repeated heal is not executed.',
                  'No admitted source function consumes RNG; unexpected random, positive-friendship metadata or unsupported services trap.',
                  'Raw state validates future-read state; strict host restore additionally replays immutable admission/context to prove history.']}
    report['outputs'] = [{'path': str(p.relative_to(out)).replace('\\', '/'), 'bytes': p.stat().st_size, 'sha256': base.sha(p.read_bytes())}
                         for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'extraction-manifest.json']
    report['buildScripts'] = [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': base.sha(p.read_bytes())}
                              for p in (BASE / 'extract.py', Path(__file__), Path(__file__).with_name('build.py'))]
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--out', required=True, type=Path)
    extract(parser.parse_args().out.absolute())
