/* Headless batch-one ABI and restricted service boundary. Not production. */
#ifndef WATERBLUE_BATTLE_SPIKE_ADAPTER_H
#define WATERBLUE_BATTLE_SPIKE_ADAPTER_H

typedef __UINT8_TYPE__ u8;
typedef __UINT16_TYPE__ u16;
typedef __UINT32_TYPE__ u32;
typedef __INT8_TYPE__ s8;
typedef __INT16_TYPE__ s16;
typedef __INT32_TYPE__ s32;
typedef u8 bool8;
typedef u32 bool32;
#define UINT_MAX __UINT32_MAX__

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
#include "constants/battle_move_effects.h"
#include "constants/flags.h"
#include "constants/battle_script_commands.h"
#include "constants/battle_string_ids.h"
#include "source_declarations.inc"

/* Deliberate projected adapter layouts; no original pointer snapshot claimed. */
struct BattleStruct {
    u8 dynamicMoveType, chosenMovePositions[4], synchronizeMoveEffect, wrappedBy[4], lastTakenMove[8];
    u16 lastTakenMoveFrom[4][4], choicedMove[4];
    u8 turnEffectsTracker;
};
struct BattleResources { struct ResourceFlags *flags; };
struct EnigmaBerry { u8 holdEffect; u8 holdEffectParam; };
struct BattleResults { u8 playerMonWasDamaged; };

static struct BattlePokemon gBattleMons[MAX_BATTLERS_COUNT];
static struct ProtectStruct gProtectStructs[MAX_BATTLERS_COUNT];
static struct SpecialStatus gSpecialStatuses[MAX_BATTLERS_COUNT];
static struct DisableStruct gDisableStructs[MAX_BATTLERS_COUNT];
static struct BattleScripting gBattleScripting;
static struct SideTimer gSideTimers[2];
static struct ResourceFlags sResourceFlags;
static struct BattleStruct sBattleStruct;
static struct BattleResources sBattleResources;
static struct BattleStruct *gBattleStruct = &sBattleStruct;
static struct BattleResources *gBattleResources = &sBattleResources;
static struct EnigmaBerry gEnigmaBerries[MAX_BATTLERS_COUNT];
static struct BattleResults gBattleResults;

static u32 gRngValue, gBattleTypeFlags, gHitMarker, gBattleControllerExecFlags;
static u32 sRngInitialSeed, sRngDrawsLo, sRngDrawsHi;
static u32 gStatuses3[MAX_BATTLERS_COUNT];
static u16 gCurrentMove, gBattleMovePower, gDynamicBasePower, gBattleWeather;
static s32 gBattleMoveDamage, gHpDealt, gTakenDmg[MAX_BATTLERS_COUNT];
static u16 gSideStatuses[2], gLastLandedMoves[MAX_BATTLERS_COUNT], gLastHitByType[MAX_BATTLERS_COUNT];
static u8 gBattlerAttacker, gBattlerTarget, gActiveBattler, gBattlersCount;
static u8 gEffectBattler, gBattlerFainted, gCritMultiplier, gMoveResultFlags, gLastUsedAbility;
static u8 gBattlerPositions[MAX_BATTLERS_COUNT], gTakenDmgByBattler[MAX_BATTLERS_COUNT];
static u8 gBattleCommunication[BATTLE_COMMUNICATION_ENTRIES_COUNT];
static const u8 *gBattlescriptCurrInstr;
static const u8 BattleScript_SubstituteFade[] = {0}; /* tripwire-only, cannot execute */
static u8 gCurrMovePos, gPotentialItemEffectBattler, gChosenActionByBattler[4];
static u16 gRandomTurnNumber;
static u16 gLastUsedItem;
#include "lifecycle_state.inc"
static const u8 BattleScript_PSNPrevention[] = {3}, BattleScript_BRNPrevention[] = {4}, BattleScript_PRLZPrevention[] = {5};
static const u8 sStatusScript[] = {6};
static const u8 *const sMoveEffectBS_Ptrs[NUM_MOVE_EFFECTS] = {[MOVE_EFFECT_POISON] = sStatusScript};
static void Unexpected(void);
static void BattleScriptPush(const u8 *script);
static void CancelMultiTurnMoves(u8 battler);
static void RecordItemEffectBattle(u8 battler, u8 effect);
static bool8 BtlCtrl_OakOldMan_TestState2Flag(u8 flag);
void SetMoveEffect(bool8 primary, u8 certain);
static void ResetLifecycle(void);
static void ResetCheckpoint(void);

static u8 ItemId_GetHoldEffect(u16 item);
static u8 ItemId_GetHoldEffectParam(u16 item);
static bool8 FlagGet(u16 flag);
static u8 AbilityBattleEffects(u8 effect, u8 battler, u8 ability, u8 special, u16 move);
static u8 CountAliveMonsInBattle(u8 caseId);
static u8 AttacksThisTurn(u8 battler, u16 move);
static void RecordAbilityBattle(u8 battler, u8 ability);
static void BattleScriptPushCursor(void);
static void PrepareStringBattle(u16 stringId, u8 battler);
static void BtlController_EmitHealthBarUpdate(u8 buffer, s16 value);
static void BtlController_EmitSetMonData(u8 buffer, u8 request, u8 party, u8 size, const void *data);
static void MarkBattlerForControllerExec(u8 battler);

u8 GetBattlerSide(u8 battler);
u8 GetBattlerPosition(u8 battler);
u8 GetBattlerAtPosition(u8 position);
u8 GetBattlerForBattleScript(u8 caseId);

enum SpikeStatus {
    SPIKE_OK = 0, SPIKE_INVALID_ARGUMENT = 1, SPIKE_UNSUPPORTED = 2,
    SPIKE_NOT_READY = 3, SPIKE_UNEXPECTED_DEPENDENCY = 4,
    SPIKE_EVENT_OVERFLOW = 5, SPIKE_UNSAFE_DEFENSE = 6
};

u32 spike_abi_version(void);
s32 spike_reset(u32 seed);
s32 spike_set_battler(u32 index, u32 level, u32 hp, u32 maxHP, u32 attack, u32 defense,
                     u32 spAttack, u32 spDefense, u32 type1, u32 type2, u32 status1, u32 status2);
s32 spike_set_stage(u32 index, u32 stat, u32 value);
s32 spike_set_capabilities(u32 ability0, u32 ability1, u32 item0, u32 item1,
                           u32 weather, u32 battleFlags, u32 side0, u32 side1);
s32 spike_damage(u32 move, u32 critical);
s32 spike_get_result(u32 field);
u32 spike_get_rng(void);
u32 spike_rng_next(void);
s32 spike_get_event(u32 index, u32 field);
s32 spike_get_battler(u32 index, u32 field);
u32 spike_battle_mon_size(void);
s32 spike2_set_status(u32 actor, u32 status);
s32 spike2_set_speed(u32 actor, u32 speed);
s32 spike2_set_move(u32 actor, u32 slot, u32 move, u32 pp);
s32 spike2_set_stage(u32 actor, u32 stat, u32 value);
s32 spike2_get_stage(u32 actor, u32 stat);
s32 spike2_get_move(u32 actor, u32 slot, u32 field);
s32 spike2_begin_turn(void);
s32 spike2_order(u32 slot0, u32 slot1);
s32 spike2_residual_order(void);
s32 spike2_attack(u32 actor, u32 slot);
u32 spike3_checkpoint_version(void);
u32 spike3_checkpoint_word_count(void);
s32 spike3_checkpoint_export(u32 boundary);
u32 spike3_checkpoint_get(u32 index);
s32 spike3_import_begin(u32 version, u32 boundary, u32 count);
s32 spike3_import_set(u32 index, u32 value);
s32 spike3_import_commit(void);
u32 spike3_get_rng_draws(u32 field);

#endif
