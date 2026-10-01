/* Private mechanical evolution scene; no owned save, renderer or battle input. */
typedef __UINT8_TYPE__ u8;typedef __UINT16_TYPE__ u16;typedef __UINT32_TYPE__ u32;
typedef __INT8_TYPE__ s8;typedef __INT16_TYPE__ s16;typedef __INT32_TYPE__ s32;
typedef u8 bool8;typedef u32 bool32;
#define NULL ((void *)0)
#define FIRERED 1
#define ENGLISH 1
#define REVISION 0
#include "constants/global.h"
#include "constants/pokemon.h"
#include "constants/species.h"
#include "constants/moves.h"
#include "constants/items.h"
#include "constants/abilities.h"
#include "constants/hold_effects.h"
#include "constants/battle.h"
#include "constants/game_stat.h"
#include "constants/pokedex.h"
#include "characters.h"
#include "source_data.inc"

struct BoxPokemon {u32 fields[89];u8 nickname[11];};
struct Pokemon {struct BoxPokemon box;};
struct Runtime {
    struct Pokemon mon;u32 head[26],basis[6];u8 cursor;u16 move;
    struct {u32 encryptionKey;struct {u8 seen[49],owned[49];u32 unownPersonality,spindaPersonality;} pokedex;} save2;
    struct {u8 seen1[49],seen2[49];u32 gameStats[NUM_USED_GAME_STATS];struct {u8 holdEffect;} enigmaBerry;} save1;
};
static struct Runtime sRuntime;
#define gSaveBlock1Ptr (&sRuntime.save1)
#define gSaveBlock2Ptr (&sRuntime.save2)
#define sLearningMoveTableID (sRuntime.cursor)
#define gMoveToLearn (sRuntime.move)
static struct {u16 data[16];} gTasks[1];
static struct {s32 levelUpHP;} gBattleScripting;
static u8 gStringVar1[32],gLastUsedAbility;
static u32 sInput[72],sInputSeen[72],sInputActive,sInputBad;
static u32 sImport[128],sImportSeen[128],sImportActive,sImportBad;
static const u8 sMonFields[40]={
    MON_DATA_SPECIES,MON_DATA_PERSONALITY,MON_DATA_OT_ID,MON_DATA_EXP,MON_DATA_LEVEL,
    MON_DATA_FRIENDSHIP,MON_DATA_HP,MON_DATA_MAX_HP,MON_DATA_ATK,MON_DATA_DEF,MON_DATA_SPEED,MON_DATA_SPATK,MON_DATA_SPDEF,
    MON_DATA_HP_IV,MON_DATA_ATK_IV,MON_DATA_DEF_IV,MON_DATA_SPEED_IV,MON_DATA_SPATK_IV,MON_DATA_SPDEF_IV,
    MON_DATA_HP_EV,MON_DATA_ATK_EV,MON_DATA_DEF_EV,MON_DATA_SPEED_EV,MON_DATA_SPATK_EV,MON_DATA_SPDEF_EV,
    MON_DATA_MOVE1,MON_DATA_MOVE2,MON_DATA_MOVE3,MON_DATA_MOVE4,MON_DATA_PP1,MON_DATA_PP2,MON_DATA_PP3,MON_DATA_PP4,
    MON_DATA_PP_BONUSES,MON_DATA_POKEBALL,MON_DATA_MET_LOCATION,MON_DATA_STATUS,MON_DATA_HELD_ITEM,MON_DATA_POKERUS,MON_DATA_ABILITY_NUM
};
static void Zero(void *pointer,u32 size){u8 *p=pointer;while(size--)*p++=0;}
static void NameCopy(u8 *to,const u8 *from)
{bool8 ended=FALSE;for(u32 i=0;i<10;i++){to[i]=ended?EOS:from[i];if(to[i]==EOS)ended=TRUE;}to[10]=EOS;}
static u32 GetBoxMonData(struct BoxPokemon *mon,s32 field,...)
{
    if(field==MON_DATA_SPECIES_OR_EGG)field=MON_DATA_SPECIES;
    if(field<0||field>=89)__builtin_trap();
    if(field==MON_DATA_NICKNAME){__builtin_va_list args;__builtin_va_start(args,field);u8 *to=__builtin_va_arg(args,u8 *);__builtin_va_end(args);NameCopy(to,mon->nickname);return 10;}
    return mon->fields[field];
}
static u32 GetMonData(struct Pokemon *mon,s32 field,...)
{
    if(field==MON_DATA_NICKNAME){__builtin_va_list args;__builtin_va_start(args,field);u8 *to=__builtin_va_arg(args,u8 *);__builtin_va_end(args);return GetBoxMonData(&mon->box,field,to);}
    return GetBoxMonData(&mon->box,field);
}
static void SetBoxMonData(struct BoxPokemon *mon,s32 field,const void *value)
{
    if(field<0||field>=89)__builtin_trap();
    if(field==MON_DATA_NICKNAME){NameCopy(mon->nickname,value);return;}
    const u8 *p=value;u32 n=p[0];
    if(field==MON_DATA_PERSONALITY||field==MON_DATA_OT_ID||field==MON_DATA_EXP||field==MON_DATA_STATUS)
        n|=(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;
    else if(field==MON_DATA_SPECIES||field==MON_DATA_HELD_ITEM||(field>=MON_DATA_MOVE1&&field<=MON_DATA_MOVE4)
            ||(field>=MON_DATA_HP&&field<=MON_DATA_SPDEF))n|=(u32)p[1]<<8;
    mon->fields[field]=n;
}
static void SetMonData(struct Pokemon *mon,s32 field,const void *value){SetBoxMonData(&mon->box,field,value);}
static bool8 IsNationalPokedexEnabled(void){return FALSE;}
static u16 Random(void){__builtin_trap();}
static u8 GetLevelFromMonExp(struct Pokemon *);u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
u8 GetNature(struct Pokemon *);static u8 GetNatureFromPersonality(u32);static u16 ModifyStatByNature(u8,u16,u8);
static u16 GiveMoveToBoxMon(struct BoxPokemon *,u16);u8 GetBoxMonGender(struct BoxPokemon *);
u8 ItemId_GetHoldEffect(u16);s32 StringCompare(const u8 *,const u8 *);
s8 DexScreen_GetSetPokedexFlag(u16,u8,bool8);s8 GetSetPokedexFlag(u16,u8);
u16 SpeciesToNationalPokedexNum(u16);u32 GetGameStat(u8);void SetGameStat(u8,u32);
#include "source_functions.inc"

static bool8 SpeciesAllowed(u32 species)
{return (species>=SPECIES_SQUIRTLE&&species<=SPECIES_BLASTOISE)||(species>=SPECIES_PIDGEY&&species<=SPECIES_RATICATE);}
static void LoadMon(struct Pokemon *mon,const u32 *w)
{Zero(mon,sizeof(*mon));for(u32 i=0;i<40;i++)mon->box.fields[sMonFields[i]]=w[i];mon->box.fields[MON_DATA_LANGUAGE]=GAME_LANGUAGE;}
static bool8 LegalMove(u32 move,u32 species,u32 level)
{
    if(!move)return TRUE;if(move>=MOVES_COUNT)return FALSE;
    u32 first=species<=SPECIES_BLASTOISE?SPECIES_SQUIRTLE:species<=SPECIES_PIDGEOT?SPECIES_PIDGEY:SPECIES_RATTATA;
    for(u32 s=first;s<=species;s++)for(u32 i=0;gLevelUpLearnsets[s][i]!=LEVEL_UP_END;i++)
        if((gLevelUpLearnsets[s][i]&LEVEL_UP_MOVE_ID)==move&&(gLevelUpLearnsets[s][i]>>9)<=level)return TRUE;
    return FALSE;
}
static s32 ValidateMon(const u32 *w,const u32 *basis)
{
    u32 species=w[0],level=w[4];
    if(!SpeciesAllowed(species)||level<1||level>MAX_LEVEL||w[3]>gExperienceTables[gSpeciesInfo[species].growthRate][MAX_LEVEL]
       ||w[5]>255||w[6]>w[7]||!w[7]||w[33]>255||w[38]||w[39]>1||!gSpeciesInfo[species].abilities[w[39]]
       ||(w[37]!=ITEM_NONE&&w[37]!=ITEM_EVERSTONE))return 1;
    for(u32 i=6;i<=12;i++)if(w[i]>65535)return 1;
    if(w[34]!=0xffffffffu&&w[34]!=ITEM_POKE_BALL&&w[34]!=ITEM_LUXURY_BALL)return 1;
    if(w[35]!=0xffffffffu&&w[35]>255)return 1;
    u32 total=0;for(u32 i=0;i<6;i++){if(w[13+i]>31||w[19+i]>255||basis[i]>w[19+i])return 1;total+=w[19+i];}
    if(total>MAX_TOTAL_EVS)return 1;
    bool8 empty=FALSE;
    for(u32 i=0;i<4;i++){
        u32 move=w[25+i];
        if(!LegalMove(move,species,level)||(empty&&move)||w[29+i]>CalculatePPWithBonus(move,w[33],i))return 1;
        if(!move){empty=TRUE;if(w[29+i]||((w[33]>>(2*i))&3))return 1;}
        for(u32 j=0;j<i;j++)if(move&&move==w[25+j])return 1;
    }
    struct Pokemon check;LoadMon(&check,w);if(GetLevelFromMonExp(&check)!=level)return 1;
    for(u32 i=0;i<6;i++)check.box.fields[MON_DATA_HP_EV+i]=basis[i];CalculateMonStats(&check);
    for(u32 i=7;i<=12;i++)if(GetMonData(&check,sMonFields[i])!=w[i])return 1;
    return 0;
}
static bool8 ValidName(const u32 *w)
{
    bool8 ended=FALSE,nonblank=FALSE;
    for(u32 i=0;i<11;i++){if(w[i]>255)return FALSE;if(w[i]==EOS){ended=TRUE;continue;}
        if(ended||i==10||!sAllowedNameByte[w[i]])return FALSE;if(w[i]!=CHAR_SPACE)nonblank=TRUE;}
    return ended&&nonblank;
}
static void Event(u32 type,u32 value,u32 slot){sRuntime.head[19]=type;sRuntime.head[20]=value;sRuntime.head[21]=slot;}
static u32 DexBit(const u8 *bytes){u32 dex=SpeciesToNationalPokedexNum(sRuntime.head[4])-1;return (bytes[dex/8]>>(dex%8))&1;}
static void SetDex(u32 seen,u32 caught)
{u16 dex=SpeciesToNationalPokedexNum(sRuntime.head[4]);if(seen)GetSetPokedexFlag(dex,FLAG_SET_SEEN);if(caught)GetSetPokedexFlag(dex,FLAG_SET_CAUGHT);}
u32 evolution_abi_version(void){return 1;}u32 evolution_input_word_count(void){return 72;}u32 evolution_state_word_count(void){return 128;}
s32 evolution_input_begin(void){Zero(sInput,sizeof(sInput));Zero(sInputSeen,sizeof(sInputSeen));sInputActive=1;sInputBad=0;return 0;}
s32 evolution_input_set(u32 index,u32 value)
{if(!sInputActive||index>=72||sInputSeen[index]){sInputBad=1;return 1;}sInput[index]=value;sInputSeen[index]=1;return 0;}
s32 evolution_start(void)
{
    if(!sInputActive||sRuntime.head[2])return 3;if(sInputBad)return 1;
    for(u32 i=0;i<72;i++)if(!sInputSeen[i])return 1;
    const u32 *w=sInput;
    if(ValidateMon(w,w+40)||!ValidName(w+46)||w[57]!=GAME_LANGUAGE||w[58]>1||w[59]>w[58]||w[60]>0xffffff||w[61]>1)return 1;
    for(u32 i=62;i<72;i++)if(w[i])return 1;
    struct Pokemon mon;LoadMon(&mon,w);u16 target=GetEvolutionTargetSpecies(&mon,EVO_MODE_NORMAL,0);if(!target)return 4;
    Zero(&sRuntime,sizeof(sRuntime));sRuntime.mon=mon;for(u32 i=0;i<11;i++)sRuntime.mon.box.nickname[i]=w[46+i];
    for(u32 i=0;i<6;i++)sRuntime.basis[i]=w[40+i];
    sRuntime.head[0]=1;sRuntime.head[1]=1;sRuntime.head[2]=1;sRuntime.head[3]=w[0];sRuntime.head[4]=target;sRuntime.head[7]=1;
    sRuntime.head[10]=w[58];sRuntime.head[11]=w[59];sRuntime.head[14]=w[60];sRuntime.head[18]=w[61];
    sRuntime.head[22]=GAME_LANGUAGE;sRuntime.head[23]=0xffffffffu;SetDex(w[58],w[59]);SetGameStat(GAME_STAT_EVOLVED_POKEMON,w[60]);
    sInputActive=0;return 0;
}
s32 evolution_choose(u32 accept)
{
    if(!sRuntime.head[2]||sRuntime.head[1]!=1)return 3;if(accept>1||(!accept&&!sRuntime.head[18]))return 1;
    if(!accept){
        sRuntime.head[5]=2;sRuntime.head[6]=1;
        /* Source calls learning BEFORE checking tEvoWasStopped. Do it once. */
        sRuntime.head[17]=MonTryLearningNewMove(&sRuntime.mon,sRuntime.head[7]);
        sRuntime.head[1]=4;Event(2,sRuntime.head[3],0);return 0;
    }
    u8 oldName[11];for(u32 i=0;i<11;i++)oldName[i]=sRuntime.mon.box.nickname[i];
    gTasks[0].tPreEvoSpecies=sRuntime.head[3];gTasks[0].tPostEvoSpecies=sRuntime.head[4];SourceEvolve(&sRuntime.mon);
    sRuntime.head[16]=StringCompare(oldName,sRuntime.mon.box.nickname)!=0;
    for(u32 i=0;i<6;i++)sRuntime.basis[i]=GetMonData(&sRuntime.mon,MON_DATA_HP_EV+i);
    sRuntime.head[5]=1;sRuntime.head[1]=2;Event(1,sRuntime.head[4],0);return 0;
}
s32 evolution_next(void)
{
    if(!sRuntime.head[2]||sRuntime.head[1]!=2)return 3;
    u16 result=MonTryLearningNewMove(&sRuntime.mon,sRuntime.head[7]);sRuntime.head[17]=result;
    if(result==MOVE_NONE){sRuntime.head[1]=4;Event(6,GetMonData(&sRuntime.mon,MON_DATA_SPECIES),0);return 0;}
    sRuntime.head[7]=0;
    if(result==MON_ALREADY_KNOWS_MOVE){Event(0,0,0);return 0;}
    if(result==MON_HAS_MAX_MOVES){sRuntime.head[1]=3;Event(0,0,0);return 0;}
    u32 slot=0;while(slot<4&&GetMonData(&sRuntime.mon,MON_DATA_MOVE1+slot)!=result)slot++;
    Event(3,result,slot);return 0;
}
s32 evolution_decide(u32 slot)
{
    if(!sRuntime.head[2]||sRuntime.head[1]!=3)return 3;if(slot>4)return 1;
    if(slot<4){
        if(IsHMMove2(GetMonData(&sRuntime.mon,MON_DATA_MOVE1+slot)))return 4;
        RemoveMonPPBonus(&sRuntime.mon,slot);SetMonMoveSlot(&sRuntime.mon,gMoveToLearn,slot);Event(4,gMoveToLearn,slot);
    }else Event(5,gMoveToLearn,4);
    sRuntime.head[23]=slot;sRuntime.head[1]=2;return 0;
}
u32 evolution_get(u32 field)
{
    if(field==0)return sRuntime.head[1];if(field==1)return sRuntime.head[4];if(field==2)return sRuntime.head[1]==3?gMoveToLearn:0;
    if(!sRuntime.head[2])return 0;if(field==3)return GetNature(&sRuntime.mon);if(field==4)return GetMonAbility(&sRuntime.mon);
    if(field==5)return GetMonGender(&sRuntime.mon);if(field==6)return GetGameStat(GAME_STAT_EVOLVED_POKEMON);return 0;
}
u32 evolution_mon_get(u32 index){return index<40?GetMonData(&sRuntime.mon,sMonFields[index]):0;}
u32 evolution_state_get(u32 index)
{
    if(index>=48&&index<88)return evolution_mon_get(index-48);if(index>=32&&index<43)return sRuntime.mon.box.nickname[index-32];
    if(index>=26&&index<32)return sRuntime.basis[index-26];if(index>=26)return 0;
    if(index==8)return sLearningMoveTableID;if(index==9)return gMoveToLearn;
    if(index==12)return sRuntime.head[2]?DexBit(gSaveBlock2Ptr->pokedex.seen):0;
    if(index==13)return sRuntime.head[2]?DexBit(gSaveBlock2Ptr->pokedex.owned):0;
    if(index==15)return GetGameStat(GAME_STAT_EVOLVED_POKEMON);
    if(index==24)return sRuntime.head[2]?DexBit(gSaveBlock1Ptr->seen1):0;
    if(index==25)return sRuntime.head[2]?DexBit(gSaveBlock1Ptr->seen2):0;
    return sRuntime.head[index];
}
s32 evolution_import_begin(void){Zero(sImport,sizeof(sImport));Zero(sImportSeen,sizeof(sImportSeen));sImportActive=1;sImportBad=0;return 0;}
s32 evolution_import_set(u32 index,u32 value)
{if(!sImportActive||index>=128||sImportSeen[index]){sImportBad=1;return 1;}sImport[index]=value;sImportSeen[index]=1;return 0;}
static bool8 HasMove(const u32 *mon,u32 move){for(u32 i=0;i<4;i++)if(mon[25+i]==move)return TRUE;return FALSE;}
static bool8 FullMoves(const u32 *mon){for(u32 i=0;i<4;i++)if(!mon[25+i])return FALSE;return TRUE;}
static bool8 FreshMove(const u32 *mon,u32 slot,u32 move)
{return slot<4&&mon[25+slot]==move&&mon[29+slot]==gBattleMoves[move].pp&&!(mon[33]&(3u<<(2*slot)));}
/* Raw restore proves a supported source boundary, not immutable historical
 * identity. The host additionally replays original admission and decisions. */
static s32 ValidateState(const u32 *w)
{
    const u32 *mon=w+48;
    if(w[0]!=1||w[1]<1||w[1]>4||w[2]!=1||!SpeciesAllowed(w[3])||!SpeciesAllowed(w[4])
       ||w[5]>2||w[6]>1||w[7]>1||w[9]>=MOVES_COUNT||w[10]>1||w[11]>w[10]||w[12]>1||w[13]>w[12]
       ||w[14]>0xffffff||w[15]>0xffffff||w[16]>1||w[18]>1||w[19]>6||w[21]>4||w[22]!=GAME_LANGUAGE
       ||(w[23]!=0xffffffffu&&w[23]>4)||w[24]!=w[12]||w[25]!=w[12]||!ValidName(w+32)||ValidateMon(mon,w+26))return 1;
    for(u32 i=43;i<48;i++)if(w[i])return 1;for(u32 i=88;i<128;i++)if(w[i])return 1;
    struct Pokemon pre;LoadMon(&pre,mon);pre.box.fields[MON_DATA_SPECIES]=w[3];
    if(GetEvolutionTargetSpecies(&pre,EVO_MODE_NORMAL,0)!=w[4])return 1;
    u32 species=mon[0],level=mon[4],end=0;const u16 *learn=gLevelUpLearnsets[species];while(learn[end]!=LEVEL_UP_END)end++;
    if(w[8]>end)return 1;
    if(w[1]==1){
        if(species!=w[3]||w[5]||w[6]||w[7]!=1||w[8]||w[9]||w[12]!=w[10]||w[13]!=w[11]||w[15]!=w[14]
           ||w[16]||w[17]||w[19]||w[20]||w[21]||w[23]!=0xffffffffu)return 1;
        return 0;
    }
    if(w[5]==2){
        if(w[1]!=4||species!=w[3]||!w[6]||!w[7]||!w[18]||w[12]!=w[10]||w[13]!=w[11]||w[15]!=w[14]
           ||w[16]||w[19]!=2||w[20]!=w[3]||w[21]||w[23]!=0xffffffffu)return 1;
        u32 first=0;while(first<end&&(learn[first]>>9)!=level)first++;
        if(first==end){if(w[8]!=end||w[9]||w[17])return 1;}
        else {
            u32 move=learn[first]&LEVEL_UP_MOVE_ID;
            if(w[8]!=first+1||w[9]!=move)return 1;
            if(w[17]==MON_HAS_MAX_MOVES){if(!FullMoves(mon)||HasMove(mon,move))return 1;}
            else if((w[17]!=MON_ALREADY_KNOWS_MOVE&&w[17]!=move)||!HasMove(mon,move))return 1;
            if(w[17]==move){u32 slot=0;while(slot<4&&mon[25+slot]!=move)slot++;if(!FreshMove(mon,slot,move))return 1;}
        }
        return 0;
    }
    if(w[5]!=1||species!=w[4]||w[6]||w[12]!=1||w[13]!=1||w[15]!=(w[14]==0xffffff?w[14]:w[14]+1))return 1;
    for(u32 i=0;i<6;i++)if(w[26+i]!=mon[19+i])return 1;
    if(w[16])for(u32 i=0;i<11;i++)if(w[32+i]!=gSpeciesNames[species][i])return 1;
    if(w[7]){
        if(w[9]||w[23]!=0xffffffffu)return 1;
        if(w[1]==2){if(w[8]||w[17]||w[19]!=1||w[20]!=species||w[21])return 1;}
        else if(w[1]==4){if(w[17]||w[19]!=6||w[20]!=species||w[21]||w[8]!=end)return 1;
            for(u32 i=0;i<end;i++)if((learn[i]>>9)==level)return 1;
        }else return 1;
        return 0;
    }
    if(!w[8]||!w[9]||(learn[w[8]-1]&LEVEL_UP_MOVE_ID)!=w[9]||(learn[w[8]-1]>>9)!=level)return 1;
    if(w[1]==3){
        if(w[17]!=MON_HAS_MAX_MOVES||!FullMoves(mon)||HasMove(mon,w[9])||w[19]||w[20]||w[21])return 1;
    }else if(w[1]==4){
        if(w[17]||w[19]!=6||w[20]!=species||w[21]||(w[8]<end&&(learn[w[8]]>>9)==level))return 1;
    }else if(w[19]==0){
        if(w[17]!=MON_ALREADY_KNOWS_MOVE||!HasMove(mon,w[9])||w[20]||w[21])return 1;
    }else if(w[19]==3){
        if(w[17]!=w[9]||w[20]!=w[9]||!FreshMove(mon,w[21],w[9]))return 1;
    }else if(w[19]==4){
        if(w[17]!=MON_HAS_MAX_MOVES||w[20]!=w[9]||w[23]!=w[21]||!FreshMove(mon,w[21],w[9]))return 1;
    }else if(w[19]==5){
        if(w[17]!=MON_HAS_MAX_MOVES||w[20]!=w[9]||w[21]!=4||w[23]!=4||!FullMoves(mon)||HasMove(mon,w[9]))return 1;
    }else return 1;
    return 0;
}
s32 evolution_import_commit(void)
{
    if(!sImportActive)return 3;if(sImportBad)return 1;for(u32 i=0;i<128;i++)if(!sImportSeen[i])return 1;
    const u32 *w=sImport;if(ValidateState(w))return 1;
    Zero(&sRuntime,sizeof(sRuntime));LoadMon(&sRuntime.mon,w+48);
    for(u32 i=0;i<26;i++)sRuntime.head[i]=w[i];for(u32 i=0;i<6;i++)sRuntime.basis[i]=w[26+i];
    for(u32 i=0;i<11;i++)sRuntime.mon.box.nickname[i]=w[32+i];sLearningMoveTableID=w[8];gMoveToLearn=w[9];
    SetDex(w[12],w[13]);SetGameStat(GAME_STAT_EVOLVED_POKEMON,w[15]);sImportActive=0;return 0;
}
