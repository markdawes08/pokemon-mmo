"""Bounded source Mirror Move dispatch over a private copy of Pursuit output.

No retained extractor or output directory is modified. The only new persistent
state is the four reachable singles Mirror Move history words.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('mirror_pursuit_extract',ROOT/'tools/battle-pursuit/extract.py')
pursuit=importlib.util.module_from_spec(spec);spec.loader.exec_module(pursuit)
base=pursuit.base
replace=pursuit.replace


def extract(out):
    pursuit.extract(out)
    report=json.loads((out/'extraction-manifest.json').read_text())
    source=base.Extraction()
    replace(out/'battle_spike.c','#define WATERBLUE_PURSUIT 1','#define WATERBLUE_MIRROR 1\n#define WATERBLUE_PURSUIT 1')
    replace(out/'battle_spike.c','#include "pursuit_source_functions.inc"','#include "pursuit_source_functions.inc"\n#include "mirror_source_functions.inc"')
    replace(out/'battle_spike.c','#include "party_checkpoint.inc"','#include "mirror.inc"\n#include "party_checkpoint.inc"')
    with (out/'pursuit_declarations.inc').open('a',encoding='utf-8',newline='\n') as f:f.write('\n#include "mirror_declarations.inc"\n')
    replace(out/'adapter.h','u8 dynamicMoveType, chosenMovePositions[4]', 'u8 absentBattlerFlags,dynamicMoveType, chosenMovePositions[4]')
    replace(out/'adapter.h','u16 lastTakenMoveFrom[4][4], choicedMove[4];', 'u8 lastTakenMoveFrom[32];u16 choicedMove[4];')
    replace(out/'family.inc','ProtectReset();PursuitReset();','ProtectReset();PursuitReset();MirrorReset();')
    replace(out/'family.inc','case MOVE_PURSUIT:','case MOVE_MIRROR_MOVE:case MOVE_PURSUIT:')
    # Effective script dispatch is separate from the original occupied PP slot.
    replace(out/'family.inc','u32 move=struggle?MOVE_STRUGGLE:gBattleMons[actor].moves[slot];','u32 move=MirrorActionMove(actor,slot);')
    replace(out/'tactics.inc','u32 move=slot==4?MOVE_STRUGGLE:gBattleMons[actor].moves[slot];','u32 move=MirrorActionMove(actor,slot);')
    # Copied Struggle pays Mirror PP but still runs the recoil effect schedule.
    replace(out/'family.inc','if(struggle)gBattleCommunication[MOVE_EFFECT_BYTE]', 'if(move==MOVE_STRUGGLE)gBattleCommunication[MOVE_EFFECT_BYTE]')
    replace(out/'family.inc','if(struggle&&gBattlescriptCurrInstr==sRecoilScript)', 'if(move==MOVE_STRUGGLE&&gBattlescriptCurrInstr==sRecoilScript)')
    replace(out/'protect.inc','static s32 FamilyAttack(u32 actor,u32 slot)', 'static s32 ProtectedFamilyAttack(u32 actor,u32 slot)')
    replace(out/'protect.inc','  SourceProtectMoveEnd();','  SourceProtectMoveEnd();MirrorMoveEnd();')
    replace(out/'protect.inc','   if(!known)return SPIKE_INVALID_ARGUMENT;',
        '   if(!known&&MirrorCopyable(m[43]))for(u32 i=0;i<4;i++)if(m[22+i]==MOVE_MIRROR_MOVE&&m[26+i]<FamilyMaxPP(MOVE_MIRROR_MOVE,w[152+actor],i))known=TRUE;\n   if(!known)return SPIKE_INVALID_ARGUMENT;')
    # Source locked-move dispatch retains the original Mirror slot for its
    # forced release, and source GetMoveTarget also writes noncharging targets.
    replace(out/'charge.inc','gBattleMons[actor].moves[slot]==MOVE_SKULL_BASH',
        '(gBattleMons[actor].moves[slot]==MOVE_SKULL_BASH||gBattleMons[actor].moves[slot]==MOVE_MIRROR_MOVE)')
    replace(out/'charge.inc','target!=(locked?(actor^1):0)',
        '(locked?target!=(actor^1):(target!=0&&target!=(actor^1)))')
    replace(out/'charge.inc','m[22+slot]!=MOVE_SKULL_BASH',
        '(m[22+slot]!=MOVE_SKULL_BASH&&m[22+slot]!=MOVE_MIRROR_MOVE)')
    replace(out/'charge.inc','FamilyMaxPP(MOVE_SKULL_BASH,w[152+actor],slot)',
        'FamilyMaxPP(m[22+slot],w[152+actor],slot)')
    replace(out/'checkpoint.inc','#define SPIKE_CHECKPOINT_VERSION 9','#define SPIKE_CHECKPOINT_VERSION 10')
    p=out/'party_checkpoint.inc'
    replace(p,'w[493+actor]=gProtectStructs[actor].protected;',
        'w[493+actor]=gProtectStructs[actor].protected;w[495+actor]=T1_READ_16(gBattleStruct->lastTakenMove+actor*2);w[497+actor]=T1_READ_16(gBattleStruct->lastTakenMoveFrom+actor*8+(actor^1)*2);')
    replace(p,'for(u32 j=495;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;',
        's32 mirror=MirrorValidateCheckpoint(w);if(mirror)return mirror;\n for(u32 j=499;j<512;j++)if(w[j])return SPIKE_INVALID_ARGUMENT;')
    replace(p,'gProtectStructs[actor].protected=w[493+actor];',
        'gProtectStructs[actor].protected=w[493+actor];gBattleStruct->lastTakenMove[actor*2]=w[495+actor];gBattleStruct->lastTakenMove[actor*2+1]=w[495+actor]>>8;gBattleStruct->lastTakenMoveFrom[actor*8+(actor^1)*2]=w[497+actor];gBattleStruct->lastTakenMoveFrom[actor*8+(actor^1)*2+1]=w[497+actor]>>8;')
    replace(p,'r[22+slot]==MOVE_WHIRLWIND&&r[26+slot]<FamilyMaxPP(MOVE_WHIRLWIND,w[152+actor],slot)',
        '(r[22+slot]==MOVE_WHIRLWIND||r[22+slot]==MOVE_MIRROR_MOVE)&&r[26+slot]<FamilyMaxPP(r[22+slot],w[152+actor],slot)')
    # Complete source Mirror command and GetMoveTarget, including singles
    # rejection-sampling RNG. Assembly effect destinations are pointer tags;
    # the existing source-C effect schedules execute after this source jump.
    scripts=source.read('data/battle_scripts_1.s')
    dispatch=[]
    for m in re.finditer(r'^\s*\.4byte (BattleScript_\w+)\s+@ (EFFECT_\w+)',scripts,re.M):
        dispatch.append((m.group(1),m.group(2)))
    if len(dispatch)<200:raise RuntimeError('Source effect dispatch table changed')
    tags='static const u8 sMirrorEffectTags[256][1]={{0}};\nstatic const u8 *const gBattleScriptsForMoveEffects[256]={\n'
    tags+=''.join('['+effect+']=sMirrorEffectTags['+effect+'], /* '+script+' */\n' for script,effect in dispatch)+'};\n'
    funcs=[source.macro('include/global.h','T1_READ_16'),source.macro('include/battle.h','NO_TARGET_OVERRIDE'),tags,
        source.block('src/battle_util.c','GetMoveTarget','function'),
        source.block('src/battle_script_commands.c','Cmd_trymirrormove','function')]
    text=source.read('src/battle_script_commands.c')
    a=text.index('            if (!(gAbsentBattlerFlags',text.index('        case MOVEEND_MIRROR_MOVE:'))
    b=text.index('            gBattleScripting.moveendState++;',a)
    history=source.record('src/battle_script_commands.c','Cmd_moveend:MOVEEND_MIRROR_MOVE','complete-selected-branch',a,b,text)
    funcs.append('static void SourceMirrorMoveEnd(void){\n u16 originallyUsedMove=gChosenMove==MOVE_UNAVAILABLE?MOVE_NONE:gChosenMove;\n'+history+'}\n')
    (out/'mirror_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    # The shared creature validator's PP table is intentionally projected, so
    # add the exact newly admitted table field as well as the battle whitelist.
    text=source.read('src/data/battle_moves.h');a=text.index('    [MOVE_MIRROR_MOVE] =');b=text.index('\n    [',a+1)
    entry=source.record('src/data/battle_moves.h','MOVE_MIRROR_MOVE','complete-table-entry',a,b,text)
    field=re.search(r'        \.pp = [^,]+,',text[a:b])
    pp=source.record('src/data/battle_moves.h','MIRROR_MOVE.pp','selected-field',a+field.start(),a+field.end(),text)
    replace(out/'creature_data.inc','static const struct {u8 pp;} gBattleMoves[MOVES_COUNT]={',
        'static const struct {u8 pp;} gBattleMoves[MOVES_COUNT]={\n[MOVE_MIRROR_MOVE]={'+pp+'},')
    evidence=[entry]
    for name in ('BattleScript_EffectMirrorMove','BattleScript_EffectSkullBash','BattleScript_SkullBashEnd',
                 'BattleScript_EffectRecoil','BattleScript_EffectHit','BattleScript_MoveEnd','BattleScript_ActionSwitch','BattleScript_DoSwitchOut'):
        evidence.append(source.script(name))
    for path,names in {'src/battle_script_commands.c':('Cmd_attackcanceler','Cmd_attackstring','Cmd_moveend','Cmd_tryfaintmon'),
        'src/battle_main.c':('HandleAction_UseMove','HandleAction_Switch','HandleAction_ActionFinished','SwitchInClearSetData','FaintClearSetData')}.items():
        evidence.extend(source.block(path,n,'function') for n in names)
    a=scripts.index('gBattleScriptsForMoveEffects::');b=scripts.index('\n\n',a)
    evidence.append(source.record('data/battle_scripts_1.s','gBattleScriptsForMoveEffects','complete-effect-dispatch',a,b,scripts))
    (out/'mirror_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-mirror/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    inputs={r['path']:r for r in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':12,'scope':'private-firered-family-mirror-v1','parentProfile':'firered-family-pursuit-v1',
        'inputs':[inputs[k] for k in sorted(inputs)],'fragments':report['fragments']+source.fragments,
        'supported':['Eight source species,25 family moves and automatic Struggle',
            'Complete source Mirror Move command, source-selected target RNG, existing copied-effect schedules and original PP slot',
            'Original-chosen-move history flags, no-copy failure, Protect/flinch/miss behavior, copied Skull Bash lock and release',
            'Source switch/faint history clearing and separately retained Pursuit switch interception',
            'Checkpoint10/512 adds four reachable singles history words; atomic pending dispatch cannot be exported'],
        'unsupported':['Other species/moves, held items, other statuses/abilities, trainer/double battles and opposing party switching',
            'Unreachable singles fallback/sentinel history fabrication; raw importer admits only the settled singles state space',
            'Full battle script interpreter, original ROM execution, durable normal ownership/rewards']})
    report['transformations'] += [
        'A separate Mirror extractor transforms only its own Pursuit-derived output; thirteen retained modules and formats are untouched.',
        'Cmd_trymirrormove and GetMoveTarget are complete source functions. Assembly effect destinations are explicit pointer identity tags routed to retained source-command effect schedules; no creature moveset is temporarily rewritten.',
        'Mirror Move keeps selected priority and PP slot, while actual copied move controls target/type/damage/effect. Copied Struggle pays Mirror PP and retains source recoil; forced copied Skull Bash release uses locked130 without paying PP again.',
        'Selected MOVEEND_MIRROR_MOVE source branch uses original gChosenMove: Mirror119 flags0 prevent copied-hit recursion; release130 is a new chosen move. Faint continuation restores saved attacker/target/flags and source faint marker before history.',
        'Source GetMoveTarget writes stored targets for noncharging copied moves; checkpoint validation permits only reachable singles0/opponent target values.',
        'Four logical words495/496 lastTakenMove and497/498 opponent matrix entries preserve future-read singles history. All other matrix entries remain zero; snapshots reject divergent primary/from history and unavailable sentinels never produced in the admitted profile.',
        'Source SwitchInClearSetData/FaintClearSetData already clear the complete history arrays. Pursuit ActionSwitch has no attackcanceler and OBEYS remains clear, so its final MirrorMoveend branch cannot record an interception.',
        'Pinned firered-protect-rom-v1 compiled lookup remains exactly unchanged; original ROM execution and reconstruction are not claimed.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
