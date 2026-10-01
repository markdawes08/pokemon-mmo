/* Separate diagnostic family profile over the retained command kernel. */
static u8 gBattlerByTurnOrder[4],sFamilyOrderReady;
static const u8 BattleScript_StatDown[]={31},BattleScript_FlinchPrevention[]={32},BattleScript_MoveUsedFlinched[]={33};
static bool8 FamilyIdentity(u32 species,u32 ability);
static bool8 FamilyWildTransport(u8 buffer,u8 action,u16 value);
bool8 FamilyMoveAllowed(u32 move);
u32 FamilyMaxPP(u32 move,u32 bonuses,u32 slot);
bool8 FamilyLegalMove(u32 move,u32 species,u32 level);
static u8 ChangeStatBuffs(s8,u8,u8,const u8 *);
void FamilyResetInputs(void);
static void FamilyReset(void);
static void FamilyBeginTurn(void);
static s32 FamilyAttack(u32 actor,u32 slot);
static u8 GetBattlerTurnOrderNum(u8 battler);
