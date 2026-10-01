/* Private scalar/source-byte continuation, not an encrypted source save. */
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
#include "constants/flags.h"
#include "constants/vars.h"
#include "constants/game_stat.h"
#include "constants/pokedex.h"
#include "constants/region_map_sections.h"
#include "characters.h"
#include "source_data.inc"

/* Box fields never contain the party-only status/HP/stats/level/mail fields. */
struct BoxPokemon {u32 fields[89];u8 nickname[11],otName[8];};
struct Pokemon {struct BoxPokemon box;u32 party[89];};
struct Runtime {
    struct Pokemon wild,party[PARTY_SIZE];struct BoxPokemon stored,proxy;
    struct {u8 playerTrainerId[4],playerName[8],playerGender;u32 encryptionKey;
        struct {u8 seen[49],owned[49];u32 unownPersonality,spindaPersonality;} pokedex;} save2;
    struct {u8 seen1[49],seen2[49];u32 gameStats[NUM_USED_GAME_STATS];} save1;
    struct {u8 currentBox;} storage;
    u32 phase,initialized,priorSeen,priorCaught,countBefore,newDex,partyBefore,boxMask[14],sendVar,shownFull,bill;
    u32 placement,partySlot,boxNo,boxPos,giveResult,choice,message;
    u8 partyCount,pcBoxToSend;u16 specialBox,specialPos;u32 proxyBox,proxyPos;
};
static struct Runtime sRuntime;
#define gPlayerParty (sRuntime.party)
#define gPlayerPartyCount (sRuntime.partyCount)
#define gSaveBlock2Ptr (&sRuntime.save2)
#define gSaveBlock1Ptr (&sRuntime.save1)
#define gPokemonStoragePtr (&sRuntime.storage)
#define sPCBoxToSendMon (sRuntime.pcBoxToSend)
#define gSpecialVar_MonBoxId (sRuntime.specialBox)
#define gSpecialVar_MonBoxPos (sRuntime.specialPos)
static const u8 gGameLanguage=GAME_LANGUAGE,gGameVersion=GAME_VERSION;
static u8 gLastUsedAbility;
static struct {s32 levelUpHP;} gBattleScripting;
struct NameTemplate {u8 maxChars;};
static struct NameTemplate sNameTemplate={POKEMON_NAME_LENGTH};
static struct {u8 textBuffer[11];u8 *destBuffer;struct NameTemplate *template;} sNameScreen;
#define sNamingScreen (&sNameScreen)
static u32 sInput[80],sInputSeen[80],sInputActive,sInputBad;
static u32 sImport[160],sImportSeen[160],sImportActive,sImportBad;
static u32 sName[11],sNameSeen[11],sNameActive,sNameBad;
static const u8 sMonFields[40]={
    MON_DATA_SPECIES,MON_DATA_PERSONALITY,MON_DATA_OT_ID,MON_DATA_EXP,MON_DATA_LEVEL,
    MON_DATA_FRIENDSHIP,MON_DATA_HP,MON_DATA_MAX_HP,MON_DATA_ATK,MON_DATA_DEF,MON_DATA_SPEED,MON_DATA_SPATK,MON_DATA_SPDEF,
    MON_DATA_HP_IV,MON_DATA_ATK_IV,MON_DATA_DEF_IV,MON_DATA_SPEED_IV,MON_DATA_SPATK_IV,MON_DATA_SPDEF_IV,
    MON_DATA_HP_EV,MON_DATA_ATK_EV,MON_DATA_DEF_EV,MON_DATA_SPEED_EV,MON_DATA_SPATK_EV,MON_DATA_SPDEF_EV,
    MON_DATA_MOVE1,MON_DATA_MOVE2,MON_DATA_MOVE3,MON_DATA_MOVE4,MON_DATA_PP1,MON_DATA_PP2,MON_DATA_PP3,MON_DATA_PP4,
    MON_DATA_PP_BONUSES,MON_DATA_POKEBALL,MON_DATA_MET_LOCATION,MON_DATA_STATUS,MON_DATA_HELD_ITEM,MON_DATA_POKERUS,MON_DATA_ABILITY_NUM
};
static void Zero(void *pointer,u32 size){u8 *p=pointer;while(size--)*p++=0;}
static void BytesCopy(void *to,const void *from,u32 size){u8 *a=to;const u8 *b=from;while(size--)*a++=*b++;}
static void NameCopy(u8 *to,const u8 *from,u32 length)
{bool8 ended=FALSE;for(u32 i=0;i<length;i++){u8 value=ended?EOS:from[i];to[i]=value;if(value==EOS)ended=TRUE;}to[length]=EOS;}
static bool8 PartyField(u32 field)
{return field==MON_DATA_STATUS||field==MON_DATA_LEVEL||field==MON_DATA_MAIL||(field>=MON_DATA_HP&&field<=MON_DATA_SPDEF);}
static u32 GetBoxMonData(struct BoxPokemon *mon,s32 field,...)
{
    if(field<0||field>=89||PartyField(field))__builtin_trap();
    if(field==MON_DATA_SPECIES_OR_EGG)field=MON_DATA_SPECIES;
    if(field==MON_DATA_SANITY_HAS_SPECIES)return mon->fields[MON_DATA_SPECIES]!=SPECIES_NONE;
    if(field==MON_DATA_SANITY_IS_EGG)return FALSE;
    return mon->fields[field];
}
static u32 GetMonData(struct Pokemon *mon,s32 field,...)
{if(field<0||field>=89)__builtin_trap();return PartyField(field)?mon->party[field]:GetBoxMonData(&mon->box,field);}
static u32 ReadValue(s32 field,const void *value)
{
    const u8 *p=value;u32 n=p[0];
    if(field==MON_DATA_PERSONALITY||field==MON_DATA_OT_ID||field==MON_DATA_EXP||field==MON_DATA_STATUS)
        n|=(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;
    else if(field==MON_DATA_SPECIES||field==MON_DATA_HELD_ITEM||(field>=MON_DATA_MOVE1&&field<=MON_DATA_MOVE4)
            ||(field>=MON_DATA_HP&&field<=MON_DATA_SPDEF))n|=(u32)p[1]<<8;
    return n;
}
static void SetBoxMonData(struct BoxPokemon *mon,s32 field,const void *value)
{
    if(field<0||field>=89||PartyField(field))__builtin_trap();
    if(field==MON_DATA_NICKNAME){NameCopy(mon->nickname,value,POKEMON_NAME_LENGTH);return;}
    if(field==MON_DATA_OT_NAME){NameCopy(mon->otName,value,PLAYER_NAME_LENGTH);return;}
    mon->fields[field]=ReadValue(field,value);
}
static void SetMonData(struct Pokemon *mon,s32 field,const void *value)
{if(field<0||field>=89)__builtin_trap();if(PartyField(field))mon->party[field]=ReadValue(field,value);else SetBoxMonData(&mon->box,field,value);}
static u8 GetCurrentRegionMapSectionId(void){return MAPSEC_ROUTE_1;}
static u16 Random(void){__builtin_trap();}
static u16 VarGet(u16 id){if(id!=VAR_PC_BOX_TO_SEND_MON)__builtin_trap();return sRuntime.sendVar;}
static void VarSet(u16 id,u16 value){if(id!=VAR_PC_BOX_TO_SEND_MON||value>=14)__builtin_trap();sRuntime.sendVar=value;}
static bool8 FlagGet(u16 id){if(id==FLAG_SHOWN_BOX_WAS_FULL_MESSAGE)return sRuntime.shownFull;if(id==FLAG_SYS_NOT_SOMEONES_PC)return sRuntime.bill;__builtin_trap();}
static void FlagSet(u16 id){if(id!=FLAG_SHOWN_BOX_WAS_FULL_MESSAGE)__builtin_trap();sRuntime.shownFull=1;}
static void FlagClear(u16 id){if(id!=FLAG_SHOWN_BOX_WAS_FULL_MESSAGE)__builtin_trap();sRuntime.shownFull=0;}
/* Unchanged occupants are opaque. The source allocator only queries species
 * and writes its single chosen destination; no dummy creature is published. */
static struct BoxPokemon *GetBoxedMonPtr(u8 box,u8 slot)
{
    if(box>=14||slot>=30)__builtin_trap();Zero(&sRuntime.proxy,sizeof(sRuntime.proxy));
    sRuntime.proxy.fields[MON_DATA_SPECIES]=(sRuntime.boxMask[box]&(1u<<slot))?SPECIES_SQUIRTLE:SPECIES_NONE;
    sRuntime.proxyBox=box;sRuntime.proxyPos=slot;return &sRuntime.proxy;
}
static u32 GetBoxMonDataAt(u8 box,u8 slot,s32 field)
{if(field!=MON_DATA_SPECIES)__builtin_trap();return GetBoxMonData(GetBoxedMonPtr(box,slot),field);}
static void CopyMon(void *to,const void *from,u32 size)
{
    if(to==&sRuntime.proxy){
        if(size!=sizeof(struct BoxPokemon)||from!=&sRuntime.wild.box)__builtin_trap();
        BytesCopy(&sRuntime.stored,from,size);sRuntime.boxMask[sRuntime.proxyBox]|=1u<<sRuntime.proxyPos;
        sRuntime.placement=2;sRuntime.boxNo=sRuntime.proxyBox;sRuntime.boxPos=sRuntime.proxyPos;return;
    }
    for(u32 i=0;i<PARTY_SIZE;i++)if(to==&gPlayerParty[i]){
        if(size!=sizeof(struct Pokemon)||from!=&sRuntime.wild)__builtin_trap();
        BytesCopy(to,from,size);sRuntime.placement=1;sRuntime.partySlot=i;return;
    }
    __builtin_trap();
}
static u8 GetLevelFromMonExp(struct Pokemon *);u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
u8 GetNature(struct Pokemon *);static u8 GetNatureFromPersonality(u32);static u16 ModifyStatByNature(u8,u16,u8);
static u16 GiveMoveToBoxMon(struct BoxPokemon *,u16);static void DeleteFirstMoveAndGiveMoveToBoxMon(struct BoxPokemon *,u16);
u8 GetBoxMonGender(struct BoxPokemon *);void BoxMonRestorePP(struct BoxPokemon *);static u8 SendMonToPC(struct Pokemon *);
static bool8 IsPokemonStorageFull(void);u8 StorageGetCurrentBox(void);void SetPCBoxToSendMon(u8);u16 GetPCBoxToSendMon(void);
s8 DexScreen_GetSetPokedexFlag(u16,u8,bool8);s8 GetSetPokedexFlag(u16,u8);
u16 SpeciesToNationalPokedexNum(u16);u32 GetGameStat(u8);void SetGameStat(u8,u32);
#include "source_functions.inc"

static void LoadMon(struct Pokemon *mon,const u32 *w)
{Zero(mon,sizeof(*mon));for(u32 i=0;i<40;i++){u32 f=sMonFields[i];if(PartyField(f))mon->party[f]=w[i];else mon->box.fields[f]=w[i];}mon->party[MON_DATA_MAIL]=MAIL_NONE;}
static s32 ValidateMon(const u32 *w)
{
    u32 species=w[0],level=w[4];
    if(!((species==SPECIES_PIDGEY&&level>=2&&level<=5)||(species==SPECIES_RATTATA&&level>=2&&level<=4))
       ||w[3]!=gExperienceTables[gSpeciesInfo[species].growthRate][level]||w[5]!=gSpeciesInfo[species].friendship
       ||!w[6]||w[6]>w[7]||w[33]||w[34]!=ITEM_POKE_BALL||w[35]!=MAPSEC_ROUTE_1||w[36]||w[37]||w[38]
       ||w[39]!=(gSpeciesInfo[species].abilities[1]?(w[1]&1):0))return 1;
    for(u32 i=6;i<=12;i++)if(w[i]>65535)return 1;
    for(u32 i=0;i<6;i++)if(w[13+i]>31||w[19+i])return 1;
    struct Pokemon check;LoadMon(&check,w);CalculateMonStats(&check);
    for(u32 i=7;i<=12;i++)if(GetMonData(&check,sMonFields[i])!=w[i])return 1;
    for(u32 i=0;i<4;i++){check.box.fields[MON_DATA_MOVE1+i]=0;check.box.fields[MON_DATA_PP1+i]=0;}
    GiveBoxMonInitialMoveset(&check.box);
    for(u32 i=0;i<4;i++)if(w[25+i]!=GetMonData(&check,MON_DATA_MOVE1+i)||w[29+i]>GetMonData(&check,MON_DATA_PP1+i))return 1;
    return 0;
}
static bool8 ValidName(const u32 *w,u32 length,bool8 allowBlank)
{
    bool8 ended=FALSE,nonblank=FALSE;
    for(u32 i=0;i<=length;i++){
        if(w[i]>255)return FALSE;
        if(w[i]==EOS){ended=TRUE;continue;}
        if(ended||i==length||!sAllowedNameByte[w[i]])return FALSE;
        if(w[i]!=CHAR_SPACE)nonblank=TRUE;
    }
    return ended&&(allowBlank||nonblank);
}
static u32 PartyMask(void){u32 mask=0;for(u32 i=0;i<6;i++)if(GetMonData(&gPlayerParty[i],MON_DATA_SPECIES))mask|=1u<<i;return mask;}
static u32 DexBit(const u8 *bytes)
{u32 dex=SpeciesToNationalPokedexNum(GetMonData(&sRuntime.wild,MON_DATA_SPECIES))-1;return (bytes[dex/8]>>(dex%8))&1;}
static s32 Start(const u32 *w,bool8 allowFull)
{
    if(ValidateMon(w)||w[40]>1||!ValidName(w+41,7,FALSE)||w[49]>1||w[50]>w[49]||w[51]>0xffffff
       ||w[52]>63||w[53]>=14||w[54]>=14||w[55]>1||w[56]>1)return 1;
    for(u32 i=57;i<71;i++)if(w[i]>=0x40000000u)return 1;
    for(u32 i=71;i<80;i++)if(w[i])return 1;
    struct Runtime prior=sRuntime;Zero(&sRuntime,sizeof(sRuntime));LoadMon(&sRuntime.wild,w);
    for(u32 i=0;i<6;i++)if(w[52]&(1u<<i))gPlayerParty[i].box.fields[MON_DATA_SPECIES]=SPECIES_SQUIRTLE;
    for(u32 i=0;i<14;i++)sRuntime.boxMask[i]=w[57+i];
    sRuntime.storage.currentBox=w[53];sRuntime.sendVar=w[54];sRuntime.shownFull=w[55];sRuntime.bill=w[56];
    if(!allowFull&&IsPlayerPartyAndPokemonStorageFull()){sRuntime=prior;return 4;}
    sRuntime.partyBefore=w[52];CalculatePlayerPartyCount();
    sRuntime.priorSeen=w[49];sRuntime.priorCaught=w[50];sRuntime.countBefore=w[51];
    sRuntime.save2.playerGender=w[40];for(u32 i=0;i<8;i++)sRuntime.save2.playerName[i]=w[41+i];
    for(u32 i=0;i<4;i++)sRuntime.save2.playerTrainerId[i]=w[2]>>(8*i);
    SourceCreationMetadata(&sRuntime.wild.box,w[0],w[4]);
    u16 dex=SpeciesToNationalPokedexNum(w[0]);
    if(w[49])GetSetPokedexFlag(dex,FLAG_SET_SEEN);if(w[50])GetSetPokedexFlag(dex,FLAG_SET_CAUGHT);
    SetGameStat(GAME_STAT_POKEMON_CAPTURES,w[51]);
    sRuntime.partySlot=sRuntime.boxNo=sRuntime.boxPos=sRuntime.giveResult=0xffffffffu;
    sRuntime.initialized=1;return 0;
}
u32 capture_abi_version(void){return 1;}u32 capture_input_word_count(void){return 80;}u32 capture_state_word_count(void){return 160;}
s32 capture_input_begin(void){Zero(sInput,sizeof(sInput));Zero(sInputSeen,sizeof(sInputSeen));sInputActive=1;sInputBad=0;return 0;}
s32 capture_input_set(u32 index,u32 value)
{if(!sInputActive||index>=80||sInputSeen[index]){sInputBad=1;return 1;}sInput[index]=value;sInputSeen[index]=1;return 0;}
s32 capture_start(void)
{
    if(!sInputActive||sRuntime.initialized)return 3;if(sInputBad)return 1;
    for(u32 i=0;i<80;i++)if(!sInputSeen[i])return 1;s32 result=Start(sInput,FALSE);if(!result)sInputActive=0;return result;
}
s32 capture_capacity(void)
{
    if(sInputActive){
        if(sInputBad)return -1;for(u32 i=0;i<80;i++)if(!sInputSeen[i])return -1;
        struct Runtime saved=sRuntime;s32 result=Start(sInput,TRUE);if(!result)result=IsPlayerPartyAndPokemonStorageFull();else result=-1;sRuntime=saved;return result;
    }
    return sRuntime.initialized?IsPlayerPartyAndPokemonStorageFull():-1;
}
static u32 PCMessage(bool8 full){return (full?3:1)+(FlagGet(FLAG_SYS_NOT_SOMEONES_PC)?1:0);}
s32 capture_advance(void)
{
    if(!sRuntime.initialized)return 3;
    if(sRuntime.phase==0){
        u16 species=GetMonData(&sRuntime.wild,MON_DATA_SPECIES),dex=SpeciesToNationalPokedexNum(species);
        u32 personality=GetMonData(&sRuntime.wild,MON_DATA_PERSONALITY);
        /* Deferred ordinary-wild intro effect, then success script ordering. */
        HandleSetPokedexFlag(dex,FLAG_SET_SEEN,personality);
        IncrementGameStat(GAME_STAT_POKEMON_CAPTURES);
        sRuntime.newDex=!GetSetPokedexFlag(dex,FLAG_GET_CAUGHT);
        if(sRuntime.newDex)SourceSetCaught(species,personality);
        sRuntime.phase=1;return 0;
    }
    if(sRuntime.phase!=2)return 3;
    sRuntime.giveResult=GiveMonToPlayer(&sRuntime.wild);
    if(sRuntime.giveResult==MON_CANT_GIVE)__builtin_trap();
    if(sRuntime.giveResult!=MON_GIVEN_TO_PARTY){
        u32 message=PCMessage(ShouldShowBoxWasFullMessage());
        if(sRuntime.choice==1)sRuntime.message=message;
    }
    sRuntime.phase=3;return 0;
}
s32 capture_name_begin(void){Zero(sName,sizeof(sName));Zero(sNameSeen,sizeof(sNameSeen));sNameActive=1;sNameBad=0;return 0;}
s32 capture_name_set(u32 index,u32 value)
{if(!sNameActive||index>=11||sNameSeen[index]||value>255){sNameBad=1;return 1;}sName[index]=value;sNameSeen[index]=1;return 0;}
s32 capture_decide(u32 kind)
{
    if(!sRuntime.initialized||sRuntime.phase!=1)return 3;if(kind>1)return 1;
    if(kind){
        if(!sNameActive||sNameBad)return 1;for(u32 i=0;i<11;i++)if(!sNameSeen[i])return 1;
        if(!ValidName(sName,10,TRUE))return 1;
        for(u32 i=0;i<11;i++)sNamingScreen->textBuffer[i]=sName[i];
        sNamingScreen->destBuffer=sRuntime.wild.box.nickname;sNamingScreen->template=&sNameTemplate;
        SaveInputText();
        if(CalculatePlayerPartyCount()>=PARTY_SIZE)sRuntime.message=PCMessage(IsDestinationBoxFull());
    }
    sRuntime.choice=kind+1;sRuntime.phase=2;sNameActive=0;return 0;
}
u32 capture_constant(u32 index)
{switch(index){case 0:return MAPSEC_ROUTE_1;case 1:return GAME_LANGUAGE;case 2:return GAME_VERSION;case 3:return ITEM_POKE_BALL;case 4:return TOTAL_BOXES_COUNT;case 5:return IN_BOX_COUNT;default:return 0;}}
u32 capture_get(u32 field)
{
    if(!sRuntime.initialized)return 0;
    switch(field){case 0:return sRuntime.phase;case 1:return GetNature(&sRuntime.wild);case 2:return GetMonAbility(&sRuntime.wild);case 3:return GetMonGender(&sRuntime.wild);
    case 4:return sRuntime.placement;case 5:return sRuntime.newDex;case 6:return GetGameStat(GAME_STAT_POKEMON_CAPTURES);default:return 0;}
}
u32 capture_mon_get(u32 index){return index<40?GetMonData(&sRuntime.wild,sMonFields[index]):0;}
u32 capture_state_get(u32 index)
{
    if(index>=32&&index<46)return sRuntime.boxMask[index-32];
    if(index>=46&&index<54)return sRuntime.wild.box.otName[index-46];
    if(index>=54&&index<65)return sRuntime.wild.box.nickname[index-54];
    if(index>=80&&index<120)return capture_mon_get(index-80);
    switch(index){case 0:return 1;case 1:return sRuntime.phase;case 2:return sRuntime.initialized;case 3:return sRuntime.save2.playerGender;
    case 4:return sRuntime.priorSeen;case 5:return sRuntime.priorCaught;case 6:return sRuntime.initialized?DexBit(sRuntime.save2.pokedex.seen):0;
    case 7:return sRuntime.initialized?DexBit(sRuntime.save2.pokedex.owned):0;case 8:return sRuntime.countBefore;case 9:return GetGameStat(GAME_STAT_POKEMON_CAPTURES);
    case 10:return sRuntime.newDex;case 11:return sRuntime.partyBefore;case 12:return PartyMask();case 13:return gPlayerPartyCount;
    case 14:return StorageGetCurrentBox();case 15:return sRuntime.sendVar;case 16:return sRuntime.shownFull;case 17:return sRuntime.bill;case 18:return GetPCBoxToSendMon();
    case 19:return sRuntime.placement;case 20:return sRuntime.partySlot;case 21:return sRuntime.boxNo;case 22:return sRuntime.boxPos;case 23:return sRuntime.giveResult;
    case 24:return sRuntime.choice;case 25:return sRuntime.message;case 27:return sRuntime.initialized?DexBit(sRuntime.save1.seen1):0;
    case 28:return sRuntime.initialized?DexBit(sRuntime.save1.seen2):0;case 30:return sRuntime.phase==3;
    case 65:return GetMonData(&sRuntime.wild,MON_DATA_MET_LEVEL);case 66:return GetMonData(&sRuntime.wild,MON_DATA_MET_GAME);
    case 67:return GetMonData(&sRuntime.wild,MON_DATA_LANGUAGE);case 68:return GetMonData(&sRuntime.wild,MON_DATA_OT_GENDER);case 69:return GetMonData(&sRuntime.wild,MON_DATA_MAIL);
    default:return 0;}
}
s32 capture_import_begin(void){Zero(sImport,sizeof(sImport));Zero(sImportSeen,sizeof(sImportSeen));sImportActive=1;sImportBad=0;return 0;}
s32 capture_import_set(u32 index,u32 value)
{if(!sImportActive||index>=160||sImportSeen[index]){sImportBad=1;return 1;}sImport[index]=value;sImportSeen[index]=1;return 0;}
s32 capture_import_commit(void)
{
    if(!sImportActive)return 3;if(sImportBad)return 1;for(u32 i=0;i<160;i++)if(!sImportSeen[i])return 1;
    const u32 *w=sImport;
    if(w[0]!=1||w[1]>3||w[2]!=1||w[24]>2||(w[1]<2?w[24]!=0:w[24]==0)||!ValidName(w+46,7,FALSE)||!ValidName(w+54,10,FALSE))return 1;
    u32 input[80]={0};for(u32 i=0;i<40;i++)input[i]=w[80+i];input[40]=w[3];for(u32 i=0;i<8;i++)input[41+i]=w[46+i];
    input[49]=w[4];input[50]=w[5];input[51]=w[8];input[52]=w[11];input[53]=w[14];input[54]=w[15];input[55]=w[16];input[56]=w[17];
    for(u32 i=0;i<14;i++)input[57+i]=w[32+i];
    if(w[1]==3&&w[19]==2){if(w[21]>=14||w[22]>=30)return 1;input[57+w[21]]&=~(1u<<w[22]);}
    /* Source naming/Give may overwrite sendVar/flag. Try their finite legal
     * preimages; host immutable admission replay proves the actual history. */
    struct Runtime saved=sRuntime;bool8 found=FALSE;
    u32 savedName[11],savedNameSeen[11],savedNameActive=sNameActive,savedNameBad=sNameBad;
    BytesCopy(savedName,sName,sizeof(sName));BytesCopy(savedNameSeen,sNameSeen,sizeof(sNameSeen));
    for(u32 box=0;box<14&&!found;box++)for(u32 flag=0;flag<2&&!found;flag++){
        input[54]=box;input[55]=flag;
        if(Start(input,FALSE))continue;
        if(w[1]>=1&&capture_advance())continue;
        if(w[1]>=2){
            if(w[24]==2){for(u32 i=0;i<11;i++)sName[i]=w[54+i];for(u32 i=0;i<11;i++)sNameSeen[i]=1;sNameActive=1;sNameBad=0;}
            if(capture_decide(w[24]-1))continue;
        }
        if(w[1]>=3&&capture_advance())continue;
        found=TRUE;for(u32 i=0;i<160;i++)if(capture_state_get(i)!=w[i]){found=FALSE;break;}
    }
    if(!found){
        sRuntime=saved;BytesCopy(sName,savedName,sizeof(sName));BytesCopy(sNameSeen,savedNameSeen,sizeof(sNameSeen));
        sNameActive=savedNameActive;sNameBad=savedNameBad;return 1;
    }
    sImportActive=0;sNameActive=0;return 0;
}
