"""Supplement the shared battle extraction with a separately versioned real profile."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import item_extract

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'tools/battle-spike'
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('shared_battle_extract', BASE / 'extract.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def extract(out, *, family=False, party=False, tactics=False, charge=False):
    allowed = ROOT / ('.local/battle-charge' if charge else '.local/battle-tactics' if tactics else '.local/battle-party' if party else '.local/battle-family' if family else '.local/battle-route1')
    if out.resolve() != out or not out.is_relative_to(allowed):
        raise ValueError('Real battle extraction must remain private and nonredirected')
    report = base.extract(out)
    source = base.Extraction()
    declarations = []
    item = item_extract.export(source)
    declarations.append(item['declarations'])
    for path, names in {
        'include/battle.h': ('GET_STAT_BUFF_VALUE', 'GET_STAT_BUFF_ID', 'SET_STAT_BUFF_VALUE', 'STAT_BUFF_NEGATIVE', 'B_ACTION_RUN'),
        'include/battle_message.h': ('PREPARE_STAT_BUFFER', 'B_BUFF_PLACEHOLDER_BEGIN', 'B_BUFF_STAT', 'B_BUFF_EOS', 'B_BUFF_STRING'),
        'src/battle_script_commands.c': ('STAT_CHANGE_WORKED', 'STAT_CHANGE_DIDNT_WORK'),
        'include/battle_util.h': ('MOVE_LIMITATION_ZEROMOVE', 'MOVE_LIMITATION_PP', 'MOVE_LIMITATION_DISABLED',
                                 'MOVE_LIMITATION_TORMENTED', 'MOVE_LIMITATION_TAUNT', 'MOVE_LIMITATION_IMPRISON', 'MOVE_LIMITATIONS_ALL'),
        'src/battle_util.c': ('ALL_MOVES_MASK',),
    }.items():
        declarations.extend(source.macro(path, name) for name in names)
    species_path = 'src/data/pokemon/species_info.h'
    species_text = source.read(species_path)
    declarations.append('static const u8 sRoute1Types[NUM_SPECIES][2] = {\n')
    for species in ('SQUIRTLE', 'PIDGEY', 'RATTATA'):
        start = species_text.index('    [SPECIES_' + species + '] =')
        end = species_text.index('\n    [', start + 1)
        match = re.search(r'\.types\s*=\s*(\{[^}]+\})', species_text[start:end])
        if match is None: raise ValueError('Missing real species type source')
        fragment = source.record(species_path, 'SPECIES_' + species + '.types', 'selected-field', start + match.start(1), start + match.end(1), species_text)
        declarations.append('[SPECIES_' + species + '] = ' + fragment + ',\n')
    declarations.append('};\n')
    declarations.append('static const u8 sRoute1CatchRates[NUM_SPECIES] = {\n')
    for species in ('SQUIRTLE', 'PIDGEY', 'RATTATA'):
        start = species_text.index('    [SPECIES_' + species + '] =')
        end = species_text.index('\n    [', start + 1)
        match = re.search(r'\.catchRate\s*=\s*(\d+)', species_text[start:end])
        if match is None: raise ValueError('Missing source catch rate')
        fragment = source.record(species_path, 'SPECIES_' + species + '.catchRate', 'selected-field', start + match.start(1), start + match.end(1), species_text)
        declarations.append('[SPECIES_' + species + '] = ' + fragment + ',\n')
    declarations.append('};\n')
    (out / 'route1_source_declarations.inc').write_text(''.join(declarations), encoding='utf-8', newline='\n')

    functions = []
    for path, names in {
        'src/battle_script_commands.c': ('ChangeStatBuffs', 'Cmd_statbuffchange'),
        'src/battle_main.c': ('TryRunFromBattle',),
        'src/battle_util.c': ('GetImprisonedMovesCount', 'CheckMoveLimitations', 'AreAllMovesUnusable'),
    }.items():
        functions.extend(source.block(path, name, 'function') for name in names)
    path = 'src/battle_controller_opponent.c'
    text = source.read(path)
    fn = text.index('static void OpponentHandleChooseMove(void)\n{')
    start = text.index('        u16 move;', fn)
    end = text.index('\n    }\n}', start)
    branch = source.record(path, 'OpponentHandleChooseMove:ordinary-wild-else', 'selected-branch', start, end, text)
    source.fragments[-1]['transformation'] = 'Complete ordinary-wild else branch retained in SourceWildChoice wrapper; source controller transport validates target and returns selected slot.'
    functions.append('static u8 SourceWildChoice(void) {\n u8 chosenMoveId; const struct BattlePokemon *moveInfo = &gBattleMons[1];\n' + branch + '\n return chosenMoveId;\n}\n')
    (out / 'route1_source_functions.inc').write_text(''.join(functions) + item['functions'], encoding='utf-8', newline='\n')

    # The shared SetMoveEffect prefix is unchanged. Add only its original guards
    # and complete quarter-recoil case to the explicitly rejected secondary arm.
    path = 'src/battle_script_commands.c'
    text = source.read(path)
    start = text.index('\n    else\n    {\n        if (gBattleMons[gEffectBattler].status2 & sStatusFlagsForMoveEffects', text.index('void SetMoveEffect('))
    case_start = text.index('            case MOVE_EFFECT_RECOIL_25:', start)
    case_end = text.index('            case MOVE_EFFECT_ATK_PLUS_1:', case_start)
    prefix_end = text.index('            case MOVE_EFFECT_CONFUSION:', start)
    arm = source.record(path, 'SetMoveEffect:secondary-guards', 'selected-prefix', start, prefix_end, text)
    arm += source.record(path, 'SetMoveEffect:MOVE_EFFECT_RECOIL_25', 'complete-case', case_start, case_end, text)
    arm += '\n            default: Unexpected(); break;\n            }\n        }\n    }\n}\n'
    current = (out / 'source_functions.inc').read_text(encoding='utf-8')
    marker = '\n    else { Unexpected(); }\n}\n'
    if current.count(marker) != 1: raise ValueError('Shared SetMoveEffect rejection arm changed')
    current = current.replace(marker, arm)
    (out / 'source_functions.inc').write_text(current, encoding='utf-8', newline='\n')

    evidence = [item['evidence']]
    for name in ('BattleScript_EffectDefenseDown', 'BattleScript_EffectAccuracyDown', 'BattleScript_EffectStatDown',
                 'BattleScript_EffectRecoil', 'BattleScript_MoveEffectRecoil', 'BattleScript_DoRecoil'):
        evidence.append(source.script(name))
    for path, names in {
        'src/battle_main.c': ('TryDoEventsBeforeFirstTurn', 'HandleTurnActionSelectionState', 'HandleAction_UseMove', 'HandleAction_Run', 'VBlankCB_Battle'),
        'src/battle_util.c': ('TrySetCantSelectMoveBattleScript',),
    }.items():
        for name in names:
            evidence.append(source.block(path, name, 'function'))
            source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    (out / 'route1_source_evidence.txt').write_text(''.join(evidence), encoding='utf-8', newline='\n')
    for path in sorted((ROOT / 'tools/battle-route1/c').glob('*')):
        (out / path.name).write_bytes(path.read_bytes())
    (out / 'battle_spike.c').write_text('#define WATERBLUE_ROUTE1 1\n#include "adapter.h"\n#include "source_tables.inc"\n#include "source_functions.inc"\n#include "route1_source_functions.inc"\n#include "adapter.c"\n#include "attack.inc"\n#include "lifecycle.inc"\n#include "route1.inc"\n#include "items.inc"\n#include "checkpoint.inc"\n', encoding='utf-8', newline='\n')
    all_inputs = {row['path']: row for row in report['inputs']}
    all_inputs.update(source.inputs)
    report['sharedSyntheticBaseline'] = {key: report[key] for key in ('scope', 'transformations', 'supported', 'unsupported')}
    for fragment in report['fragments']:
        if fragment['name'] == 'SetMoveEffect:primary-status-prefix':
            fragment['transformation'] = 'Shared original guards and primary-status prefix retained; real profile adds only complete quarter-recoil secondary case. Primary poison is not admitted by the real profile.'
    report.update({'schemaVersion': 5, 'scope': 'private-firered-route1-singles-v2', 'status': 'private-mechanics-not-live-battle',
                   'inputs': [all_inputs[k] for k in sorted(all_inputs)],
                   'fragments': report['fragments'] + source.fragments,
                   'sharedCore': 'tools/battle-spike; WATERBLUE_ROUTE1 conditional profile, not a second arithmetic engine',
                   'supported': ['Real Squirtle/Pidgey/Rattata identities and true ability IDs', 'Shared source damage/accuracy/PP/critical/type commands',
                                 'Source Tail Whip/Sand-Attack stat commands and quarter recoil Struggle', 'Source wild move selection with PP rejection',
                                 'Mechanical intro ordering/selection draws; source escape attempts; logical checkpoint v3',
                                 'Source Potion living HP restoration and Poke Ball catch odds/shakes; private pending capture disposition'],
                   'unsupported': ['Live encounter/battle admission or persistence', 'Other items; owned capture/dex/nickname/storage continuation; progression/blackout', 'Party switching or additional real species/moves',
                                   'VBlank/frame-dependent RNG and original-ROM timeline equivalence', 'General statuses/items/abilities/weather/script interpreter']})
    report['transformations'] = [
        'Complete shared damage, type, accuracy, PP, critical, HP, ordering and lifecycle source functions remain unchanged. No GBA execution loop or full script interpreter is claimed.',
        'BattlePokemon and consulted battle structs retain source declarations; BattleStruct/party/controller storage remain audited headless projections, not encrypted original save records.',
        'Original HP/PP/status controller calls append typed events and acknowledge synchronously. Tail Whip/Sand-Attack source stat changes append stage events and source prevention records append ability events.',
        'Ability service queries answer only absent Pressure, Cloud Nine/Air Lock, absorbing and sport effects under the four admitted actual ability identities. Unsupported dependencies fail explicitly.',
        'The counted wrapper invokes the unchanged Random function exactly once per source request. At the exact safe-integer count limit, the real profile traps before advancing; returning a constant could otherwise hang source rejection loops. Host candidate isolation preserves the accepted state.',
        'Real profile conditionally extends shared admission and replaces synthetic type tokens with real source species type rows. Both profiles compile the same numerical command functions.',
        'Source secondary-effect guards and complete MOVE_EFFECT_RECOIL_25 case replace the real profile rejection arm; all other unadmitted effects still fail.',
        'Source ordinary wild controller branch runs behind bounded controller transport; zero-PP selection rejection repeats source choice without a usable-slot shortcut. Complete CheckMoveLimitations/AreAllMovesUnusable handle exhaustion.',
        'Mechanical intro calls source GetWhoStrikesFirst(ignoreChosenMoves=TRUE), then the shared selection cleanup/draw. Four admitted abilities/no items have no intro effects. VBlank presentation draws are excluded explicitly.',
        'Route1 logical checkpoint v3 retains 152 scalar words, true source species/abilities/noValidMoves, source u8 runTries and mechanical-intro state; tail words 150/151 record successful ball and shake result. Immutable identity and bounded bag remain in the strict host envelope.',
        'Potion retains the complete non-revive living guard and HP amount/update case suffix behind a Potion-only in-battle wrapper; source item table supplies 20. Party access projects active HP/maxHP. Cumulative item-use statistics and controller presentation are omitted scratch, not saved game statistics.',
        'Capture retains ordinary species catch-rate and standard-ball multiplier statements, complete odds/status arithmetic, and complete success/shake-result branch. An observational assignment records threshold without consuming RNG. Non-Poke-Ball, nonordinary battle or status contexts are rejected before execution.',
        'BIOS SWI 8 Sqrt is replaced by a bounded unsigned floor-integer square-root primitive; source call sites and operation order are unchanged. This is a documented primitive substitution, not execution of original BIOS code or emulator equivalence.',
        'Successful throw sets the source outcome value CAUGHT at the private settled-combat boundary before external dex/nickname/GiveMonToPlayer continuation. This explicit headless adaptation creates only a pending disposition, never an owned creature or durable grant. Source party-capacity check is represented by the strict one-player-creature/free-slot policy.',
        'The separately labeled sharedSyntheticBaseline is historical provenance, not the real profile admission policy. Other primary/secondary effects present in shared source text are not accepted mechanics for this real profile.',
    ]
    report['outputs'] = [{'path': str(path.relative_to(out)).replace('\\', '/'), 'bytes': path.stat().st_size, 'sha256': base.sha(path.read_bytes())}
                         for path in sorted(out.rglob('*')) if path.is_file() and path.name != 'extraction-manifest.json']
    report['buildScripts'] = [{'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': base.sha(path.read_bytes())}
                              for path in (BASE / 'extract.py', BASE / 'lifecycle_extract.py', Path(__file__), Path(__file__).with_name('item_extract.py'), Path(__file__).with_name('build.py'))]
    (out / 'extraction-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    extract(args.out.absolute())
