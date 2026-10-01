"""Extend the shared source command extraction without changing old profiles."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'tools/battle-spike'
ROUTE=ROOT/'tools/battle-route1'
sys.path.insert(0,str(ROUTE))
spec=importlib.util.spec_from_file_location('family_shared_extract',ROUTE/'extract.py')
route=importlib.util.module_from_spec(spec);spec.loader.exec_module(route)
base=route.base
SPECIES=('Squirtle','Wartortle','Blastoise','Pidgey','Pidgeotto','Pidgeot','Rattata','Raticate')
MOVES=('TACKLE','TAIL_WHIP','SAND_ATTACK','WATER_GUN','BUBBLE','WITHDRAW','QUICK_ATTACK','GUST',
       'WING_ATTACK','HYDRO_PUMP','BITE','HYPER_FANG','AGILITY','FEATHER_DANCE','SCARY_FACE','FOCUS_ENERGY')


def extract(out, *, party=False):
    report=route.extract(out,family=True,party=party)
    source=base.Extraction()
    # The common engine has complete source tables. Expand only its projected
    # real identity/type table; the source validator has complete species rows.
    text=source.read('src/data/pokemon/species_info.h')
    types=['static const u8 sRoute1Types[NUM_SPECIES][2]={\n']
    data=[source.block('include/pokemon.h','SpeciesInfo','struct')]
    for path,names in {'include/gba/defines.h':('TRUE','FALSE'),'include/global.h':('min',),'src/pokemon.c':('CALC_STAT','PP_UP_SHIFTS'),
        'src/data/pokemon/species_info.h':('PERCENT_FEMALE',),
        'src/data/pokemon/level_up_learnsets.h':('LEVEL_UP_MOVE','LEVEL_UP_END')}.items():
        data.extend(source.macro(path,name) for name in names)
    data.append('static const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES]={\n')
    for name in SPECIES:
        start=text.index('    [SPECIES_'+name.upper()+'] =');end=text.index('\n    [',start+1)
        data.append(source.record('src/data/pokemon/species_info.h',name,'complete-table-entry',start,end,text))
        field=re.search(r'\.types\s*=\s*(\{[^}]+\})',text[start:end])
        if not field:raise ValueError('Missing species types')
        types.append('[SPECIES_'+name.upper()+']='+source.record('src/data/pokemon/species_info.h',name+'.types','selected-field',start+field.start(1),start+field.end(1),text)+',\n')
    data.append('};\n');types.append('};\n')
    path=out/'route1_source_declarations.inc';current=path.read_text()
    a=current.index('static const u8 sRoute1Types');b=current.index('};',a)+2
    path.write_text(current[:a]+''.join(types)+current[b:],encoding='utf-8',newline='\n')
    data.append(source.read('src/data/pokemon/experience_tables.h'))
    for name in ('sNatureStatTable','gPPUpGetMask'):data.append(source.block('src/pokemon.c',name,'table'))
    for name in SPECIES:data.append(source.block('src/data/pokemon/level_up_learnsets.h','s'+name+'LevelUpLearnset','table'))
    data.append('static const u16 *const gLevelUpLearnsets[NUM_SPECIES]={'+','.join('[SPECIES_'+name.upper()+']=s'+name+'LevelUpLearnset' for name in SPECIES)+'};\n')
    text=source.read('src/data/battle_moves.h');data.append('static const struct {u8 pp;} gBattleMoves[MOVES_COUNT]={\n')
    for name in MOVES:
        start=text.index('    [MOVE_'+name+'] =');end=text.index('\n    [',start+1)
        field=re.search(r'        \.pp = [^,]+,',text[start:end])
        if not field:raise ValueError('Missing PP')
        data.append('[MOVE_'+name+']={'+source.record('src/data/battle_moves.h',name+'.pp','selected-field',start+field.start(),start+field.end(),text)+'},\n')
    data.append('};\n');(out/'creature_data.inc').write_text(''.join(data),encoding='utf-8',newline='\n')
    funcs=[]
    for name in ('CalculateMonStats','GetLevelFromMonExp','GetLevelFromBoxMonExp','GetNature','GetNatureFromPersonality','ModifyStatByNature',
                 'GetAbilityBySpecies','GetMonAbility','GetMonGender','GetBoxMonGender','CalculatePPWithBonus'):
        funcs.append(source.block('src/pokemon.c',name,'function'))
    (out/'creature_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    # Retain complete source flinch and stat-decrease secondary cases, with
    # their existing guards. All other omitted cases keep an explicit tripwire.
    text=source.read('src/battle_script_commands.c');start=text.index('void SetMoveEffect(')
    blocks=[]
    for first,last in [('MOVE_EFFECT_FLINCH','MOVE_EFFECT_UPROAR'),('MOVE_EFFECT_ATK_MINUS_1','MOVE_EFFECT_ATK_PLUS_2')]:
        a=text.index('            case '+first+':',start);b=text.index('            case '+last+':',a)
        blocks.append(source.record('src/battle_script_commands.c','SetMoveEffect:'+first,'complete-cases',a,b,text))
    path=out/'source_functions.inc';current=path.read_text();marker='            default: Unexpected(); break;'
    if current.count(marker)!=1:raise ValueError('Changed shared secondary effect seam')
    path.write_text(current.replace(marker,''.join(blocks)+marker),encoding='utf-8',newline='\n')
    funcs=[source.block('src/battle_script_commands.c','GetBattlerTurnOrderNum','function'),
           source.block('src/battle_script_commands.c','Cmd_setfocusenergy','function'),
           source.block('src/battle_util.c','CancelMultiTurnMoves','function')]
    text=source.read('src/battle_util.c');start=text.index('        case CANCELLER_FLINCH:');end=text.index('        case CANCELLER_DISABLED:',start)
    body=source.record('src/battle_util.c','AtkCanceller_UnableToUseMove:CANCELLER_FLINCH','complete-case',start,end,text)
    funcs.insert(0,source.enum_containing('src/battle_util.c','CANCELLER_FLINCH'))
    funcs.append('static u8 SourceFamilyTryFlinch(void){u8 effect=0;switch(CANCELLER_FLINCH){\n'+body+'}\nreturn effect;}\n')
    text=source.read('src/battle_main.c');start=text.index('    for (i = 0; i < gBattlersCount; i++)\n        gBattleMons[i].status2 &= ~(STATUS2_FLINCHED);');end=text.index('\n',text.index('gBattleMons[i].status2',start))
    funcs.append('static void SourceFamilyClearFlinch(void){u32 i;\n'+source.record('src/battle_main.c','TryDoEventsBeforeFirstTurn:clear-flinch','selected-statements',start,end,text)+'\n}\n')
    (out/'family_source_functions.inc').write_text(''.join(funcs),encoding='utf-8',newline='\n')
    evidence=[]
    for name in ('BattleScript_EffectDefenseUp','BattleScript_EffectStatUp','BattleScript_EffectSpeedUp2','BattleScript_EffectAttackDown2',
                 'BattleScript_EffectSpeedDown2','BattleScript_EffectFocusEnergy','BattleScript_EffectSpeedDownHit','BattleScript_EffectFlinchHit','BattleScript_EffectGust'):
        evidence.append(source.script(name))
    (out/'family_source_evidence.txt').write_text(''.join(evidence),encoding='utf-8',newline='\n')
    for path in sorted((ROOT/'tools/battle-family/c').glob('*')):(out/path.name).write_bytes(path.read_bytes())
    path=out/'battle_spike.c';current=path.read_text()
    current='#define WATERBLUE_FAMILY 1\n'+current
    current=current.replace('#include "adapter.c"','#include "family_source_functions.inc"\n#include "adapter.c"')
    current=current.replace('#include "checkpoint.inc"','#include "family.inc"\n#include "checkpoint.inc"')
    path.write_text(current,encoding='utf-8',newline='\n')
    inputs={row['path']:row for row in report['inputs']};inputs.update(source.inputs)
    report.update({'schemaVersion':6,'scope':'private-firered-family-singles-v1','inputs':[inputs[k] for k in sorted(inputs)],
        'fragments':report['fragments']+source.fragments,'parentProfile':'firered-route1-singles-v2',
        'supported':['Eight source species,16 family moves plus automatic Struggle','Source-active Torrent/Keen Eye/Run Away/Guts',
                     'Poison/burn damage context and residuals','Source flinch cancellation,Focus Energy,secondary speed changes,PP Ups',
                     'Single-active Fight/Run,private result lineage,logical checkpoint4'],
        'unsupported':['Live or durable ownership','Party switching or items in this new profile','Nine remaining family moves',
                       'Weather/protect/airborne/two-turn/trapping/history/fixed-damage moves','Other statuses/abilities/held items']})
    report['transformations'] += [
        'Family-only conditionals retain all earlier profile preprocessor branches; previous WASM hashes are independently checked.',
        'Separate source-C admission validates complete creature statistics against calculated EV basis and source ability/type/level-up legality; no TS stat arithmetic.',
        'Complete source secondary flinch/stat-down cases,Focus Energy command and CancelMultiTurnMoves retained; only admitted flinch attack-canceller case executes before accuracy/PP.',
        'Self stat boosts and Focus Energy omit accuracy exactly as source scripts; target reductions retain accuracy-before-PP.',
        'Status2 Focus Energy is future-read checkpoint state; flinch and action order exist only inside one atomic turn, clear/reconstruct before the next supported checkpoint action.',
        'Fight/Run only; inherited item functions compile as unused shared provenance and have no exported family entry point.',
        'Source PP-Up calculation and packed bonuses survive checkpoint4; immutable identity/EV/ownership provenance remains in the host envelope.']
    report['outputs']=[{'path':str(p.relative_to(out)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':base.sha(p.read_bytes())}
                       for p in sorted(out.rglob('*')) if p.is_file() and p.name!='extraction-manifest.json']
    report['buildScripts'] += [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':base.sha(p.read_bytes())} for p in (Path(__file__),Path(__file__).with_name('build.py'))]
    (out/'extraction-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);extract(parser.parse_args().out.absolute())
