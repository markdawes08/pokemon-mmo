/* Complete source friendship bodies execute only the two negative faint
 * events. Positive-event metadata/random services are explicit tripwires. */
static u32 gBattleTypeFlags;
static struct {u8 inBattle;} gMain;
static struct {u8 holdEffect;} gEnigmaBerries[1];
static struct {struct {u8 holdEffect;} enigmaBerry;} sSave,*gSaveBlock1Ptr=&sSave;
static struct {u8 trainerClass;} gTrainers[1];
static u16 gTrainerBattleOpponent_A;
static struct Pokemon gPlayerParty[1];
static struct {u8 level;} gBattleMons[2];
static u8 gBattlerPartyIndexes[2];
static u8 GetBattlerAtPosition(u8 position){if(position!=B_POSITION_OPPONENT_LEFT)__builtin_trap();return 1;}
static u8 ItemId_GetHoldEffect(u16 item){if(item)__builtin_trap();return HOLD_EFFECT_NONE;}
static u16 Random(void){__builtin_trap();}
static u8 GetCurrentRegionMapSectionId(void){__builtin_trap();}
static void AdjustFriendship(struct Pokemon *,u8);
#include "party_friendship.inc"
s32 PartyValidate(const u32 *w){return ValidateMon(w,w+40);}
u32 PartyMonField(const u32 *w,u32 field){struct Pokemon m;LoadMon(&m,w);u32 species=w[0];
 if(field==0)return GetMonAbility(&m);if(field==1)return GetNature(&m);if(field==2)return GetMonGender(&m);
 if(field<5)return gSpeciesInfo[species].types[field-3];if(field<9)return CalculatePPWithBonus(w[25+field-5],w[33],field-5);return 0;}
void PartyFaintFriendship(u32 *w,u32 opposingLevel){LoadMon(&gPlayerParty[0],w);gBattleMons[0].level=w[4];gBattleMons[1].level=opposingLevel;
 AdjustFriendshipOnBattleFaint(0);w[5]=GetMonData(&gPlayerParty[0],MON_DATA_FRIENDSHIP);}
