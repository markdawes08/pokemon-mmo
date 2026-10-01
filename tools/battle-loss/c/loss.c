/* Private loss continuation. Scalar transport is not a source save format. */
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
#include "constants/opponents.h"
#include "constants/flags.h"
#include "constants/vars.h"
#include "constants/maps.h"
#include "constants/map_event_ids.h"
#include "constants/heal_locations.h"
#include "source_data.inc"

struct BoxPokemon {u32 fields[89];};
struct Pokemon {struct BoxPokemon box;};
struct Runtime {
    struct Pokemon party[PARTY_SIZE];
    struct {u32 money;struct WarpData lastHealLocation;struct {bool8 spokeToOwner;} trainerTower[1];u8 towerChallengeId;struct {u8 holdEffect;} enigmaBerry;} save;
    struct InitialPlayerAvatarState avatar;
    struct WarpData destination;
    u32 phase,initialized,basis[6],moneyBefore,preview,badges,healId,opponentLevel,outcome;
    u32 fieldFlags,fieldVars[3],eliteFlags,championFlags,leagueVar,brock,tower;
    u32 friendshipBefore,friendshipLoss,arrival,healer,pendingWarp;
};
static struct Runtime sRuntime;
#define gPlayerParty (sRuntime.party)
#define gSaveBlock1Ptr (&sRuntime.save)
#define sInitialPlayerAvatarState (sRuntime.avatar)
#define sWarpDestination (sRuntime.destination)
#define gSpecialVar_LastTalked (sRuntime.healer)
static const u8 gPlayerPartyCount=1;
static struct {u32 encryptionKey;} sSave2;
#define gSaveBlock2Ptr (&sSave2)
static struct {u8 level;} gBattleMons[2];
static const u8 gBattlerPartyIndexes[2]={0,0};
static u32 gBattleTypeFlags;
static struct {bool8 inBattle;} gMain={TRUE};
static struct {u8 holdEffect;} gEnigmaBerries[1];
static struct {u8 trainerClass;} gTrainers[1];
static u16 gTrainerBattleOpponent_A;
static struct {s32 levelUpHP;} gBattleScripting;
static struct {u8 tState;} gTasks[1];
static const u8 EventScript_ResetEliteFourEnd[1]={0};
static u32 sInput[64],sInputSeen[64],sInputActive,sInputBad;
static u32 sImport[96],sImportSeen[96],sImportActive,sImportBad;
static const u8 sMonFields[40]={
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
    if(field==MON_DATA_SANITY_HAS_SPECIES)return mon->fields[MON_DATA_SPECIES]!=SPECIES_NONE;
    if(field==MON_DATA_SANITY_IS_EGG)return FALSE;
    if(field<0||field>=89)__builtin_trap();return mon->fields[field];
}
static u32 GetMonData(struct Pokemon *mon,s32 field,...) {return GetBoxMonData(&mon->box,field);}
static void SetBoxMonData(struct BoxPokemon *mon,s32 field,const void *value)
{
    if(field<0||field>=89)__builtin_trap();const u8 *p=value;u32 n=p[0];
    if(field==MON_DATA_PERSONALITY||field==MON_DATA_OT_ID||field==MON_DATA_EXP||field==MON_DATA_STATUS)
        n|=(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;
    else if(field==MON_DATA_SPECIES||field==MON_DATA_HELD_ITEM||(field>=MON_DATA_MOVE1&&field<=MON_DATA_MOVE4)
            ||(field>=MON_DATA_HP&&field<=MON_DATA_SPDEF))n|=(u32)p[1]<<8;
    mon->fields[field]=n;
}
static void SetMonData(struct Pokemon *mon,s32 field,const void *p) {SetBoxMonData(&mon->box,field,p);}
static u8 ItemId_GetHoldEffect(u16 item) {if(item!=ITEM_NONE)__builtin_trap();return HOLD_EFFECT_NONE;}
static u16 Random(void) {__builtin_trap();}
static u8 GetCurrentRegionMapSectionId(void) {__builtin_trap();}
static u8 GetBattlerAtPosition(u8 position) {if(position!=B_POSITION_OPPONENT_LEFT)__builtin_trap();return 1;}
static bool8 FlagGet(u16 id)
{
    for(u32 i=0;i<NELEMS(sWhiteOutMoneyLossBadgeFlagIDs);i++)if(id==sWhiteOutMoneyLossBadgeFlagIDs[i])return (sRuntime.badges>>i)&1;
    if(id==FLAG_DEFEATED_BROCK)return sRuntime.brock;
    for(u32 i=0;i<NELEMS(sFieldFlags);i++)if(id==sFieldFlags[i])return (sRuntime.fieldFlags>>i)&1;
    for(u32 i=0;i<NELEMS(sEliteFlags);i++)if(id==sEliteFlags[i])return (sRuntime.eliteFlags>>i)&1;
    __builtin_trap();
}
static void FlagClear(u16 id)
{
    for(u32 i=0;i<NELEMS(sFieldFlags);i++)if(id==sFieldFlags[i]){sRuntime.fieldFlags&=~(1u<<i);return;}
    for(u32 i=0;i<NELEMS(sEliteFlags);i++)if(id==sEliteFlags[i]){sRuntime.eliteFlags&=~(1u<<i);return;}
    __builtin_trap();
}
static void ClearTrainerFlag(u16 id)
{for(u32 i=0;i<NELEMS(sChampionFlags);i++)if(id==sChampionFlags[i]){sRuntime.championFlags&=~(1u<<i);return;}__builtin_trap();}
static u16 VarGet(u16 id)
{
    for(u32 i=0;i<NELEMS(sFieldVars);i++)if(id==sFieldVars[i])return sRuntime.fieldVars[i];
    if(id==VAR_MAP_SCENE_TRAINER_TOWER)return sRuntime.tower;
    if(id==sLeagueVars[0])return sRuntime.leagueVar;__builtin_trap();
}
static void VarSet(u16 id,u16 value)
{
    for(u32 i=0;i<NELEMS(sFieldVars);i++)if(id==sFieldVars[i]){sRuntime.fieldVars[i]=value;return;}
    if(id==VAR_MAP_SCENE_TRAINER_TOWER){sRuntime.tower=value;return;}
    if(id==sLeagueVars[0]){sRuntime.leagueVar=value;return;}__builtin_trap();
}
static void RunScriptImmediately(const u8 *script)
{
    if(script!=EventScript_ResetEliteFourEnd)__builtin_trap();
    for(u32 i=0;i<NELEMS(sEliteFourReset);i++) {
        if(sEliteFourReset[i].kind==1)FlagClear(sEliteFourReset[i].id);
        else if(sEliteFourReset[i].kind==2)ClearTrainerFlag(sEliteFourReset[i].id);
        else if(sEliteFourReset[i].kind==3)VarSet(sEliteFourReset[i].id,sEliteFourReset[i].value);
        else __builtin_trap();
    }
}
/* All map application is deferred; this is the declared external boundary. */
static void WarpIntoMap(void) {sRuntime.pendingWarp=1;}
static u8 GetLevelFromMonExp(struct Pokemon *);
u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
u8 GetNature(struct Pokemon *);
static u8 GetNatureFromPersonality(u32);
static u16 ModifyStatByNature(u8,u16,u8);
static void Overworld_ResetStateAfterWhitingOut(void);
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
static s32 ValidateMon(const u32 *w,const u32 *basis)
{
    if(w[0]!=SPECIES_SQUIRTLE||w[1]!=25||w[2]!=1||w[4]<1||w[4]>MAX_LEVEL
       ||w[3]>gExperienceTables[gSpeciesInfo[SPECIES_SQUIRTLE].growthRate][MAX_LEVEL]
       ||w[5]>255||w[6]>w[7]||!w[7]||w[33]>255||w[37]||w[38]||w[39])return 1;
    for(u32 i=6;i<=12;i++)if(w[i]>65535)return 1;
    if(w[34]!=0xffffffffu&&w[34]!=ITEM_POKE_BALL&&w[34]!=ITEM_LUXURY_BALL)return 1;
    if(w[35]!=0xffffffffu&&w[35]>255)return 1;
    u32 total=0;for(u32 i=0;i<6;i++){if(w[13+i]!=15||w[19+i]>255||basis[i]>w[19+i])return 1;total+=w[19+i];}
    if(total>MAX_TOTAL_EVS)return 1;
    bool8 empty=FALSE;
    for(u32 i=0;i<4;i++) {
        u32 move=w[25+i];
        if(!LegalMove(move,w[4])||(empty&&move)||w[29+i]>CalculatePPWithBonus(move,w[33],i))return 1;
        if(!move)empty=TRUE;
        for(u32 j=0;j<i;j++)if(move&&move==w[25+j])return 1;
    }
    struct Pokemon check;LoadMon(&check,w);if(GetLevelFromMonExp(&check)!=w[4])return 1;
    for(u32 i=0;i<6;i++)check.box.fields[MON_DATA_HP_EV+i]=basis[i];
    CalculateMonStats(&check);
    for(u32 i=7;i<=12;i++)if(GetMonData(&check,sMonFields[i])!=w[i])return 1;
    return 0;
}
static s32 Start(const u32 *w)
{
    if(ValidateMon(w,w+40)||w[6]||w[46]>MAX_MONEY||w[47]>255||w[48]<1||w[48]>NELEMS(sHealLocations)
       ||w[49]<1||w[49]>MAX_LEVEL||(w[50]!=B_OUTCOME_LOST&&w[50]!=B_OUTCOME_DREW)||w[51]>63
       ||w[52]>65535||w[53]>65535||w[54]>65535||w[55]>31||w[56]>63||w[57]>65535
       ||w[58]>255||w[59]<DIR_SOUTH||w[59]>DIR_EAST||w[60]>1||w[61]>1||w[62]||w[63])return 1;
    Zero(&sRuntime,sizeof(sRuntime));LoadMon(&gPlayerParty[0],w);
    for(u32 i=0;i<6;i++)sRuntime.basis[i]=w[40+i];
    sRuntime.moneyBefore=gSaveBlock1Ptr->money=w[46];sRuntime.badges=w[47];sRuntime.healId=w[48];
    sRuntime.opponentLevel=w[49];sRuntime.outcome=w[50];sRuntime.fieldFlags=w[51];
    for(u32 i=0;i<3;i++)sRuntime.fieldVars[i]=w[52+i];
    sRuntime.eliteFlags=w[55];sRuntime.championFlags=w[56];sRuntime.leagueVar=w[57];
    sInitialPlayerAvatarState.transitionFlags=w[58];sInitialPlayerAvatarState.direction=w[59];sInitialPlayerAvatarState.hasDirectionSet=w[60];
    sRuntime.brock=w[61];sRuntime.friendshipBefore=w[5];
    const struct HealLocation *loc=GetHealLocation(w[48]);
    gSaveBlock1Ptr->lastHealLocation=(struct WarpData){loc->mapGroup,loc->mapNum,WARP_ID_NONE,loc->x,loc->y};
    sRuntime.preview=ComputeWhiteOutMoneyLoss();sRuntime.initialized=1;return 0;
}
u32 loss_abi_version(void){return 1;}
u32 loss_input_word_count(void){return 64;}
u32 loss_state_word_count(void){return 96;}
s32 loss_input_begin(void){Zero(sInput,sizeof(sInput));Zero(sInputSeen,sizeof(sInputSeen));sInputActive=1;sInputBad=0;return 0;}
s32 loss_input_set(u32 index,u32 value)
{if(!sInputActive||index>=64||sInputSeen[index]){sInputBad=1;return 1;}sInput[index]=value;sInputSeen[index]=1;return 0;}
s32 loss_start(void)
{
    if(!sInputActive||sRuntime.initialized)return 3;if(sInputBad)return 1;
    for(u32 i=0;i<64;i++)if(!sInputSeen[i])return 1;
    s32 result=Start(sInput);if(!result)sInputActive=0;return result;
}
s32 loss_advance(void)
{
    if(!sRuntime.initialized||sRuntime.phase>1)return 3;
    if(sRuntime.phase==0){
        gBattleMons[0].level=GetMonData(&gPlayerParty[0],MON_DATA_LEVEL);gBattleMons[1].level=sRuntime.opponentLevel;
        AdjustFriendshipOnBattleFaint(0);
        sRuntime.friendshipLoss=sRuntime.friendshipBefore-GetMonData(&gPlayerParty[0],MON_DATA_FRIENDSHIP);
        sRuntime.phase=1;
    }else{
        SourceWhiteoutMechanics();
        if(!sRuntime.pendingWarp)__builtin_trap();
        sRuntime.arrival=SourceMomArrival()?1:(FlagGet(FLAG_DEFEATED_BROCK)?3:2);
        sRuntime.phase=2;
    }
    return 0;
}
u32 loss_get(u32 field)
{
    switch(field){case 0:return sRuntime.phase;case 1:return sRuntime.preview;case 2:return GetMoney(&gSaveBlock1Ptr->money);
    case 3:return sRuntime.friendshipLoss;case 4:return sRuntime.arrival;case 5:return sRuntime.healer;default:return 0;}
}
u32 loss_mon_get(u32 index){return index<40?GetMonData(&gPlayerParty[0],sMonFields[index]):0;}
static u32 WarpWord(const struct WarpData *warp,u32 field)
{switch(field){case 0:return (s32)warp->mapGroup;case 1:return (s32)warp->mapNum;case 2:return (s32)warp->warpId;case 3:return (s32)warp->x;case 4:return (s32)warp->y;default:return 0;}}
u32 loss_state_get(u32 index)
{
    if(index>=48&&index<88)return loss_mon_get(index-48);
    if(index>=36&&index<42)return sRuntime.basis[index-36];
    if(index>=23&&index<28)return WarpWord(&sWarpDestination,index-23);
    if(index>=28&&index<33)return WarpWord(&gSaveBlock1Ptr->lastHealLocation,index-28);
    if(index>=10&&index<13)return sRuntime.fieldVars[index-10];
    switch(index){
    case 0:return 1;case 1:return sRuntime.phase;case 2:return sRuntime.moneyBefore;case 3:return GetMoney(&gSaveBlock1Ptr->money);
    case 4:return sRuntime.preview;case 5:return sRuntime.badges;case 6:return sRuntime.healId;case 7:return sRuntime.opponentLevel;
    case 8:return sRuntime.outcome;case 9:return sRuntime.fieldFlags;case 13:return sRuntime.eliteFlags;case 14:return sRuntime.championFlags;
    case 15:return sRuntime.leagueVar;case 16:return sInitialPlayerAvatarState.transitionFlags;case 17:return sInitialPlayerAvatarState.direction;
    case 18:return sInitialPlayerAvatarState.hasDirectionSet;case 19:return sRuntime.brock;case 20:return sRuntime.tower;
    case 21:return sRuntime.healer;case 22:return sRuntime.arrival;case 33:return sRuntime.friendshipBefore;
    case 34:return sRuntime.friendshipLoss;case 35:return sRuntime.initialized;default:return 0;}
}
u32 loss_context_count(u32 kind){static const u8 counts[]={8,6,3,5,6,1};return kind<6?counts[kind]:0;}
u32 loss_context_id(u32 kind,u32 index)
{
    if(index>=loss_context_count(kind))return 0;
    switch(kind){case 0:return sWhiteOutMoneyLossBadgeFlagIDs[index];case 1:return sFieldFlags[index];case 2:return sFieldVars[index];
    case 3:return sEliteFlags[index];case 4:return sChampionFlags[index];case 5:return sLeagueVars[index];default:return 0;}
}
u32 loss_heal_get(u32 id,u32 field)
{
    const struct HealLocation *loc=GetHealLocation(id);if(!loc||field>=5)return 0;
    const struct WarpData warp={loc->mapGroup,loc->mapNum,WARP_ID_NONE,loc->x,loc->y};return WarpWord(&warp,field);
}
s32 loss_import_begin(void){Zero(sImport,sizeof(sImport));Zero(sImportSeen,sizeof(sImportSeen));sImportActive=1;sImportBad=0;return 0;}
s32 loss_import_set(u32 index,u32 value)
{if(!sImportActive||index>=96||sImportSeen[index]){sImportBad=1;return 1;}sImport[index]=value;sImportSeen[index]=1;return 0;}
s32 loss_import_commit(void)
{
    if(!sImportActive)return 3;if(sImportBad)return 1;for(u32 i=0;i<96;i++)if(!sImportSeen[i])return 1;
    const u32 *w=sImport;if(w[0]!=1||w[1]>2||w[35]!=1||w[33]>255)return 1;
    for(u32 i=42;i<48;i++)if(w[i])return 1;for(u32 i=88;i<96;i++)if(w[i])return 1;
    /* Reconstruct a valid pre-effect state and replay both source transitions.
     * Phase2 necessarily erases old PP/status/reset flags; historical proof is
     * supplied by immutable host admission replay, not invented in raw words. */
    u32 input[64]={0};for(u32 i=0;i<40;i++)input[i]=w[48+i];for(u32 i=0;i<6;i++)input[40+i]=w[36+i];
    input[5]=w[33];input[6]=0;input[46]=w[2];input[47]=w[5];input[48]=w[6];input[49]=w[7];input[50]=w[8];
    input[51]=w[9];for(u32 i=0;i<3;i++)input[52+i]=w[10+i];
    input[55]=w[13];input[56]=w[14];input[57]=w[15];input[58]=w[16];input[59]=w[17];input[60]=w[18];input[61]=w[19];input[62]=w[20];
    struct Runtime saved=sRuntime;
    if(Start(input)){sRuntime=saved;return 1;}
    for(u32 i=0;i<w[1];i++)if(loss_advance()){sRuntime=saved;return 1;}
    for(u32 i=0;i<96;i++)if(loss_state_get(i)!=w[i]){sRuntime=saved;return 1;}
    sImportActive=0;return 0;
}
