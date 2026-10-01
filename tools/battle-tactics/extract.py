"""Pinned five-move extension; every old profile keeps its default output."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('tactics_party_extract',ROOT/'tools/battle-party/extract.py')
party=importlib.util.module_from_spec(spec);spec.loader.exec_module(party)
base=party.base
replace=party.replace

def extract(out):
    party.extract(out,tactics=True)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    replace(out/'battle_spike.c','#define WATERBLUE_PARTY 1','#define WATERBLUE_TACTICS 1\n#define WATERBLUE_PARTY 1')
    replace(out/'battle_spike.c','#include "party_source_functions.inc"','#include "party_source_functions.inc"\n#include "tactics_source_functions.inc"')
    replace(out/'battle_spike.c','#include "party_checkpoint.inc"','#include "tactics.inc"\n#include "party_checkpoint.inc"')
    replace(out/'party_declarations.inc','static const struct {u8 knockedOffMons[2];} gWishFutureKnock;',
            'static struct {u8 knockedOffMons[2];u8 weatherDuration;} gWishFutureKnock;\n#include "tactics_declarations.inc"')
    replace(out/'adapter.h','    u8 turnEffectsTracker;','    u8 turnEffectsTracker,turnCountersTracker;\n    u8 battlerPartyIndexes[4],wrappedMove[8];')
    replace(out/'family.inc','case MOVE_AGILITY:case MOVE_FEATHER_DANCE:case MOVE_SCARY_FACE:case MOVE_FOCUS_ENERGY:case MOVE_STRUGGLE:return TRUE;',
            'case MOVE_SUPER_FANG:case MOVE_ENDEAVOR:case MOVE_RAPID_SPIN:case MOVE_RAIN_DANCE:case MOVE_WHIRLWIND:\n    case MOVE_AGILITY:case MOVE_FEATHER_DANCE:case MOVE_SCARY_FACE:case MOVE_FOCUS_ENERGY:case MOVE_STRUGGLE:return TRUE;')
    replace(out/'family.inc','sFamilyOrderReady=0;FamilyResetInputs();PartyReset();','sFamilyOrderReady=0;FamilyResetInputs();PartyReset();TacticsReset();')
    replace(out/'family.inc','static s32 FamilyAttack(u32 actor,u32 slot)','static s32 BaseFamilyAttack(u32 actor,u32 slot)')
    replace(out/'family.inc','    else if(effect==EFFECT_SPEED_DOWN_HIT)',
            '    else if(move==MOVE_RAPID_SPIN)gBattleCommunication[MOVE_EFFECT_BYTE]=MOVE_EFFECT_RAPIDSPIN|MOVE_EFFECT_AFFECTS_USER|MOVE_EFFECT_CERTAIN;\n    else if(effect==EFFECT_SPEED_DOWN_HIT)')
    replace(out/'family.inc','    Command();Cmd_seteffectwithchance();','    Command();Cmd_seteffectwithchance();\n    if(gBattlescriptCurrInstr==BattleScript_RapidSpinAway)Cmd_rapidspinfree();')
    replace(out/'lifecycle.inc','if (gBattleControllerExecFlags || gBattleTypeFlags || gBattleWeather || gBattleMons[actor].item != ITEM_NONE)',
            'if (gBattleControllerExecFlags || gBattleTypeFlags || !TacticsWeatherValid() || gBattleMons[actor].item != ITEM_NONE)')
    replace(out/'lifecycle.inc','    else Unexpected();\n}',
            '    else if(script==BattleScript_RainContinuesOrEnds) {} /* Timer/message already executed by the source case. */\n    else Unexpected();\n}')
    p=out/'checkpoint.inc'
    replace(p,'#define SPIKE_CHECKPOINT_VERSION 5','#define SPIKE_CHECKPOINT_VERSION 6')
    replace(p,'|| (words[8] > B_OUTCOME_RAN && words[8] != B_OUTCOME_CAUGHT)',
            '|| (words[8] > B_OUTCOME_PLAYER_TELEPORTED && words[8] != B_OUTCOME_CAUGHT)')
    replace(p,'if (words[8] > B_OUTCOME_RAN','if (words[8] > B_OUTCOME_PLAYER_TELEPORTED')
    # All terminal special outcomes have both sides alive; forced escape also
    # requires its active user/target alive (post-faint Run can have HP0).
    text=p.read_text();text=text.replace('words[8] == B_OUTCOME_RAN || words[8] == B_OUTCOME_CAUGHT','words[8] == B_OUTCOME_RAN || words[8] == B_OUTCOME_PLAYER_TELEPORTED || words[8] == B_OUTCOME_CAUGHT')
    text=text.replace('        && words[8] != B_OUTCOME_CAUGHT','        && words[8] != B_OUTCOME_PLAYER_TELEPORTED && words[8] != B_OUTCOME_CAUGHT')
    text=text.replace('|| gBattleTypeFlags || gBattleWeather || gBattleControllerExecFlags || gDynamicBasePower','|| gBattleTypeFlags || !TacticsWeatherValid() || gBattleControllerExecFlags || gDynamicBasePower')
    p.write_text(text,encoding='utf-8',newline='\n')
    p=out/'party_checkpoint.inc'
    replace(p,'w[482]=sPartyFaintMask;}','w[482]=sPartyFaintMask;w[483]=gBattleWeather;w[484]=gWishFutureKnock.weatherDuration;}')
    replace(p,' for(u32 j=483;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;',
            ' if(w[483]==0?w[484]!=0:(w[483]!=B_WEATHER_RAIN_TEMPORARY||w[484]<1||w[484]>5))return SPIKE_UNSUPPORTED;\n'
            ' if((w[3]==0||w[3]==2)&&w[484]>4)return SPIKE_INVALID_ARGUMENT;\n'
            ' if(w[8]==B_OUTCOME_PLAYER_TELEPORTED&&(!w[17]||!w[65]||w[13]!=MOVE_WHIRLWIND))return SPIKE_INVALID_ARGUMENT;\n'
            ' if(w[8]==B_OUTCOME_PLAYER_TELEPORTED){bool8 used=FALSE;for(u32 actor=0;actor<2;actor++){const u32 *r=w+16+48*actor;u32 slot=w[11+actor];\n'
            '  if(w[9+actor]==B_ACTION_USE_MOVE&&r[22+slot]==MOVE_WHIRLWIND&&r[26+slot]<FamilyMaxPP(MOVE_WHIRLWIND,w[152+actor],slot))used=TRUE;}\n'
            '  if(!used)return SPIKE_INVALID_ARGUMENT;}\n'
            ' for(u32 j=485;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;')
    replace(p,' gBattlerPartyIndexes[0]=sPartyActive;gBattlerPartyIndexes[1]=0;',
            ' gBattlerPartyIndexes[0]=sPartyActive;gBattlerPartyIndexes[1]=0;gBattleWeather=w[483];gWishFutureKnock.weatherDuration=w[484];')
    # Complete fixed-damage/weather/force-out/cleanup numerical source bodies.
    funcs=[source.macro('include/battle_message.h','B_BUFF_MOVE')]
    for n in ('Cmd_damagetohalftargethp','Cmd_setdamagetohealthdifference','Cmd_adjustsetdamage','Cmd_setrain','TryDoForceSwitchOut','Cmd_rapidspinfree'):
        funcs.append(source.block('src/battle_script_commands.c',n,'function'))
    text=source.read('src/battle_util.c');a=text.index('        case ENDTURN_RAIN:');b=text.index('        case ENDTURN_SANDSTORM:',a)
    funcs += [source.enum_containing('src/battle_util.c','ENDTURN_RAIN'),
              'static void SourceTacticsRainEnd(void){u8 effect=0;gBattleStruct->turnCountersTracker=0;switch(ENDTURN_RAIN){\n'+
              source.record('src/battle_util.c','DoFieldEndTurnEffects:ENDTURN_RAIN','complete-case',a,b,text)+'}\n(void)effect;}\n']
    (out/'tactics_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    text=source.read('src/battle_script_commands.c');a=text.index('            case MOVE_EFFECT_RAPIDSPIN:',text.index('void SetMoveEffect('));b=text.index('            case MOVE_EFFECT_REMOVE_PARALYSIS:',a)
    replace(out/'source_functions.inc','            default: Unexpected(); break;',
            source.record('src/battle_script_commands.c','SetMoveEffect:MOVE_EFFECT_RAPIDSPIN','complete-case',a,b,text)+'            default: Unexpected(); break;')
    evidence=[]
    for n in ('BattleScript_EffectSuperFang','BattleScript_EffectEndeavor','BattleScript_EffectRapidSpin','BattleScript_EffectRainDance','BattleScript_MoveWeatherChange',
              'BattleScript_EffectRoar','BattleScript_SuccessForceOut','BattleScript_HitFromAtkAnimation','BattleScript_RapidSpinAway','BattleScript_RainContinuesOrEnds','BattleScript_ButItFailed'):
        evidence.append(source.script(n))
    for n in ('Cmd_forcerandomswitch','Cmd_setprotectlike'):
        evidence.append(source.block('src/battle_script_commands.c',n,'function'))
    evidence.append(source.block('src/battle_script_commands.c','sProtectSuccessRates','table'))
    (out/'tactics_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-tactics/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={r['path']:r for r in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':8,'scope':'private-firered-family-tactics-v1','parentProfile':'firered-family-party-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'supported':['All party-profile mechanics plus SuperFang/Endeavor/RapidSpin/RainDance/Whirlwind',
                     'Source temporary rain setter/damage/expiry; generated by battle actions only',
                     'Source ordinary-wild forced escape outcome5; no trainer switching',
                     'Checkpoint6/512 retains rain flags+duration in reserved tail'],
        'unsupported':['Protect: source four-entry success-table OOB chain unresolved','SkullBash/Pursuit/MirrorMove','Other weather, held items, trapping/leechseed/spikes',
                       'Trainer/double battles, normal/live admission, durable outcomes and party reward pipelines']})
    report['transformations'] += ['New generated-profile seams reuse retained source arithmetic and preserve all nine old artifacts.',
        'Fixed damage schedules reproduce source PP/accuracy/type/fixed-value command order without normal critical/variance commands.',
        'RapidSpin retains certain secondary source case plus complete cleanup function; all nonempty cleanup contexts remain unadmitted.',
        'Complete ENDTURN_RAIN case runs once after source field order and before battler residuals; message/display callback becomes synchronous observation.',
        'Ordinary-wild Whirlwind uses full TryDoForceSwitchOut and exact successful script outcome5; trainer random replacement branch remains excluded.',
        'Stable512-word format advances to version6 and records weather/duration; other weather inputs remain rejected.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
