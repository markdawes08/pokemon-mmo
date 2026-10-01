"""Skull Bash profile over the retained source tactics/party kernel."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('charge_tactics_extract',ROOT/'tools/battle-tactics/extract.py')
tactics=importlib.util.module_from_spec(spec);spec.loader.exec_module(tactics)
base=tactics.base
replace=tactics.replace

def extract(out):
    tactics.extract(out,charge=True)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    replace(out/'battle_spike.c','#define WATERBLUE_TACTICS 1','#define WATERBLUE_CHARGE 1\n#define WATERBLUE_TACTICS 1')
    replace(out/'battle_spike.c','#include "tactics_source_functions.inc"','#include "tactics_source_functions.inc"\n#include "charge_source_functions.inc"')
    replace(out/'battle_spike.c','#include "party_checkpoint.inc"','#include "charge.inc"\n#include "party_checkpoint.inc"')
    with (out/'tactics_declarations.inc').open('a',encoding='utf-8',newline='\n') as f:f.write('\n#include "charge_declarations.inc"\n')
    replace(out/'adapter.h','    u8 battlerPartyIndexes[4],wrappedMove[8];','    u8 battlerPartyIndexes[4],wrappedMove[8],moveTarget[4];')
    replace(out/'family.inc','case MOVE_SUPER_FANG:','case MOVE_SKULL_BASH:case MOVE_SUPER_FANG:')
    replace(out/'family.inc','PartyReset();TacticsReset();','PartyReset();TacticsReset();ChargeReset();')
    p=out/'family.inc'
    replace(p,'    if(!FamilyMoveAllowed(move)||(!struggle&&!gBattleMons[actor].pp[slot]))return Fail(SPIKE_UNSUPPORTED);',
        '    bool8 release=move==MOVE_SKULL_BASH&&ChargeActive(actor);\n'
        '    if(!FamilyMoveAllowed(move)||(!struggle&&!release&&!gBattleMons[actor].pp[slot]))return Fail(SPIKE_UNSUPPORTED);')
    replace(p,'    if(!selfStat&&!targetStat&&!focus){','    if(!selfStat&&!targetStat&&!focus&&!(move==MOVE_SKULL_BASH&&!release)){')
    replace(p,'    if(!selfStat&&!focus)Accuracy();Command();Cmd_ppreduce();',
        '    if(move==MOVE_SKULL_BASH){if(!release)return ChargeFirstTurn(actor,target);ChargeClearForRelease(actor);}\n'
        '    if(!selfStat&&!focus)Accuracy();Command();Cmd_ppreduce();')
    p=out/'route1.inc'
    replace(p,'    sStatus = SPIKE_OK; gActiveBattler = 1;',
        '    if(ChargeActive(1))return ChargeSlotValid(1,gBattleStruct->chosenMovePositions[1])?gBattleStruct->chosenMovePositions[1]:-SPIKE_INVALID_ARGUMENT;\n'
        '    sStatus = SPIKE_OK; gActiveBattler = 1;')
    replace(p,'    u32 slots[2] = {playerSlot, wildSlot};',
        '    if(ChargeActive(0)&&actionKind)return -SPIKE_INVALID_ARGUMENT;\n    u32 slots[2] = {playerSlot, wildSlot};')
    replace(p,'        u8 all = CheckMoveLimitations(actor, 0, MOVE_LIMITATIONS_ALL) == ALL_MOVES_MASK;',
        '        if(ChargeActive(actor)){if(!ChargeSlotValid(actor,slots[actor]))return -SPIKE_INVALID_ARGUMENT;continue;}\n'
        '        u8 all = CheckMoveLimitations(actor, 0, MOVE_LIMITATIONS_ALL) == ALL_MOVES_MASK;')
    replace(p,'        else AreAllMovesUnusable();','        else if(ChargeActive(actor))gProtectStructs[actor].noValidMoves=0;\n        else AreAllMovesUnusable();')
    replace(p,'    if (!Route1AbilityPair()) return -SPIKE_UNSUPPORTED;',
        '    if(ChargeActive(actor))return -SPIKE_INVALID_ARGUMENT;\n    if (!Route1AbilityPair()) return -SPIKE_UNSUPPORTED;')
    replace(p,'    return FamilyAttack(actor, slot);',
        '    if(ChargeActive(actor)&&!ChargeSlotValid(actor,slot))return Fail(SPIKE_INVALID_ARGUMENT);\n    return FamilyAttack(actor, slot);')
    replace(out/'party.inc',' s32 ready=LifecycleReady(0);if(ready)return ready;',
        ' if(ChargeActive(0))return Fail(SPIKE_INVALID_ARGUMENT);\n s32 ready=LifecycleReady(0);if(ready)return ready;')
    # Complete source effect commands; all arithmetic/stat caps remain original.
    funcs=[]
    for name in ('Cmd_seteffectprimary','Cmd_clearstatusfromeffect'):
        funcs.append(source.block('src/battle_script_commands.c',name,'function'))
    (out/'charge_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    text=source.read('src/battle_script_commands.c');a=text.index('            case MOVE_EFFECT_CHARGING:',text.index('void SetMoveEffect('));b=text.index('            case MOVE_EFFECT_WRAP:',a)
    replace(out/'source_functions.inc','            default: Unexpected(); break;',
        source.record('src/battle_script_commands.c','SetMoveEffect:MOVE_EFFECT_CHARGING','complete-case',a,b,text)+'            default: Unexpected(); break;')
    p=out/'checkpoint.inc'
    replace(p,'#define SPIKE_CHECKPOINT_VERSION 6','#define SPIKE_CHECKPOINT_VERSION 7')
    replace(p,'if (mon[11] & ~STATUS2_FOCUS_ENERGY)','if (mon[11] & ~(STATUS2_FOCUS_ENERGY|STATUS2_MULTIPLETURNS))')
    p=out/'party_checkpoint.inc'
    replace(p,'w[484]=gWishFutureKnock.weatherDuration;}',
        'w[484]=gWishFutureKnock.weatherDuration;for(u32 actor=0;actor<2;actor++){w[485+actor]=gLockedMoves[actor];w[487+actor]=gProtectStructs[actor].chargingTurn;w[489+actor]=gBattleStruct->moveTarget[actor];}}')
    replace(p,' for(u32 j=485;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;',
        ' s32 charge=ChargeValidateCheckpoint(w);if(charge)return charge;\n for(u32 j=491;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;')
    replace(p,'gWishFutureKnock.weatherDuration=w[484];',
        'gWishFutureKnock.weatherDuration=w[484];for(u32 actor=0;actor<2;actor++){gLockedMoves[actor]=w[485+actor];gProtectStructs[actor].chargingTurn=w[487+actor];gBattleStruct->moveTarget[actor]=w[489+actor];}')
    evidence=[]
    for name in ('BattleScript_EffectSkullBash','BattleScript_SkullBashEnd','BattleScriptFirstChargingTurn','BattleScript_TwoTurnMovesSecondTurn','BattleScript_HitFromAccCheck','BattleScript_MoveUsedFlinched'):
        evidence.append(source.script(name))
    for path,names in {'src/battle_main.c':('HandleTurnActionSelectionState','HandleAction_UseMove','TurnValuesCleanUp','HandleAction_ActionFinished','SwitchInClearSetData','FaintClearSetData'),
        'src/battle_script_commands.c':('Cmd_attackcanceler','Cmd_ppreduce'),
        'src/battle_util.c':('CancelMultiTurnMoves','AtkCanceller_UnableToUseMove')}.items():
        evidence.extend(source.block(path,n,'function') for n in names)
    (out/'charge_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-charge/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={r['path']:r for r in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':9,'scope':'private-firered-family-charge-v1','parentProfile':'firered-family-tactics-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'supported':['Retained eight-species party/weather mechanics plus SkullBash:22 family moves and automatic Struggle',
            'Source charging primary effect,Defense stat command,clearstatus release and no-second-PP hit pipeline',
            'Forced player acknowledgement and no-RNG wild locked selection; flinch/switch/faint charge lifecycle',
            'Checkpoint7/512 stores source lock,chargingTurn and target; inert stale lockedMove preserved'],
        'unsupported':['Protect,Pursuit,MirrorMove','Other charging moves,held items,statuses,weather,hazards,trainer/double battles',
            'Live admission,durable ownership and party-aware result application']})
    report['transformations'] += ['New charge profile optional extraction seams preserve all ten prior WASM outputs.',
        'Source script first turn uses complete SetMoveEffect charging case and original stat command; second turn uses complete clearstatus command followed by retained hit pipeline with NO_PPDEDUCT.',
        'Source forced USE_MOVE selection becomes an explicit sequence-fenced host acknowledgement; no menu choices or wild selection RNG while locked.',
        'Source opponent target uses stable two-battler positions; retained target remains the opposing actor when its party member is replaced.',
        'Persistent MULTIPLETURNS and inert gLockedMoves are distinct; source flinch/switch/faint and protect-struct turn cleanup are unchanged.',
        'Checkpoint7 retains six added tail words for two locked moves,chargingTurn flags and remembered targets; all other tail words remain reserved.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
