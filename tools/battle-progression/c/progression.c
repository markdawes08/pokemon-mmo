/* Restricted source-C progression continuation; no battle, inventory or owner. */
typedef __UINT8_TYPE__ u8;
typedef __UINT16_TYPE__ u16;
typedef __UINT32_TYPE__ u32;
typedef __INT8_TYPE__ s8;
typedef __INT16_TYPE__ s16;
typedef __INT32_TYPE__ s32;
typedef u8 bool8;
typedef u32 bool32;
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
#include "constants/trainers.h"
#include "source_data.inc"

struct BoxPokemon {u32 fields[89];};
struct Pokemon {struct BoxPokemon box;};
static struct Pokemon gPlayerParty[PARTY_SIZE];
static struct {u16 species;u8 level;} gBattleMons[2];
static u8 gBattlerFainted = 1;
static struct {s32 levelUpHP;} gBattleScripting;
static struct {bool8 inBattle;} gMain = {TRUE};
static struct {u8 holdEffect;} gEnigmaBerries[1];
static struct {struct {u8 holdEffect;} enigmaBerry;} sSave;
#define gSaveBlock1Ptr (&sSave)
static struct {u8 trainerClass;} gTrainers[1];
static u16 gTrainerBattleOpponent_A;
static u32 gBattleTypeFlags;
static u8 gActiveBattler, sLearningMoveTableID;
static u16 gMoveToLearn;
static struct {void (*func)(u8);} gTasks[1];
static void (*gBattlerControllerFuncs[2])(void);
static u32 sPhase, sRemaining, sAward, sLearnFirst, sLeveled, sEvolution;
static u32 sRegion, sContextKnown, sMode, sSourceAward, sOverride;
static u32 sBasis[6], sEvent[3], sInitialized;
static bool8 sChunkLeveled;
static u32 sInput[46], sInputSeen[46], sInputActive, sInputBad;
static u32 sImport[64], sImportSeen[64], sImportActive, sImportBad;
static const u8 sMonFields[40] = {
    MON_DATA_SPECIES,MON_DATA_PERSONALITY,MON_DATA_OT_ID,MON_DATA_EXP,MON_DATA_LEVEL,
    MON_DATA_FRIENDSHIP,MON_DATA_HP,MON_DATA_MAX_HP,MON_DATA_ATK,MON_DATA_DEF,MON_DATA_SPEED,MON_DATA_SPATK,MON_DATA_SPDEF,
    MON_DATA_HP_IV,MON_DATA_ATK_IV,MON_DATA_DEF_IV,MON_DATA_SPEED_IV,MON_DATA_SPATK_IV,MON_DATA_SPDEF_IV,
    MON_DATA_HP_EV,MON_DATA_ATK_EV,MON_DATA_DEF_EV,MON_DATA_SPEED_EV,MON_DATA_SPATK_EV,MON_DATA_SPDEF_EV,
    MON_DATA_MOVE1,MON_DATA_MOVE2,MON_DATA_MOVE3,MON_DATA_MOVE4,MON_DATA_PP1,MON_DATA_PP2,MON_DATA_PP3,MON_DATA_PP4,
    MON_DATA_PP_BONUSES,MON_DATA_POKEBALL,MON_DATA_MET_LOCATION,MON_DATA_STATUS,MON_DATA_HELD_ITEM,MON_DATA_POKERUS,MON_DATA_ABILITY_NUM
};
static void Zero(void *pointer,u32 bytes) {u8 *p=pointer;while(bytes--)*p++=0;}
static u32 GetBoxMonData(struct BoxPokemon *mon,s32 field,...)
{
    if(field==MON_DATA_SPECIES_OR_EGG)field=MON_DATA_SPECIES;
    if(field<0||field>=89)__builtin_trap();
    return mon->fields[field];
}
static u32 GetMonData(struct Pokemon *mon,s32 field,...) {return GetBoxMonData(&mon->box,field);}
static void SetBoxMonData(struct BoxPokemon *mon,s32 field,const void *value)
{
    if(field<0||field>=89)__builtin_trap();
    const u8 *p=value;u32 n=p[0];
    if(field==MON_DATA_PERSONALITY||field==MON_DATA_OT_ID||field==MON_DATA_EXP||field==MON_DATA_STATUS)
        n|=(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;
    else if(field==MON_DATA_SPECIES||field==MON_DATA_HELD_ITEM||(field>=MON_DATA_MOVE1&&field<=MON_DATA_MOVE4)
            ||(field>=MON_DATA_HP&&field<=MON_DATA_SPDEF))n|=(u32)p[1]<<8;
    mon->fields[field]=n;
}
static void SetMonData(struct Pokemon *mon,s32 field,const void *p) {SetBoxMonData(&mon->box,field,p);}
static u8 ItemId_GetHoldEffect(u16 item) {if(item!=ITEM_NONE)__builtin_trap();return HOLD_EFFECT_NONE;}
static u16 Random(void) {__builtin_trap();}
static u8 GetCurrentRegionMapSectionId(void) {if(!sContextKnown)__builtin_trap();return sRegion;}
static bool8 IsNationalPokedexEnabled(void) {return FALSE;}
static void Task_LaunchLvlUpAnim(u8 task) {(void)task;}
static void CompleteOnInactiveTextPrinter(void) {}
static void DestroyTask(u8 task) {if(task)__builtin_trap();sRemaining=0;}
static void BtlController_EmitTwoReturnValues(u8 buffer,u8 code,u16 value)
{if(buffer!=1||code!=RET_VALUE_LEVELED_UP)__builtin_trap();sRemaining=value;sChunkLeveled=TRUE;}
static u8 GetLevelFromMonExp(struct Pokemon *);
u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
u8 GetNature(struct Pokemon *);
static u8 GetNatureFromPersonality(u32);
static u16 ModifyStatByNature(u8,u16,u8);
static u16 GiveMoveToBoxMon(struct BoxPokemon *,u16);
u8 CheckPartyHasHadPokerus(struct Pokemon *,u8);
#include "source_functions.inc"

static void LoadMon(struct Pokemon *mon,const u32 *words)
{Zero(mon,sizeof(*mon));for(u32 i=0;i<40;i++)mon->box.fields[sMonFields[i]]=words[i];}
static bool8 LegalMove(u32 move,u32 level)
{
    if(!move)return TRUE;
    for(u32 i=0;sSquirtleLevelUpLearnset[i]!=LEVEL_UP_END;i++)
        if((sSquirtleLevelUpLearnset[i]&LEVEL_UP_MOVE_ID)==move&&(sSquirtleLevelUpLearnset[i]>>9)<=level)return TRUE;
    return FALSE;
}
static s32 ValidateMon(const u32 *words,const u32 *basis)
{
    if(words[0]!=SPECIES_SQUIRTLE||words[1]!=25||words[2]!=1||words[4]<1||words[4]>MAX_LEVEL
       ||words[3]>gExperienceTables[gSpeciesInfo[SPECIES_SQUIRTLE].growthRate][MAX_LEVEL]
       ||words[5]>255||words[6]>words[7]||!words[7]||words[33]||words[36]||words[37]||words[38]||words[39])return 1;
    /* Projected fields must preserve the source u16 storage domain before its
     * signed HP-delta/stat arithmetic is called, even on rejected raw input. */
    for(u32 i=6;i<=12;i++)if(words[i]>65535)return 1;
    if(words[34]!=0xffffffffu&&words[34]!=ITEM_POKE_BALL&&words[34]!=ITEM_LUXURY_BALL)return 1;
    if(words[35]!=0xffffffffu&&words[35]>255)return 1;
    u32 total=0;
    for(u32 i=0;i<6;i++) {
        if(words[13+i]!=15||words[19+i]>255||basis[i]>words[19+i])return 1;
        total+=words[19+i];
    }
    if(total>MAX_TOTAL_EVS)return 1;
    bool8 empty=FALSE;
    for(u32 i=0;i<4;i++) {
        u32 move=words[25+i];
        if(!LegalMove(move,words[4])||(empty&&move)||words[29+i]>gBattleMoves[move].pp)return 1;
        if(!move)empty=TRUE;
        for(u32 j=0;j<i;j++)if(move&&move==words[25+j])return 1;
    }
    struct Pokemon check;LoadMon(&check,words);
    if(GetLevelFromMonExp(&check)!=words[4])return 1;
    for(u32 i=0;i<6;i++)check.box.fields[MON_DATA_HP_EV+i]=basis[i];
    CalculateMonStats(&check);
    for(u32 i=7;i<=12;i++)if(GetMonData(&check,sMonFields[i])!=words[i])return 1;
    return 0;
}
static bool8 LegalDefeated(u32 species,u32 level)
{return (species==SPECIES_PIDGEY&&level>=2&&level<=5)||(species==SPECIES_RATTATA&&level>=2&&level<=4);}
static void Event(u32 type,u32 value,u32 slot) {sEvent[0]=type;sEvent[1]=value;sEvent[2]=slot;}
u32 progression_abi_version(void) {return 1;}
u32 progression_input_word_count(void) {return 46;}
u32 progression_state_word_count(void) {return 64;}
s32 progression_input_begin(void) {Zero(sInput,sizeof(sInput));Zero(sInputSeen,sizeof(sInputSeen));sInputActive=1;sInputBad=0;return 0;}
s32 progression_input_set(u32 index,u32 value)
{if(!sInputActive||index>=46||sInputSeen[index]){sInputBad=1;return 1;}sInput[index]=value;sInputSeen[index]=1;return 0;}
s32 progression_start(u32 species,u32 level,u32 region,u32 mode,u32 override)
{
    if(!sInputActive||sInitialized)return 3;
    if(sInputBad)return 1;
    for(u32 i=0;i<46;i++)if(!sInputSeen[i])return 1;
    if(ValidateMon(sInput,sInput+40)||!LegalDefeated(species,level)||mode>1
       ||(mode==0&&override)||(mode==1&&(override<1||override>32767)))return 1;
    bool8 known=region!=0xffffffffu;
    if(known?(region>255||sInput[34]==0xffffffffu||sInput[35]==0xffffffffu)
            :(sInput[34]!=0xffffffffu||sInput[35]!=0xffffffffu))return 1;
    LoadMon(&gPlayerParty[0],sInput);for(u32 i=0;i<6;i++)sBasis[i]=sInput[40+i];
    sRegion=region;sContextKnown=known;sMode=mode;sOverride=override;
    gBattleMons[1].species=species;gBattleMons[1].level=level;
    sSourceAward=SourceAward();sAward=sRemaining=0;sLeveled=sEvolution=0;sLearnFirst=0;
    sLearningMoveTableID=0;gMoveToLearn=0;
    if(sInput[6]&&sInput[4]!=MAX_LEVEL) {
        sAward=sRemaining=mode?override:sSourceAward;
        MonGainEVs(&gPlayerParty[0],species);
    }
    sPhase=1;sInitialized=1;sInputActive=0;Event(0,0,0);return 0;
}
static void Finish(void)
{
    if(sLeveled) {
        sEvolution=GetEvolutionTargetSpecies(&gPlayerParty[0],EVO_MODE_NORMAL,0);
        if(sEvolution) {sPhase=4;Event(6,sEvolution,0);return;}
    }
    sPhase=5;Event(7,0,0);
}
s32 progression_next(void)
{
    if(!sInitialized||sPhase>=3)return 3;
    for(;;) {
        if(sPhase==1) {
            if(!sRemaining||GetMonData(&gPlayerParty[0],MON_DATA_LEVEL)==MAX_LEVEL) {sRemaining=0;Finish();return 0;}
            u32 level=GetMonData(&gPlayerParty[0],MON_DATA_LEVEL);
            if(!sContextKnown&&GetMonData(&gPlayerParty[0],MON_DATA_EXP)+sRemaining
                >=gExperienceTables[gSpeciesInfo[SPECIES_SQUIRTLE].growthRate][level+1])return 4;
            u32 before=sRemaining;sChunkLeveled=FALSE;SourceApplyChunk();
            if(sChunkLeveled) {
                AdjustFriendship(&gPlayerParty[0],FRIENDSHIP_EVENT_GROW_LEVEL);
                for(u32 i=0;i<6;i++)sBasis[i]=GetMonData(&gPlayerParty[0],MON_DATA_HP_EV+i);
                sLeveled=1;sPhase=2;sLearnFirst=1;Event(2,GetMonData(&gPlayerParty[0],MON_DATA_LEVEL),0);
            } else Event(1,before,0);
            return 0;
        }
        u16 learned=MonTryLearningNewMove(&gPlayerParty[0],sLearnFirst);sLearnFirst=0;
        while(learned==MON_ALREADY_KNOWS_MOVE)learned=MonTryLearningNewMove(&gPlayerParty[0],FALSE);
        if(learned==MOVE_NONE) {sPhase=1;continue;}
        if(learned==MON_HAS_MAX_MOVES) {sPhase=3;Event(0,0,0);return 0;}
        u32 slot=0;while(slot<4&&GetMonData(&gPlayerParty[0],MON_DATA_MOVE1+slot)!=learned)slot++;
        Event(3,learned,slot);return 0;
    }
}
s32 progression_decide(u32 slot)
{
    if(!sInitialized||sPhase!=3)return 3;if(slot>4)return 1;
    if(slot<4) {RemoveMonPPBonus(&gPlayerParty[0],slot);SetMonMoveSlot(&gPlayerParty[0],gMoveToLearn,slot);Event(4,gMoveToLearn,slot);}
    else Event(5,gMoveToLearn,4);
    sPhase=2;return 0;
}
u32 progression_get(u32 field)
{
    if(field==0)return sPhase;if(field==1)return sPhase==3?gMoveToLearn:0;if(field==2)return sRemaining;
    if(field==3)return sAward;if(field==4)return sEvolution;if(field==5)return GetMonData(&gPlayerParty[0],MON_DATA_LEVEL);
    if(field==6)return sSourceAward;return 0;
}
u32 progression_mon_get(u32 index) {return index<40?GetMonData(&gPlayerParty[0],sMonFields[index]):0;}
u32 progression_event_get(u32 index) {return index<3?sEvent[index]:0;}
u32 progression_state_get(u32 index)
{
    if(index>=24&&index<64)return progression_mon_get(index-24);
    if(index>=16&&index<22)return sBasis[index-16];
    switch(index) {
    case 0:return 1;case 1:return sPhase;case 2:return sRemaining;case 3:return sAward;case 4:return gMoveToLearn;
    case 5:return sLearningMoveTableID;case 6:return sLearnFirst;case 7:return sLeveled;case 8:return sEvolution;
    case 9:return gBattleMons[1].species;case 10:return gBattleMons[1].level;case 11:return sRegion;case 12:return sContextKnown;
    case 13:return sMode;case 14:return sSourceAward;case 15:return sOverride;case 22:return 0;case 23:return sInitialized;
    default:return 0;
    }
}
s32 progression_import_begin(void) {Zero(sImport,sizeof(sImport));Zero(sImportSeen,sizeof(sImportSeen));sImportActive=1;sImportBad=0;return 0;}
s32 progression_import_set(u32 index,u32 value)
{if(!sImportActive||index>=64||sImportSeen[index]){sImportBad=1;return 1;}sImport[index]=value;sImportSeen[index]=1;return 0;}
s32 progression_import_commit(void)
{
    if(!sImportActive)return 3;if(sImportBad)return 1;for(u32 i=0;i<64;i++)if(!sImportSeen[i])return 1;
    const u32 *w=sImport;
    if(w[0]!=1||w[1]<1||w[1]>5||w[2]>w[3]||w[3]>32767||w[4]>=MOVES_COUNT
       ||w[5]>=sizeof(sSquirtleLevelUpLearnset)/sizeof(u16)||w[6]>1||w[7]>1||w[12]>1||w[13]>1||w[22]||w[23]!=1
       ||!LegalDefeated(w[9],w[10])||ValidateMon(w+24,w+16))return 1;
    if(w[12]?(w[11]>255||w[58]==0xffffffffu||w[59]==0xffffffffu)
            :(w[11]!=0xffffffffu||w[58]!=0xffffffffu||w[59]!=0xffffffffu))return 1;
    u32 expected=gSpeciesInfo[w[9]].expYield*w[10]/7;
    if(w[14]!=expected||(w[13]==0?w[15]!=0:(w[15]<1||w[15]>32767))
       ||(w[3]&&w[3]!=(w[13]?w[15]:expected)))return 1;
    if((w[6]&&w[1]!=2)||((w[1]==2||w[1]==3)&&!w[7])
       ||(w[7]&&(!w[12]||!w[3]||!w[30]))||(!w[30]&&w[3]))return 1;
    if(w[1]==3&&(!w[4]||!w[5]||w[6]||!w[7]
       ||(sSquirtleLevelUpLearnset[w[5]-1]&LEVEL_UP_MOVE_ID)!=w[4]
       ||(sSquirtleLevelUpLearnset[w[5]-1]>>9)!=w[28]))return 1;
    if(w[1]==3)for(u32 i=0;i<4;i++)if(!w[49+i]||w[49+i]==w[4])return 1;
    if(w[1]==4?(w[8]!=SPECIES_WARTORTLE||!w[7]||w[28]<16||w[2]) : w[8]!=0)return 1;
    if(w[1]==5&&(w[2]||(w[7]&&w[28]>=16)))return 1;
    LoadMon(&gPlayerParty[0],w+24);sPhase=w[1];sRemaining=w[2];sAward=w[3];gMoveToLearn=w[4];
    sLearningMoveTableID=w[5];sLearnFirst=w[6];sLeveled=w[7];sEvolution=w[8];gBattleMons[1].species=w[9];
    gBattleMons[1].level=w[10];sRegion=w[11];sContextKnown=w[12];sMode=w[13];sSourceAward=w[14];sOverride=w[15];
    for(u32 i=0;i<6;i++)sBasis[i]=w[16+i];sInitialized=1;sImportActive=0;Event(0,0,0);return 0;
}
