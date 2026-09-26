"""Bounded headless extraction of pinned source battle command bodies.

No game arithmetic is rewritten. Complete selected C functions, tables, macros
and structs are copied byte-for-byte after UTF-8 decoding. A separate adapter
provides a deliberately restricted environment and controller event transport.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import lifecycle_extract

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def mask(text):
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
    return re.sub(pattern, lambda match: ''.join('\n' if char == '\n' else ' ' for char in match[0]), text)


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
        self.fragments.append({'source': path, 'name': name, 'kind': kind,
                               'startLine': text.count('\n', 0, start) + 1,
                               'endLine': text.count('\n', 0, end - 1) + 1,
                               'sha256': sha(fragment.encode('utf-8')),
                               'transformation': 'none; complete selected source text retained'})
        return f'\n/* SOURCE {path}:{self.fragments[-1]["startLine"]} {name} */\n{fragment}\n'

    def block(self, path, name, kind):
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
        clean = mask(text)
        matches = [match for match in re.finditer(r'\benum\s*\{[^{}]+\}\s*;', clean)
                   if re.search(rf'\b{re.escape(name)}\b', match[0])]
        if len(matches) != 1:
            raise ValueError(f'Expected one enum containing {name}')
        return self.record(path, name, 'enum', matches[0].start(), matches[0].end(), text)

    def script(self, name):
        path = 'data/battle_scripts_1.s'
        text = self.read(path)
        match = re.search(rf'(?m)^{re.escape(name)}::\s*$', text)
        if match is None:
            raise ValueError(f'Missing source script {name}')
        following = re.search(r'(?m)^BattleScript_\w+::', text[match.end():])
        end = match.end() + following.start() if following else len(text)
        return self.record(path, name, 'script-evidence-not-compiled', match.start(), end, text)


def extract(out: Path):
    source = Extraction()
    out.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ('global', 'pokemon', 'species', 'moves', 'items', 'abilities', 'hold_effects',
                 'battle', 'battle_move_effects', 'flags', 'trainers', 'opponents', 'battle_script_commands', 'battle_string_ids'):
        path = f'include/constants/{name}.h'
        data = source.read(path)
        relative = f'constants/{name}.h'
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode('utf-8'))
        copied.append({'source': path, 'output': relative, 'transformation': 'none; complete header copied'})

    parts = ['/* Generated only from the pinned source; adapter is separate. */\n']
    for name in ('BattlePokemon', 'BattleMove'):
        parts.append(source.block('include/pokemon.h', name, 'struct'))
    for name in ('ResourceFlags', 'DisableStruct', 'ProtectStruct', 'SpecialStatus', 'BattleScripting', 'SideTimer'):
        parts.append(source.block('include/battle.h', name, 'struct'))
    parts.append(source.block('src/battle_script_commands.c', 'StatFractions', 'struct'))
    parts.append(source.enum_containing('include/battle_controllers.h', 'REQUEST_HP_BATTLE'))
    parts.append(source.enum_containing('include/battle_controllers.h', 'BUFFER_A'))
    macros = {
        'include/global.h': ('ARRAY_COUNT', 'T1_READ_32', 'T1_READ_PTR', 'T2_READ_16', 'T2_READ_32', 'T2_READ_PTR'),
        'include/gba/defines.h': ('TRUE', 'FALSE'),
        'include/random.h': ('RAND_MULT', 'ISO_RANDOMIZE1'),
        'include/pokemon.h': ('BATTLE_ALIVE_DEF_SIDE',),
        'include/battle.h': ('GET_BATTLER_POSITION', 'GET_BATTLER_SIDE', 'GET_BATTLER_SIDE2', 'F_DYNAMIC_TYPE_1',
                             'F_DYNAMIC_TYPE_2', 'DYNAMIC_TYPE_MASK', 'GET_MOVE_TYPE', 'IS_TYPE_PHYSICAL', 'IS_TYPE_SPECIAL',
                             'IS_BATTLER_OF_TYPE', 'RESOURCE_FLAG_FLASH_FIRE', 'MOVE_TARGET_SELECTED', 'MOVE_TARGET_DEPENDS',
                             'MOVE_TARGET_USER_OR_SELECTED', 'MOVE_TARGET_RANDOM', 'MOVE_TARGET_BOTH', 'MOVE_TARGET_USER',
                             'MOVE_TARGET_FOES_AND_ALLY', 'MOVE_TARGET_OPPONENTS_FIELD', 'MOVE_IS_PERMANENT',
                             'B_ACTION_USE_MOVE', 'B_ACTION_SWITCH', 'B_ACTION_NONE'),
        'include/battle_main.h': ('TYPE_EFFECT_ATK_TYPE', 'TYPE_EFFECT_DEF_TYPE', 'TYPE_EFFECT_MULTIPLIER',
                                  'TYPE_MUL_NO_EFFECT', 'TYPE_MUL_NOT_EFFECTIVE', 'TYPE_MUL_NORMAL',
                                  'TYPE_MUL_SUPER_EFFECTIVE', 'TYPE_FORESIGHT', 'TYPE_ENDTABLE'),
        'include/battle_util.h': ('ABILITYEFFECT_FIELD_SPORT', 'ABILITYEFFECT_MUD_SPORT', 'ABILITYEFFECT_WATER_SPORT',
                                 'ABILITY_ON_FIELD2', 'WEATHER_HAS_EFFECT2', 'WEATHER_HAS_EFFECT',
                                 'ABILITYEFFECT_CHECK_ON_FIELD', 'ABILITYEFFECT_ABSORBING', 'ABILITYEFFECT_COUNT_ON_FIELD',
                                 'ABILITYEFFECT_COUNT_OTHER_SIDE'),
        'src/pokemon.c': ('APPLY_STAT_MOD', 'ShouldGetStatBadgeBoost'),
        'src/battle_script_commands.c': ('DEFENDER_IS_PROTECTED', 'INCREMENT_RETURN'),
    }
    for path, names in macros.items():
        parts.extend(source.macro(path, name) for name in names)
    lifecycle = lifecycle_extract.export(source)
    parts.append(lifecycle['declarations'])
    (out / 'source_declarations.inc').write_bytes(''.join(parts).encode('utf-8'))
    parts = []
    for path, names in {
        'src/pokemon.c': ('gStatStageRatios', 'sHoldEffectToType'),
        'src/battle_main.c': ('gTypeEffectiveness',),
        'src/data/battle_moves.h': ('gBattleMoves',),
        'src/util.c': ('gBitTable',),
        'src/battle_script_commands.c': ('sAccuracyStageRatios', 'sCriticalHitChance', 'sStatusFlagsForMoveEffects'),
    }.items():
        parts.extend(source.block(path, name, 'table') for name in names)
    (out / 'source_tables.inc').write_bytes(''.join(parts).encode('utf-8'))
    parts = []
    for path, names in {
        'src/random.c': ('Random',),
        'src/battle_anim_mons.c': ('GetBattlerSide', 'GetBattlerPosition', 'GetBattlerAtPosition'),
        'src/battle_util.c': ('GetBattlerForBattleScript',),
        'src/pokemon.c': ('CalculateBaseDamage',),
        'src/battle_script_commands.c': ('Cmd_damagecalc', 'ModulateDmgByType', 'Cmd_typecalc', 'ApplyRandomDmgMultiplier',
                                        'Cmd_healthbarupdate', 'Cmd_datahpupdate'),
    }.items():
        for name in names:
            parts.append(source.block(path, name, 'function'))
            if name == 'Random':
                parts.append('\n#include "rng_hook.inc"\n')
    parts.append(source.block('src/battle_main.c', 'GetWhoStrikesFirst', 'function'))
    parts.append(source.block('src/battle_main.c', 'TurnValuesCleanUp', 'function'))
    parts.append(source.block('src/battle_main.c', 'SpecialStatusesClear', 'function'))
    for name in ('TrySetDestinyBondToHappen', 'CheckWonderGuardAndLevitate', 'JumpIfMoveFailed',
                 'JumpIfMoveAffectedByProtect', 'AccuracyCalcHelper', 'Cmd_accuracycheck', 'Cmd_ppreduce',
                 'Cmd_critcalc', 'Cmd_adjustnormaldamage', 'Cmd_seteffectwithchance', 'Cmd_jumpifstatus', 'Cmd_jumpiftype'):
        parts.append(source.block('src/battle_script_commands.c', name, 'function'))
    # Preserve the complete primary-status branch plus all its source guards.
    # Non-primary move effects are outside this experiment and fail explicitly.
    path = 'src/battle_script_commands.c'
    original = source.read(path)
    start = original.index('void SetMoveEffect(bool8 primary, u8 certain)\n{')
    boundary = original.index('\n    else\n    {\n        if (gBattleMons[gEffectBattler].status2 & sStatusFlagsForMoveEffects', start)
    parts.append(source.record(path, 'SetMoveEffect:primary-status-prefix', 'function-prefix', start, boundary, original)
                 + '\n    else { Unexpected(); }\n}\n')
    source.fragments[-1]['transformation'] = 'Original prefix and full primary-status branch retained; non-primary else replaced by explicit dependency error. Admission permits only primary poison.'
    parts.append(lifecycle['functions'])
    (out / 'source_functions.inc').write_bytes(''.join(parts).encode('utf-8'))
    evidence = [source.script(name) for name in (
        'BattleScript_EffectHit', 'BattleScript_MoveEnd', 'BattleScript_PrintMoveMissed',
        'BattleScript_MoveMissedPause', 'BattleScript_MoveMissed', 'BattleScript_EffectPoison',
        'BattleScript_AlreadyPoisoned', 'BattleScript_ButItFailed', 'BattleScript_NotAffected',
        'BattleScript_PoisonTurnDmg', 'BattleScript_BurnTurnDmg', 'BattleScript_DoTurnDmg',
        'BattleScript_FaintAttacker', 'BattleScript_FaintTarget', 'BattleScript_HandleFaintedMon')]
    for path, names in {
        'src/battle_main.c': ('SetActionsAndBattlersTurnOrder', 'BattleTurnPassed', 'HandleAction_TryFinish', 'HandleEndTurn_ContinueBattle'),
        'src/battle_util.c': ('DoFieldEndTurnEffects', 'AtkCanceller_UnableToUseMove'),
        'src/battle_script_commands.c': ('Cmd_attackcanceler', 'Cmd_end'),
    }.items():
        for name in names:
            evidence.append(source.block(path, name, 'function'))
            source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    (out / 'source_sequence_evidence.txt').write_bytes(''.join(evidence).encode('utf-8'))
    for name in ('adapter.h', 'adapter.c', 'attack.inc', 'lifecycle.inc', 'lifecycle_state.inc', 'rng_hook.inc', 'checkpoint.inc'):
        (out / name).write_bytes((ROOT / 'tools/battle-spike/c' / name).read_bytes())
    (out / 'battle_spike.c').write_text('#include "adapter.h"\n#include "source_tables.inc"\n#include "source_functions.inc"\n#include "adapter.c"\n#include "attack.inc"\n#include "lifecycle.inc"\n#include "checkpoint.inc"\n', encoding='utf-8')
    outputs = [{'path': str(path.relative_to(out)).replace('\\', '/'), 'bytes': path.stat().st_size,
                'sha256': sha(path.read_bytes())} for path in sorted(out.rglob('*')) if path.is_file() and path.name != 'extraction-manifest.json']
    report = {
        'schemaVersion': 3, 'scope': 'p03-batch3-restricted-turn-checkpoint', 'status': 'experimental-not-a-battle-engine',
        'sourceFingerprint': source.lock['fingerprint']['value'], 'upstreamCommit': None,
        'profile': {'game': 'FIRERED', 'language': 'ENGLISH', 'revision': 0},
        'inputs': [source.inputs[key] for key in sorted(source.inputs)], 'fragments': source.fragments, 'copiedHeaders': copied,
        'transformations': [
            'Complete selected functions are unedited. SetMoveEffect retains its original function prefix and complete primary-status branch; its non-primary else branch is replaced by an explicit unsupported-dependency failure. Adapter admission permits only primary poison.',
            'BattlePokemon, BattleMove, ResourceFlags, DisableStruct, ProtectStruct, SpecialStatus, BattleScripting, SideTimer and StatFractions retain complete source declarations.',
            'BattleStruct projects dynamic type, chosen move positions, synchronize effect, wrapping/history/choice and residual cursor fields; BattleResources, EnigmaBerry and BattleResults project only consulted fields. Pokemon party rows and two synthetic SpeciesInfo baseline-type rows are adapter layouts, not original encrypted party data, species identities or memory snapshots.',
            'Original HP, PP and status controller calls append typed events and acknowledge immediately, without graphics, controller buffers, or presentation waits.',
            'Only explicit empty-item, empty-ability-field and absent-badge queries have adapter answers; unexpected source service calls set an error and the host rejects the transition.',
            'The adapter projects EffectHit/EffectPoison command order and selected script branch flags. Full source attack cancellation, script interpreter, moveend/faint scheduler and replacement flow are not compiled; admitted actors are obeying and have no disabling status, volatile condition, item, ability or field effect.',
            'TurnValuesCleanUp and SpecialStatusesClear are copied intact. begin_turn places the bounded cleanup and source Random action-selection draw at the host selection boundary; this is not the complete original scheduler.',
            'source_sequence_evidence.txt records pinned original scripts and scheduler/cancellation functions for audit only; evidence-not-compiled fragments do not run in the WASM.',
            'After the unchanged Random definition, a macro routes every later Random call to an adapter counter which calls the original once and counts draws. Source function text and RNG arithmetic remain unchanged; counter overflow rejects the host transition.',
            'Checkpoint v1 serializes 148 explicitly named u32 scalar words at admitted host boundaries, validates all fields before mutation, and reconstructs pointers/unsupported empty context on import. It is profile-specific and contains no native pointers or struct bytes. Omitted scratch is reset before future use; the source-state audit records that argument.',
            *lifecycle['transformations'],
        ],
        'supported': ['Retained batch-one Tackle/Water Gun supplied-critical damage ABI',
                      'Batch-two Tackle, Water Gun and Quick Attack source accuracy, PP, critical, damage, type, variance and secondary-chance draw',
                      'Poison Powder source precondition predicates, accuracy and primary-poison application prefix',
                      'Source speed/priority comparison, tie RNG and retained-priority end-turn comparison',
                      'Source switch/faint cleanup, complete poison/burn residual cases and team HP outcome predicate',
                      'Source HP/PP/status calls as bounded ordered events with host-projected turn/party orchestration'],
        'unsupported': ['Production battle engine or full source scheduler/interpreter', 'other moves, secondary statuses, sleep, freeze, paralysis or toxic',
                        'abilities and held items', 'weather, screens, badges, traded disobedience and doubles',
                        'substitute, healing, recoil and other residual effects', 'full faint counters/friendship/experience/rewards and capture',
                        'encrypted Pokemon storage, persistence, production snapshot/restore and engine selection'],
        'outputs': outputs,
    }
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.out.resolve())
    print(json.dumps({'output': str(args.out), 'inputs': len(result['inputs']), 'fragments': len(result['fragments'])}))
