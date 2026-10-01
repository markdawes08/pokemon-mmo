/* Restricted command transport. The admitted scripts are projected in source
 * order, with presentation-only waits omitted. This is not an interpreter. */
static const u8 sFailedScript[1] = {0};
static u8 sCommandScript[16];

static void BattleScriptPush(const u8 *script)
{
#ifdef WATERBLUE_FAMILY
    if (FamilyMoveAllowed(gCurrentMove) && (script == sFailedScript || script == gBattlescriptCurrInstr + 1)) return;
#endif
#ifdef WATERBLUE_ROUTE1
    if (gCurrentMove == MOVE_STRUGGLE && script == gBattlescriptCurrInstr + 1) return;
    if ((gCurrentMove == MOVE_TAIL_WHIP || gCurrentMove == MOVE_SAND_ATTACK) && script == sFailedScript) return;
#endif
    if (gCurrentMove != MOVE_POISON_POWDER || script != gBattlescriptCurrInstr + 1) Unexpected();
    /* Source status script's text/animation/return continuation is transported
       by the host. No nested source script stack is claimed here. */
}
#ifndef WATERBLUE_FAMILY
static void CancelMultiTurnMoves(u8 battler) { (void)battler; Unexpected(); }
#endif
static void RecordItemEffectBattle(u8 battler, u8 effect) { (void)battler; (void)effect; Unexpected(); }
static bool8 BtlCtrl_OakOldMan_TestState2Flag(u8 flag) { (void)flag; Unexpected(); return FALSE; }

static void Write32(u8 *at, u32 value)
{
    for (u32 i = 0; i < 4; i++) at[i] = value >> (8 * i);
}
static void Command(void)
{
    Zero(sCommandScript, sizeof(sCommandScript));
    gBattlescriptCurrInstr = sCommandScript;
}
static bool8 SupportedMove(u32 move)
{
#ifdef WATERBLUE_ROUTE1
    return Route1SupportedMove(move);
#else
    return move == MOVE_TACKLE || move == MOVE_WATER_GUN || move == MOVE_QUICK_ATTACK || move == MOVE_POISON_POWDER;
#endif
}
static s32 ActorReady(u32 actor)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (actor >= 2) return Fail(SPIKE_INVALID_ARGUMENT);
    if (!sConfigured[actor]) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    return SPIKE_OK;
}
s32 spike2_set_status(u32 actor, u32 status)
{
    s32 result = ActorReady(actor); if (result) return result;
    if (status != 0 && status != STATUS1_POISON && status != STATUS1_BURN) return Fail(SPIKE_UNSUPPORTED);
    gBattleMons[actor].status1 = status;
    return Fail(SPIKE_OK);
}
s32 spike2_set_speed(u32 actor, u32 speed)
{
    s32 result = ActorReady(actor); if (result) return result;
    if (speed < 1 || speed > 999) return Fail(SPIKE_INVALID_ARGUMENT);
    gBattleMons[actor].speed = speed;
    return Fail(SPIKE_OK);
}
s32 spike2_set_stage(u32 actor, u32 stat, u32 value)
{
    s32 result = ActorReady(actor); if (result) return result;
    if (stat >= NUM_BATTLE_STATS || value > MAX_STAT_STAGE) return Fail(SPIKE_INVALID_ARGUMENT);
    if (stat == STAT_HP && value != DEFAULT_STAT_STAGE) return Fail(SPIKE_UNSUPPORTED);
    gBattleMons[actor].statStages[stat] = value;
    return Fail(SPIKE_OK);
}
s32 spike2_set_move(u32 actor, u32 slot, u32 move, u32 pp)
{
    s32 result = ActorReady(actor); if (result) return result;
    if (slot >= MAX_MON_MOVES || pp > 255) return Fail(SPIKE_INVALID_ARGUMENT);
    if (move != MOVE_NONE && !SupportedMove(move)) return Fail(SPIKE_UNSUPPORTED);
#ifdef WATERBLUE_ROUTE1
    if (move == MOVE_STRUGGLE) return Fail(SPIKE_UNSUPPORTED); /* automatic action, never a moveset slot */
#endif
#ifdef WATERBLUE_FAMILY
    if (pp > FamilyMaxPP(move, gBattleMons[actor].ppBonuses, slot) || (move == MOVE_NONE && pp != 0)) return Fail(SPIKE_INVALID_ARGUMENT);
#else
    if (pp > gBattleMoves[move].pp || (move == MOVE_NONE && pp != 0)) return Fail(SPIKE_INVALID_ARGUMENT);
#endif
    gBattleMons[actor].moves[slot] = move;
    gBattleMons[actor].pp[slot] = pp;
    return Fail(SPIKE_OK);
}
s32 spike2_get_stage(u32 actor, u32 stat)
{
    if (actor >= 2 || stat >= NUM_BATTLE_STATS) return -1;
    return gBattleMons[actor].statStages[stat];
}
s32 spike2_get_move(u32 actor, u32 slot, u32 field)
{
    if (actor >= 2 || slot >= MAX_MON_MOVES || field > 1) return -1;
    return field ? gBattleMons[actor].pp[slot] : gBattleMons[actor].moves[slot];
}
s32 spike2_begin_turn(void)
{
    if (!sInitialized || !sConfigured[0] || !sConfigured[1]) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome || !gBattleMons[0].hp || !gBattleMons[1].hp) return Fail(SPIKE_NOT_READY);
    TurnValuesCleanUp(FALSE);
    SpecialStatusesClear();
#ifdef WATERBLUE_FAMILY
    FamilyBeginTurn();
#endif
    Zero(gBattleCommunication, sizeof(gBattleCommunication));
    for (u32 i = 0; i < gBattlersCount; i++) gChosenActionByBattler[i] = B_ACTION_NONE;
    gHitMarker = 0;
    gBattleScripting.animTurn = gBattleScripting.animTargetsHit = gBattleScripting.moveendState = 0;
    gBattleMoveDamage = 0; gMoveResultFlags = 0;
    gBattleStruct->turnEffectsTracker = 0;
    gRandomTurnNumber = Random(); /* source action-selection start draw */
    return Fail(SPIKE_OK);
}
s32 spike2_order(u32 slot0, u32 slot1)
{
    if (!sInitialized || !sConfigured[0] || !sConfigured[1]) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    u32 slots[2] = {slot0, slot1};
    for (u32 actor = 0; actor < 2; actor++) {
        if (slots[actor] > MAX_MON_MOVES) return Fail(SPIKE_INVALID_ARGUMENT);
        if (!gBattleMons[actor].hp || !gBattleMons[actor].speed) return Fail(SPIKE_NOT_READY);
        if (slots[actor] < MAX_MON_MOVES && (!SupportedMove(gBattleMons[actor].moves[slots[actor]])
            || !gBattleMons[actor].pp[slots[actor]])) return Fail(SPIKE_NOT_READY);
    }
    for (u32 actor = 0; actor < 2; actor++) {
        gChosenActionByBattler[actor] = slots[actor] == MAX_MON_MOVES ? B_ACTION_SWITCH : B_ACTION_USE_MOVE;
        gBattleStruct->chosenMovePositions[actor] = slots[actor] == MAX_MON_MOVES ? 0 : slots[actor];
    }
    sStatus = SPIKE_OK;
    /* SetActionsAndBattlersTurnOrder's singles switch partition, source order. */
    if (slot0 == MAX_MON_MOVES) return 0;
    if (slot1 == MAX_MON_MOVES) return 1;
    return GetWhoStrikesFirst(0, 1, FALSE);
}
s32 spike2_residual_order(void)
{
    if (!sInitialized || !sConfigured[0] || !sConfigured[1]
        || !gBattleMons[0].speed || !gBattleMons[1].speed) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    sStatus = SPIKE_OK;
    return GetWhoStrikesFirst(0, 1, FALSE); /* exact DoFieldEndTurnEffects argument */
}

static bool8 StatusJump(u32 flags)
{
    Command(); sCommandScript[1] = BS_TARGET;
    Write32(sCommandScript + 2, flags);
    Write32(sCommandScript + 6, (u32)sFailedScript);
    Cmd_jumpifstatus();
    return gBattlescriptCurrInstr == sFailedScript;
}
static bool8 TypeJump(u32 type)
{
    Command(); sCommandScript[1] = BS_TARGET; sCommandScript[2] = type;
    Write32(sCommandScript + 3, (u32)sFailedScript);
    Cmd_jumpiftype();
    return gBattlescriptCurrInstr == sFailedScript;
}
static void Accuracy(void)
{
    Command(); Write32(sCommandScript + 1, (u32)sFailedScript);
    sCommandScript[5] = ACC_CURR_MOVE; sCommandScript[6] = ACC_CURR_MOVE >> 8;
    Cmd_accuracycheck();
}
s32 spike2_attack(u32 actor, u32 slot)
{
#ifdef WATERBLUE_ROUTE1
    return Route1Attack(actor, slot);
#else
    s32 status = ActorReady(actor); if (status) return status;
    if (slot >= MAX_MON_MOVES) return Fail(SPIKE_INVALID_ARGUMENT);
    u32 target = actor ^ 1;
    if (!sConfigured[target] || !gBattleMons[actor].hp || !gBattleMons[target].hp) return Fail(SPIKE_NOT_READY);
    u32 move = gBattleMons[actor].moves[slot];
    if (!SupportedMove(move)) return Fail(SPIKE_UNSUPPORTED);
    if (!gBattleMons[actor].pp[slot]) return Fail(SPIKE_NOT_READY);
    /* Preflight both possible critical outcomes before consuming RNG/PP. */
    if (move != MOVE_POISON_POWDER) {
        u32 stat = move == MOVE_WATER_GUN ? STAT_SPDEF : STAT_DEF;
        u32 stage = gBattleMons[target].statStages[stat];
        u32 defense = move == MOVE_WATER_GUN ? gBattleMons[target].spDefense : gBattleMons[target].defense;
        if (defense * gStatStageRatios[stage][0] / gStatStageRatios[stage][1] == 0) return Fail(SPIKE_UNSAFE_DEFENSE);
    }
    sStatus = SPIKE_OK; sEventCount = 0; Zero(sEvents, sizeof(sEvents));
    gBattlerAttacker = actor; gBattlerTarget = target; gCurrMovePos = slot;
    gCurrentMove = move; gCritMultiplier = gBattleScripting.dmgMultiplier = 1;
    gBattleMoveDamage = gHpDealt = sBaseDamage = sAfterCritical = sAfterType = 0;
    gHitMarker = 0; gMoveResultFlags = 0;
    Zero(gBattleCommunication, sizeof(gBattleCommunication));
    Zero(gSpecialStatuses, sizeof(gSpecialStatuses));
    gProtectStructs[actor].targetNotAffected = 0;
    gProtectStructs[target].physicalDmg = gProtectStructs[target].specialDmg = 0;
    /* Burn/poison/Foresight do not cancel these moves. All inability, obedience,
       ability, field and volatile branches are excluded by the ABI admission. */
    if (move == MOVE_POISON_POWDER) {
        Command(); Cmd_ppreduce();
        if (StatusJump(STATUS1_POISON) || StatusJump(STATUS1_TOXIC_POISON)) return sStatus;
        if (TypeJump(TYPE_POISON) || TypeJump(TYPE_STEEL)) {
            gMoveResultFlags |= MOVE_RESULT_DOESNT_AFFECT_FOE; return sStatus;
        }
        if (StatusJump(STATUS1_ANY)) { gMoveResultFlags |= MOVE_RESULT_FAILED; return sStatus; }
        Accuracy();
        if (gMoveResultFlags & MOVE_RESULT_NO_EFFECT) { gMoveResultFlags |= MOVE_RESULT_FAILED; return sStatus; }
        Command(); gBattleCommunication[MOVE_EFFECT_BYTE] = MOVE_EFFECT_POISON;
        SetMoveEffect(TRUE, 0);
        return sStatus;
    }
    Accuracy();
    Command(); Cmd_ppreduce();
    if (sStatus || (gMoveResultFlags & MOVE_RESULT_NO_EFFECT)) return sStatus;
    Command(); Cmd_critcalc();
    Command(); Cmd_damagecalc();
    sAfterCritical = gBattleMoveDamage; sBaseDamage = sAfterCritical / gCritMultiplier;
    Command(); Cmd_typecalc(); sAfterType = gBattleMoveDamage;
    Command(); Cmd_adjustnormaldamage();
    gBattlescriptCurrInstr = sTargetScript; Cmd_healthbarupdate();
    gBattlescriptCurrInstr = sTargetScript; Cmd_datahpupdate();
    Command(); Cmd_seteffectwithchance();
    return sStatus;
#endif
}
