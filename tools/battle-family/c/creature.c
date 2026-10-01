/* Source creature admission for private family combat; no owned mutation. */
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
#include "creature_data.inc"

struct BoxPokemon {u32 fields[89];u8 nickname[11];};
struct Pokemon {struct BoxPokemon box;};
static const u8 sMonFields[40]={
    MON_DATA_SPECIES,MON_DATA_PERSONALITY,MON_DATA_OT_ID,MON_DATA_EXP,MON_DATA_LEVEL,
    MON_DATA_FRIENDSHIP,MON_DATA_HP,MON_DATA_MAX_HP,MON_DATA_ATK,MON_DATA_DEF,MON_DATA_SPEED,MON_DATA_SPATK,MON_DATA_SPDEF,
    MON_DATA_HP_IV,MON_DATA_ATK_IV,MON_DATA_DEF_IV,MON_DATA_SPEED_IV,MON_DATA_SPATK_IV,MON_DATA_SPDEF_IV,
    MON_DATA_HP_EV,MON_DATA_ATK_EV,MON_DATA_DEF_EV,MON_DATA_SPEED_EV,MON_DATA_SPATK_EV,MON_DATA_SPDEF_EV,
    MON_DATA_MOVE1,MON_DATA_MOVE2,MON_DATA_MOVE3,MON_DATA_MOVE4,MON_DATA_PP1,MON_DATA_PP2,MON_DATA_PP3,MON_DATA_PP4,
    MON_DATA_PP_BONUSES,MON_DATA_POKEBALL,MON_DATA_MET_LOCATION,MON_DATA_STATUS,MON_DATA_HELD_ITEM,MON_DATA_POKERUS,MON_DATA_ABILITY_NUM
};
static void Zero(void *p,u32 n){u8 *b=p;while(n--)*b++=0;}
static u32 GetBoxMonData(struct BoxPokemon *m,s32 f,...){if(f==MON_DATA_SPECIES_OR_EGG)f=MON_DATA_SPECIES;if(f<0||f>=89)__builtin_trap();return m->fields[f];}
static u32 GetMonData(struct Pokemon *m,s32 f,...){return GetBoxMonData(&m->box,f);}
static void SetBoxMonData(struct BoxPokemon *m,s32 f,const void *v){if(f<0||f>=89)__builtin_trap();const u8 *p=v;u32 n=p[0];
if(f==MON_DATA_PERSONALITY||f==MON_DATA_OT_ID||f==MON_DATA_EXP||f==MON_DATA_STATUS)n|=(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;
else if(f==MON_DATA_SPECIES||f==MON_DATA_HELD_ITEM||(f>=MON_DATA_MOVE1&&f<=MON_DATA_MOVE4)||(f>=MON_DATA_HP&&f<=MON_DATA_SPDEF))n|=(u32)p[1]<<8;m->fields[f]=n;}
static void SetMonData(struct Pokemon *m,s32 f,const void *v){SetBoxMonData(&m->box,f,v);}
static struct {s32 levelUpHP;} gBattleScripting;static u8 gLastUsedAbility;
static u8 GetLevelFromMonExp(struct Pokemon *);u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
u8 GetNature(struct Pokemon *);static u8 GetNatureFromPersonality(u32);static u16 ModifyStatByNature(u8,u16,u8);u8 GetBoxMonGender(struct BoxPokemon *);
bool8 FamilyMoveAllowed(u32);s32 FamilyApplyMon(u32,const u32 *,u32,u32,u32);
#include "creature_functions.inc"
static bool8 SpeciesAllowed(u32 species)
{return (species>=SPECIES_SQUIRTLE&&species<=SPECIES_BLASTOISE)||(species>=SPECIES_PIDGEY&&species<=SPECIES_RATICATE);}
static void LoadMon(struct Pokemon *mon,const u32 *w)
{Zero(mon,sizeof(*mon));for(u32 i=0;i<40;i++)mon->box.fields[sMonFields[i]]=w[i];mon->box.fields[MON_DATA_LANGUAGE]=GAME_LANGUAGE;}
static bool8 LegalMove(u32 move,u32 species,u32 level)
{
    if(!move)return TRUE;if(move>=MOVES_COUNT||!FamilyMoveAllowed(move)||move==MOVE_STRUGGLE)return FALSE;
    u32 first=species<=SPECIES_BLASTOISE?SPECIES_SQUIRTLE:species<=SPECIES_PIDGEOT?SPECIES_PIDGEY:SPECIES_RATTATA;
    for(u32 s=first;s<=species;s++)for(u32 i=0;gLevelUpLearnsets[s][i]!=LEVEL_UP_END;i++)
        if((gLevelUpLearnsets[s][i]&LEVEL_UP_MOVE_ID)==move&&(gLevelUpLearnsets[s][i]>>9)<=level)return TRUE;
    return FALSE;
}
static s32 ValidateMon(const u32 *w,const u32 *basis)
{
    u32 species=w[0],level=w[4];
    if(!SpeciesAllowed(species)||level<1||level>MAX_LEVEL||w[3]>gExperienceTables[gSpeciesInfo[species].growthRate][MAX_LEVEL]
       ||w[5]>255||!w[6]||w[6]>w[7]||!w[7]||w[33]>255||w[38]||w[39]>1||!gSpeciesInfo[species].abilities[w[39]]
       ||w[37]||(w[36]!=0&&w[36]!=STATUS1_POISON&&w[36]!=STATUS1_BURN))return 1;
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
bool8 FamilyLegalMove(u32 move,u32 species,u32 level)
{return SpeciesAllowed(species)&&level>=1&&level<=100&&LegalMove(move,species,level);}

static u32 sInput[2][46],sSeen[2][46],sActive[2],sBad[2],sValid[2];static struct Pokemon sValidated[2];
void FamilyResetInputs(void){Zero(sInput,sizeof(sInput));Zero(sSeen,sizeof(sSeen));Zero(sActive,sizeof(sActive));Zero(sBad,sizeof(sBad));Zero(sValid,sizeof(sValid));Zero(sValidated,sizeof(sValidated));}
u32 family_input_word_count(void){return 46;}
s32 family_input_begin(u32 actor){if(actor>=2)return 1;Zero(sInput[actor],sizeof(sInput[actor]));Zero(sSeen[actor],sizeof(sSeen[actor]));sActive[actor]=1;sBad[actor]=0;return 0;}
s32 family_input_set(u32 actor,u32 index,u32 value){if(actor>=2)return 1;if(!sActive[actor]||index>=46||sSeen[actor][index]){sBad[actor]=1;return 1;}sInput[actor][index]=value;sSeen[actor][index]=1;return 0;}
s32 family_input_commit(u32 actor){if(actor>=2||!sActive[actor])return 3;if(sBad[actor])return 1;for(u32 i=0;i<46;i++)if(!sSeen[actor][i])return 1;
const u32 *w=sInput[actor];if(ValidateMon(w,w+40))return 1;struct Pokemon mon;LoadMon(&mon,w);u32 species=w[0];
s32 status=FamilyApplyMon(actor,w,GetMonAbility(&mon),gSpeciesInfo[species].types[0],gSpeciesInfo[species].types[1]);
if(status)return status;sValidated[actor]=mon;sValid[actor]=1;sActive[actor]=0;return 0;}
u32 FamilyMaxPP(u32 move,u32 bonuses,u32 slot){if(move>=MOVES_COUNT||bonuses>255||slot>=4)return 0;return CalculatePPWithBonus(move,bonuses,slot);}
u32 family_mon_get(u32 actor,u32 field){if(actor>=2||!sValid[actor])return 0;struct Pokemon *m=&sValidated[actor];u32 species=GetMonData(m,MON_DATA_SPECIES);
if(field==0)return GetMonAbility(m);if(field==1)return GetNature(m);if(field==2)return GetMonGender(m);
if(field<5)return gSpeciesInfo[species].types[field-3];if(field<9)return CalculatePPWithBonus(GetMonData(m,MON_DATA_MOVE1+field-5),GetMonData(m,MON_DATA_PP_BONUSES),field-5);return 0;}
