"""Ordinary-wild Pursuit over the retained source Protect/party kernel."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('pursuit_protect_extract',ROOT/'tools/battle-protect/extract.py')
protect=importlib.util.module_from_spec(spec);spec.loader.exec_module(protect)
base=protect.base
replace=protect.replace

def extract(out):
    protect.extract(out,pursuit=True)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    replace(out/'battle_spike.c','#define WATERBLUE_PROTECT 1','#define WATERBLUE_PURSUIT 1\n#define WATERBLUE_PROTECT 1')
    replace(out/'battle_spike.c','#include "protect_source_functions.inc"','#include "protect_source_functions.inc"\n#include "pursuit_source_functions.inc"')
    replace(out/'battle_spike.c','#include "party_checkpoint.inc"','#include "pursuit.inc"\n#include "party_checkpoint.inc"')
    with (out/'protect_declarations.inc').open('a',encoding='utf-8',newline='\n') as f:f.write('\n#include "pursuit_declarations.inc"\n')
    replace(out/'family.inc','ChargeReset();ProtectReset();','ChargeReset();ProtectReset();PursuitReset();')
    replace(out/'family.inc','case MOVE_PROTECT:','case MOVE_PURSUIT:case MOVE_PROTECT:')
    replace(out/'checkpoint.inc','#define SPIKE_CHECKPOINT_VERSION 8','#define SPIKE_CHECKPOINT_VERSION 9')
    replace(out/'checkpoint.inc','if(sProtectPending)return SPIKE_NOT_READY;','if(sProtectPending||sPursuitPending||sPursuitConsumed)return SPIKE_NOT_READY;')
    replace(out/'protect.inc','if(sProtectPending)return Fail(SPIKE_NOT_READY);','if(sProtectPending||sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);')
    replace(out/'attack.inc','if(sProtectPending)return Fail(SPIKE_NOT_READY);','if(sProtectPending||sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);')
    replace(out/'family.inc','s32 family_choose_wild(void){','s32 family_choose_wild(void){if(sPursuitPending||sPursuitConsumed)return -SPIKE_NOT_READY;')
    replace(out/'family.inc','if(sProtectPending)return -SPIKE_NOT_READY;','if(sProtectPending||sPursuitPending||sPursuitConsumed)return -SPIKE_NOT_READY;')
    p=out/'party.inc'
    # Reconstruct order normally, but only a completed switch may enter field
    # effects and clear its consumed-action marker.
    text=p.read_text().replace('if(sProtectPending)return -SPIKE_NOT_READY;',
        'if(sProtectPending||sPursuitPending)return -SPIKE_NOT_READY;')
    p.write_text(text,encoding='utf-8',newline='\n')
    replace(p,'s32 party_order(u32 slot0,u32 slot1,u32 action){','s32 party_order(u32 slot0,u32 slot1,u32 action){if(sPursuitConsumed)return -SPIKE_NOT_READY;')
    replace(p,' TurnValuesCleanUp(TRUE);sStatus=SPIKE_OK;',' PursuitFieldBegin();TurnValuesCleanUp(TRUE);sStatus=SPIKE_OK;')
    replace(p,'s32 party_switch(u32 index,u32 forced){',
        's32 party_switch(u32 index,u32 forced){if((sPursuitPending&&!sPursuitCompleting)||(!forced&&!sPursuitCompleting))return Fail(SPIKE_NOT_READY);')
    replace(p,'(sPartyPhase||!gBattleMons[0].hp||!sFamilyOrderReady||gChosenActionByBattler[0]!=B_ACTION_SWITCH)',
        '(sPartyPhase||(!gBattleMons[0].hp&&!sPursuitCompleting)||!sFamilyOrderReady||gChosenActionByBattler[0]!=B_ACTION_SWITCH)')
    replace(p,'if(!forced)SourcePartyCountSwitch();','if(!forced&&!sPursuitCompleting)SourcePartyCountSwitch();')
    replace(p,'s32 party_replacement_begin(u32 phase){','s32 party_replacement_begin(u32 phase){if(sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);')
    replace(out/'tactics.inc','s32 tactics_field_end_turn(void){','s32 tactics_field_end_turn(void){if(sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);')
    for signature in ('s32 spike2_residual(u32 actor)','s32 spike2_check_teams_lost(void)'):
        replace(out/'lifecycle.inc',signature+'\n{',signature+'\n{\n    if(sPursuitPending||sPursuitConsumed)return Fail(SPIKE_NOT_READY);')
    # Complete source eligibility command. It intentionally has no trainer
    # condition: ordinary wild selection stores chosen move and target too.
    funcs=[source.macro('include/battle.h','B_ACTION_TRY_FINISH'),
        source.block('src/battle_script_commands.c','Cmd_jumpifnopursuitswitchdmg','function')]
    (out/'pursuit_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    evidence=[]
    for name in ('BattleScript_ActionSwitch','BattleScript_PursuitSwitchDmgSetMultihit','BattleScript_PursuitSwitchDmgLoop',
        'BattleScript_DoSwitchOut','BattleScript_PursuitDmgOnSwitchOut',
        'BattleScript_EffectHit','BattleScript_HitFromAccCheck','BattleScript_MoveEnd'):
        evidence.append(source.script(name))
    for path,names in {'src/battle_script_commands.c':('Cmd_pursuitdoubles','Cmd_damagecalc','Cmd_tryfaintmon','Cmd_getexp','Cmd_moveend'),
        'src/battle_main.c':('HandleTurnActionSelectionState','HandleAction_Switch','HandleAction_TryFinish','HandleAction_ActionFinished'),
        'src/battle_controller_opponent.c':('OpponentHandleChooseMove',),
        'src/battle_ai_switch_items.c':('AI_TrySwitchOrUseItem',)}.items():
        evidence.extend(source.block(path,n,'function') for n in names)
    # Record the unchanged effect dispatch and complete move data separately
    # from the shared all-move table, making this added closure inspectable.
    text=source.read('data/battle_scripts_1.s');a=text.index('\t.4byte BattleScript_EffectHit                    @ EFFECT_PURSUIT');b=text.index('\n',a)
    evidence.append(source.record('data/battle_scripts_1.s','EFFECT_PURSUIT:normal-hit dispatch','selected-dispatch',a,b,text))
    text=source.read('src/data/battle_moves.h');a=text.index('    [MOVE_PURSUIT] =');b=text.index('\n    [',a+1)
    evidence.append(source.record('src/data/battle_moves.h','MOVE_PURSUIT','complete-table-entry',a,b,text))
    (out/'pursuit_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-pursuit/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={r['path']:r for r in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':11,'scope':'private-firered-family-pursuit-v1','parentProfile':'firered-family-protect-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'supported':['Retained source Protect/charge/party/weather mechanics plus Pursuit:24 family moves and automatic Struggle',
            'Ordinary wild Pursuit intercepts player voluntary switching through complete source eligibility command',
            'Original script PP/critical/doubled post-base damage/type/variance/HP order, no interception accuracy or secondary roll',
            'Outgoing KO friendship/cleanup then original selected switch, consumed wild action and incoming residuals',
            'Checkpoint9/512 retains existing logical fields; partial switch transactions cannot be exported'],
        'unsupported':['MirrorMove','Trainer/double interception, opposing party switching, other abilities/items/statuses',
            'Full move-end interpreter, live admission, durable ownership and party-aware result application']})
    report['transformations'] += [
        'New Pursuit optional extraction seam preserves twelve prior WASM outputs; firered-protect-rom-v1 policy and original policy file are reused unchanged.',
        'Ordinary-wild source controller selection and ActionSwitch eligibility are retained: trainer-only AI switching does not exclude wild Pursuit interception.',
        'Source ActionSwitch is an atomic prepare/optional-faint-cleanup/complete transport. It retains the selected incoming index even if interception KOs the outgoing player; source friendship applies once and player-side getexp skips reward.',
        'Interception executes existing original numerical commands with source dmgMultiplier2 after base damage, skips accuracy/attackcanceler/secondary as the source script does, and consumes the queued wild action.',
        'Limited interception move-end range3..6 has no active admitted ability/item effect and does not update resulting-move history. Full normal Pursuit follows the retained EffectHit and after-faint history pipeline.',
        'Selected move/action/target scratch is reconstructed from validated source order; interception transaction and consumed-action marker must clear before settled checkpoints. No extra serialized tail state is required; version9 still has512words.',
        'Interception observation baseDamage is source CalculateBaseDamage before critical/dmgMultiplier; afterCritical includes both source factors. These divisions are diagnostic extraction, not gameplay arithmetic.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
