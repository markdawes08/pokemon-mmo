"""Private party extension of the preserved source numerical kernel."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('party_family_extract',ROOT/'tools/battle-family/extract.py')
family=importlib.util.module_from_spec(spec);spec.loader.exec_module(family)
base=family.base

def replace(path,old,new):
    text=path.read_text(encoding='utf-8')
    if text.count(old)!=1:raise ValueError('Changed party extension seam: '+str(path.name)+' '+old[:80])
    path.write_text(text.replace(old,new),encoding='utf-8',newline='\n')

def extract(out, *, tactics=False, charge=False, protect=False):
    family.extract(out,party=True,tactics=tactics,charge=charge,protect=protect)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    # All changes below are to this new private build output, never old C.
    replace(out/'battle_spike.c','#define WATERBLUE_FAMILY 1','#define WATERBLUE_PARTY 1\n#define WATERBLUE_FAMILY 1')
    replace(out/'battle_spike.c','#include "adapter.c"','#include "party_source_functions.inc"\n#include "adapter.c"')
    replace(out/'battle_spike.c','#include "checkpoint.inc"','#include "party.inc"\n#include "party_checkpoint.inc"\n#include "checkpoint.inc"')
    with (out/'family_declarations.inc').open('a',encoding='utf-8',newline='\n') as f:f.write('\n#include "party_declarations.inc"\n')
    replace(out/'route1_declarations.inc','gBattleBufferB[4][4]','gBattleBufferB[4][4+sizeof(struct BattlePokemon)]')
    replace(out/'family.inc','sFamilyOrderReady=0;FamilyResetInputs();','sFamilyOrderReady=0;FamilyResetInputs();PartyReset();')
    # Reuse exact source creature validation and permit source fainted party
    # records. Wild admission still explicitly requires positive HP.
    replace(out/'creature.c','||w[5]>255||!w[6]||w[6]>w[7]','||w[5]>255||(!w[6]&&w[36])||w[6]>w[7]')
    text=(out/'creature.c').read_text();a=text.index('static u32 sInput[2][46]')
    tail=text[a:].replace('[2]','[7]').replace('actor>=2','actor>=7').replace('FamilyApplyMon','PartyAdmit').replace('family_input_','party_input_').replace('family_mon_get','party_mon_get')
    text=text[:a]+tail+'\n#include "creature-tail.inc"\n'
    text=text.replace('s32 FamilyApplyMon(u32,const u32 *,u32,u32,u32);','s32 FamilyApplyMon(u32,const u32 *,u32,u32,u32);\ns32 PartyAdmit(u32,const u32 *,u32,u32,u32);')
    text=text.replace('#include "constants/battle.h"','#include "constants/battle.h"\n#include "constants/trainers.h"')
    (out/'creature.c').write_text(text,encoding='utf-8',newline='\n')
    (out/'constants/trainers.h').write_text(source.read('include/constants/trainers.h'),encoding='utf-8',newline='\n')
    with (out/'creature_data.inc').open('a',encoding='utf-8',newline='\n') as f:f.write(source.block('src/pokemon.c','sFriendshipEventDeltas','table'))
    (out/'party_friendship.inc').write_text(source.block('src/pokemon.c','AdjustFriendship','function')+source.block('src/battle_util2.c','AdjustFriendshipOnBattleFaint','function'),encoding='utf-8',newline='\n')
    funcs=[]
    for p,names in {'src/battle_util.c':('ResetSentPokesToOpponentValue','OpponentSwitchInResetSentPokesToOpponentValue','UpdateSentPokesToOpponentValue'),
                    'src/battle_script_commands.c':('Cmd_switchindataupdate',)}.items():
        funcs.extend(source.block(p,n,'function') for n in names)
    text=source.read('src/battle_main.c');a=text.index('    if (gBattleResults.playerSwitchesCounter < 255)');b=text.index('\n',text.index('++gBattleResults.playerSwitchesCounter;',a))
    part=source.record('src/battle_main.c','HandleAction_Switch:counter','selected-statements',a,b,text).replace('gBattleResults.playerSwitchesCounter','sPartySwitches')
    funcs.append('static void SourcePartyCountSwitch(void){\n'+part+'\n}\n')
    text=source.read('src/battle_script_commands.c');a=text.index('            if (GetBattlerPosition(gActiveBattler) == B_POSITION_PLAYER_LEFT && gBattleResults.playerSwitchesCounter < 255)');b=text.index('\n',text.index('gBattleResults.playerSwitchesCounter++;',a))
    part=source.record('src/battle_script_commands.c','Cmd_openpartyscreen:counter','selected-statements',a,b,text).replace('gBattleResults.playerSwitchesCounter','sPartySwitches')
    funcs.append('static void SourcePartyCountForcedSwitch(void){\n'+part+'\n}\n')
    (out/'party_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    # Purely new checkpoint profile, with shared source battler serialization.
    p=out/'checkpoint.inc'
    replace(p,'#define SPIKE_CHECKPOINT_VERSION 4\n#define SPIKE_CHECKPOINT_WORDS 154','#define SPIKE_CHECKPOINT_VERSION 5\n#define SPIKE_CHECKPOINT_WORDS 512')
    replace(p,'if ((words[3] != 0 && words[3] != 3) || words[8] > B_OUTCOME_RAN','if (words[8] > B_OUTCOME_RAN')
    replace(p,'if (action != B_ACTION_USE_MOVE && action != B_ACTION_NONE && action != B_ACTION_RUN)','if (action != B_ACTION_USE_MOVE && action != B_ACTION_NONE && action != B_ACTION_RUN && action != B_ACTION_SWITCH)')
    replace(p,'&& (words[3] != 3 || !hp0 || !hp1)','&& (words[3] != 3 || !hp1)')
    replace(p,'if(row[0]!=(slot==0?words[16+side*48+30]:0)\n                ||row[1]!=(slot==0?words[16+side*48+1]:0)||row[2])return SPIKE_UNSUPPORTED;','/* Exact roster projection is checked by PartyValidateCheckpoint. */')
    replace(p,'    return SPIKE_OK;\n}\n\nstatic s32 CheckpointContext','    return PartyValidateCheckpoint(words);\n}\n\nstatic s32 CheckpointContext')
    replace(p,'    status = ValidateCheckpoint(words);','    PartyExport(words);\n    status = ValidateCheckpoint(words);')
    text=p.read_text();a=text.rfind('    return Fail(SPIKE_OK);');text=text[:a]+'    PartyImport(words);\n'+text[a:];p.write_text(text,encoding='utf-8',newline='\n')
    evidence=[]
    for path,names in {'src/battle_main.c':('SetActionsAndBattlersTurnOrder','HandleAction_Switch','HandleAction_TryFinish','BattleTurnPassed','UpdatePartyOwnerOnSwitch_NonMulti'),
        'src/battle_util.c':('HandleFaintedMonActions','DoFieldEndTurnEffects','DoBattlerEndTurnEffects','AbilityBattleEffects'),
        'src/battle_controllers.c':('SetBattlePartyIds',),
        'src/battle_script_commands.c':('Cmd_getswitchedmondata','Cmd_switchineffects','Cmd_switchoutabilities','Cmd_switchhandleorder','Cmd_jumpifplayerran','Cmd_cancelallactions','Cmd_tryfaintmon','Cmd_openpartyscreen'),
        'src/party_menu.c':('SwitchPartyMonSlots','GetPartyIdFromBattlePartyId')}.items():
        evidence.extend(source.block(path,n,'function') for n in names)
    for n in ('BattleScript_ActionSwitch','BattleScript_HandleFaintedMon','BattleScript_FaintedMonSendOutNew','BattleScript_DoTurnDmg'):
        evidence.append(source.script(n))
    (out/'party_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-party/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={row['path']:row for row in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':7,'scope':'private-firered-family-party-v1','parentProfile':'firered-family-singles-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'supported':['Player party1..6 versus one wild; first living initial actor','Sixteen moves and source abilities/status context inherited',
        'Voluntary switch, source faint friendship, replacement/use-next/escape, source roster persistence','Source entry data cleanup, participation mask and saturated switch counter','Checkpoint5/512 words'],
        'unsupported':['Live or durable outcomes','Other nine moves, Pursuit interception, Whirlwind, trapping, entry hazards','Trainer/double battles, held items, battle items','Reward/evolution/blackout continuation for party results','UI party presentation order and source controller/display clock']})
    report['transformations'] += ['New-profile-only generated seams preserve all prior compiled modules.','Controller REQUEST_ALL_BATTLE buffer is populated synchronously from source-validated full roster; complete Cmd_switchindataupdate derives ability/types and calls complete source cleanup.',
        'Complete source negative faint friendship functions execute once per new player faint; unsupported positive-event services trap.','Source display-only nickname preparation omitted; stable roster indices expose original party members rather than presentation-order nibble mapping.',
        'Source action/replacement/end-turn script schedule is bounded by explicit host decision boundaries, retaining selected positions and both RNG count words.','Source saturated playerSwitchesCounter storage projected into a logical byte; current source participation mask retained.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
