"""Source Protect commands with an explicit, separately pinned ROM lookup policy."""
from __future__ import annotations
import argparse
import importlib.util
import json
import re
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('protect_charge_extract',ROOT/'tools/battle-charge/extract.py')
charge=importlib.util.module_from_spec(spec);spec.loader.exec_module(charge)
base=charge.base
replace=charge.replace
COMPILED={
 'pokefirered.gba':(16777216,'3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac'),
 'pokefirered.elf':(14641332,'bbe723fd5723f311f45b1d5db7a71e9f0284dd54f57ab0f700162d7a88346b5e'),
 'pokefirered.map':(2417480,'d51ffb4bef90ac2c8b4af2e15e3c5505411171a0777d7a127665be1a345acbdf'),
 'build/firered/src/battle_script_commands.o':(151300,'67f7b117b98855694b85009cf4c4c309aacf9325a70ccc040aba6bb3018380ba'),
}

def extract(out):
    charge.extract(out,protect=True)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    policy_path=ROOT/'tools/battle-protect/protect-policy.json'
    policy=json.loads(policy_path.read_text())
    expected={'id':'firered-protect-rom-v1','romSha256':COMPILED['pokefirered.gba'][1],
              'tableSha256':'977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1',
              'tableOffset':0x2507e0,'tableEntries':256}
    if policy!=expected:raise RuntimeError('Protect policy differs from the explicitly versioned compiled policy')
    compiled=[];rom=None
    for path,(size,digest) in COMPILED.items():
        target=(source.reference/path).resolve()
        if not target.is_relative_to(source.reference.resolve()):raise RuntimeError('Redirected compiled reference')
        data=target.read_bytes()
        if len(data)!=size or base.sha(data)!=digest:raise RuntimeError('Separately pinned compiled artifact differs: '+path)
        compiled.append({'path':path,'bytes':size,'sha256':digest,'includedInSourceFingerprint':False})
        if path=='pokefirered.gba':rom=data
    table=rom[policy['tableOffset']:policy['tableOffset']+512]
    if base.sha(table)!=policy['tableSha256']:raise RuntimeError('Protect ROM lookup range differs')
    values=struct.unpack('<256H',table)
    original=source.block('src/battle_script_commands.c','sProtectSuccessRates','table')
    rates=original.split('{',1)[1].split('}',1)[0]
    if re.sub(r'\s+','',rates)!='USHRT_MAX,USHRT_MAX/2,USHRT_MAX/4,USHRT_MAX/8':raise RuntimeError('Unexpected source rate expressions')
    first=tuple(65535//d for d in (1,2,4,8))
    if values[:4]!=first or first!=(65535,32767,16383,8191):raise RuntimeError('Protect first four source constants differ from ROM')
    (out/'protect-policy.json').write_text(json.dumps(policy,indent=2)+'\n',encoding='utf-8',newline='\n')
    (out/'protect_rates.inc').write_text('/* firered-protect-rom-v1: bounded LE u16 ROM range, not C object adjacency. */\n'
        'static const u16 sProtectSuccessRates[256]={\n'+',\n'.join(','.join(map(str,values[i:i+16])) for i in range(0,256,16))+'\n};\n',encoding='utf-8',newline='\n')
    replace(out/'battle_spike.c','#define WATERBLUE_CHARGE 1','#define WATERBLUE_PROTECT 1\n#define WATERBLUE_CHARGE 1')
    replace(out/'battle_spike.c','#include "charge_source_functions.inc"','#include "charge_source_functions.inc"\n#include "protect_source_functions.inc"')
    replace(out/'battle_spike.c','#include "party_checkpoint.inc"','#include "protect.inc"\n#include "party_checkpoint.inc"')
    with (out/'charge_declarations.inc').open('a',encoding='utf-8',newline='\n') as f:f.write('\n#include "protect_declarations.inc"\n')
    replace(out/'family.inc','PartyReset();TacticsReset();ChargeReset();','PartyReset();TacticsReset();ChargeReset();ProtectReset();')
    replace(out/'family.inc','case MOVE_SKULL_BASH:','case MOVE_PROTECT:case MOVE_SKULL_BASH:')
    replace(out/'tactics.inc','static s32 FamilyAttack(u32 actor,u32 slot)','static s32 UnprotectedFamilyAttack(u32 actor,u32 slot)')
    # The original attack-canceller flinch branch runs first; this admitted
    # obedience/protection branch then precedes every effect script command.
    flinch='if(SourceFamilyTryFlinch()){Emit(8,actor,gBattleMons[actor].status2);Emit(9,actor,1);return sStatus;}'
    for name in ('family.inc','tactics.inc'):
        replace(out/name,flinch,flinch+'\n Command();ProtectCanceller();')
    p=out/'family.inc'
    replace(p,'    bool8 focus=move==MOVE_FOCUS_ENERGY;','    bool8 focus=move==MOVE_FOCUS_ENERGY,protect=move==MOVE_PROTECT;')
    replace(p,'if(!selfStat&&!targetStat&&!focus&&','if(!selfStat&&!targetStat&&!focus&&!protect&&')
    replace(p,'gBattlerTarget=(selfStat||focus)?actor:target;','gBattlerTarget=(selfStat||focus||protect)?actor:target;')
    replace(p,'if(!selfStat&&!focus)Accuracy();','if(!selfStat&&!focus&&!protect)Accuracy();')
    replace(p,'    if(focus){','    if(protect){Command();Cmd_setprotectlike();return sStatus;}\n    if(focus){')
    replace(out/'tactics.inc','Suction Cups/rooting/Protect/airborne states cannot enter this profile.','Suction Cups/rooting/airborne states cannot enter this profile; Protect is checked by both source preflights.')
    # Preserve an atomic source attack through its deferred history step.
    replace(out/'party.inc','s32 party_order(u32 slot0,u32 slot1,u32 action){','s32 party_order(u32 slot0,u32 slot1,u32 action){if(sProtectPending)return -SPIKE_NOT_READY;')
    replace(out/'party.inc','s32 party_residual_order(void){','s32 party_residual_order(void){if(sProtectPending)return -SPIKE_NOT_READY;')
    replace(out/'party.inc',' sStatus=SPIKE_OK;u32 first=GetWhoStrikesFirst(0,1,FALSE);',' TurnValuesCleanUp(TRUE);sStatus=SPIKE_OK;u32 first=GetWhoStrikesFirst(0,1,FALSE);')
    replace(out/'party.inc','s32 party_switch(u32 index,u32 forced){','s32 party_switch(u32 index,u32 forced){if(sProtectPending)return Fail(SPIKE_NOT_READY);')
    replace(out/'party.inc','s32 party_replacement_begin(u32 phase){','s32 party_replacement_begin(u32 phase){if(sProtectPending)return Fail(SPIKE_NOT_READY);')
    replace(out/'family.inc','s32 family_run(u32 actor){','s32 family_run(u32 actor){if(sProtectPending)return -SPIKE_NOT_READY;')
    replace(out/'attack.inc','s32 spike2_begin_turn(void)\n{','s32 spike2_begin_turn(void)\n{\n    if(sProtectPending)return Fail(SPIKE_NOT_READY);')
    # New semantics are confined to the new version; all old default outputs
    # keep their existing source and logical format.
    p=out/'checkpoint.inc'
    replace(p,'#define SPIKE_CHECKPOINT_VERSION 7','#define SPIKE_CHECKPOINT_VERSION 8')
    replace(p,'!CheckpointMove(mon[43])','(mon[43]!=MOVE_UNAVAILABLE&&!CheckpointMove(mon[43]))')
    replace(p,'            || gProtectStructs[actor].protected || gProtectStructs[actor].endured','            || gProtectStructs[actor].endured')
    replace(p,'static s32 CheckpointContext(void)\n{','static s32 CheckpointContext(void)\n{\n    if(sProtectPending)return SPIKE_NOT_READY;')
    p=out/'party_checkpoint.inc'
    replace(p,'w[489+actor]=gBattleStruct->moveTarget[actor];','w[489+actor]=gBattleStruct->moveTarget[actor];w[491+actor]=gDisableStructs[actor].protectUses;w[493+actor]=gProtectStructs[actor].protected;')
    replace(p,' for(u32 j=491;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;',
        ' s32 protect=ProtectValidateCheckpoint(w);if(protect)return protect;\n for(u32 j=495;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;')
    replace(p,'gBattleStruct->moveTarget[actor]=w[489+actor];','gBattleStruct->moveTarget[actor]=w[489+actor];gDisableStructs[actor].protectUses=w[491+actor];gProtectStructs[actor].protected=w[493+actor];')
    text=source.read('src/battle_script_commands.c')
    a=text.index('    else if (DEFENDER_IS_PROTECTED',text.index('static void Cmd_attackcanceler(void)\n{'))
    b=text.index('\n}\n',a)
    canceller=source.record('src/battle_script_commands.c','Cmd_attackcanceler:protected branch','selected-branch',a,b,text)
    canceller=canceller.replace('    else if (DEFENDER_IS_PROTECTED','    if (DEFENDER_IS_PROTECTED',1)
    a=text.index('                if (gHitMarker & HITMARKER_OBEYS)',text.index('        case MOVEEND_UPDATE_LAST_MOVES:'))
    b=text.index('\n\n                if (!(gHitMarker & HITMARKER_FAINTED',a)
    history=source.record('src/battle_script_commands.c','Cmd_moveend:resulting-move history','selected-branch',a,b,text)
    history=history.replace('                    gLastMoves[gBattlerAttacker] = gChosenMove;\n','').replace('                    gLastMoves[gBattlerAttacker] = MOVE_UNAVAILABLE;\n','')
    funcs=['#include "protect_rates.inc"\n',source.block('src/battle_script_commands.c','IsTwoTurnsMove','function'),
        source.block('src/battle_script_commands.c','Cmd_setprotectlike','function'),
        'static void ProtectCanceller(void){\n gHitMarker |= HITMARKER_OBEYS;\n'+canceller+'}\n',
        'static void SourceProtectMoveEnd(void){\n'+history+'}\n']
    (out/'protect_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    evidence=[original,source.script('BattleScript_EffectProtect'),source.script('BattleScript_EffectEndure'),source.script('BattleScript_SuccessForceOut')]
    for path,names in {'src/battle_script_commands.c':('Cmd_attackcanceler','Cmd_moveend','Cmd_accuracycheck','Cmd_ppreduce'),
        'src/battle_main.c':('TurnValuesCleanUp','BattleTurnPassed','SwitchInClearSetData','FaintClearSetData')}.items():
        evidence.extend(source.block(path,n,'function') for n in names)
    (out/'protect_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-protect/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={r['path']:r for r in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':10,'scope':'private-firered-family-protect-v1','parentProfile':'firered-family-charge-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'protectPolicy':policy,'compiledPolicyEvidence':{'artifacts':compiled,'auditReport':'reports/protect-source-audit.json',
            'auditReportSha256':base.sha((ROOT/'reports/protect-source-audit.json').read_bytes()),'firstFourSourceRates':list(first),
            'romBuildVerified':False,'policyNote':'Explicit compiled-ROM continuation beyond a four-element source C object; not portable C semantics or emulator equivalence.'},
        'supported':['Retained charge/party/weather profile plus Protect:23 family moves and automatic Struggle',
            'Complete source Protect command with separately pinned bounded256-entry compiled-ROM lookup policy',
            'Source protection attack-canceller branch, accuracy blocking and after-faint resulting-move history',
            'Checkpoint8/512 retains protectUses/protected plus existing resulting-move row43'],
        'unsupported':['Pursuit,MirrorMove','Detect,Endure,other abilities/items/statuses/weather or battle types',
            'Live admission,durable ownership,party-aware result application and complete move-end interpreter']})
    report['transformations'] += [
        'New Protect optional extraction seam leaves all eleven old WASM outputs unchanged.',
        'firered-protect-rom-v1 substitutes the separately pinned256-entry LE ROM range for the four-element source C array. Source command, u8 wrapping, inclusive threshold and evaluation order remain retained; no undefined object overread or invented clamp.',
        'The selected admitted attack-canceller branch follows flinch and source obedience; disobedience and other excluded canceller branches remain inadmissible.',
        'Only future-read gLastResultingMoves from MOVEEND_UPDATE_LAST_MOVES is projected. It runs after source faint cleanup via explicit protect_move_end; successful ordinary-wild Whirlwind skips history. This is not a full move-end/history interpreter.',
        'Complete TurnValuesCleanUp(TRUE) runs on entry to field effects before residual ordering; protected resets while protectUses persists.',
        'Checkpoint8 adds four tail words491..494; atomic attack continuation scratch must be completed before any settled checkpoint.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'),policy_path)]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
