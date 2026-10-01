/* Additions to the shared source-command engine; private real-team profile. */
#include "route1_source_declarations.inc"
static u8 sRoute1Started, gCurrentTurnActionNumber;
#ifdef WATERBLUE_FAMILY
#include "family_declarations.inc"
#endif
static u8 gBattleTextBuff1[16], gBattleTextBuff2[16];
static const u8 BattleScript_MistProtected[] = {20}, BattleScript_ButItFailed[] = {21};
static const u8 BattleScript_AbilityNoStatLoss[] = {22}, BattleScript_AbilityNoSpecificStatLoss[] = {23};
static const u8 BattleScript_NoMovesLeft[] = {24};
static const u8 *gSelectionBattleScripts[4];
static u8 gBattleBufferB[4][4];
static u16 sCapturedBall;
static u8 sCapturedShakes;
static u32 sItemId, sItemRestored, sItemOdds, sItemThreshold, sItemShakes;
static const u8 BattleScript_SuccessBallThrow[] = {25}, BattleScript_ShakeBallThrow[] = {26};
static struct { bool8 inBattle; } gMain = {TRUE};
#ifndef NULL
#define NULL ((void *)0)
#endif
static u32 Route1GetMonData(struct Pokemon *mon, s32 field, void *unused);
static void Route1SetMonData(struct Pokemon *mon, s32 field, const void *data);
static u16 Sqrt(u32 value);
static void BtlController_EmitGetMonData(u8 buffer, u8 request, u8 party);
static void BtlController_EmitBallThrowAnim(u8 buffer, u8 shakes);
static u8 CalculatePlayerPartyCount(void);
static void Route1ResetItems(void);
static bool8 Route1Identity(u32 actor, u32 species, u32 ability);
static bool8 Route1AbilityPair(void);
static bool8 Route1SupportedMove(u32 move);
static s32 Route1Attack(u32 actor, u32 slot);
static u8 GetImprisonedMovesCount(u8 battlerId, u16 move);
static void OpponentBufferExecCompleted(void) {}
static void BtlController_EmitTwoReturnValues(u8 buffer, u8 action, u16 value)
{
#ifdef WATERBLUE_FAMILY
    if (!FamilyWildTransport(buffer, action, value)) Unexpected();
#else
    if (buffer != 1 || action != 10 || (value >> 8) != 0) Unexpected();
#endif
}
