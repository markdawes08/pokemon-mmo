/* Bounded services around the pinned item branches; no inventory/owned grant. */
static void Route1ResetItems(void)
{
    sCapturedBall = sCapturedShakes = 0;
    sItemId = sItemRestored = sItemOdds = sItemThreshold = sItemShakes = 0;
}

/* Portable replacement for BIOS SWI 8, whose implementation is outside the
 * source snapshot. Bounded floor sqrt for every u32, with no multiplication
 * overflow or floating point. Independent primitive fixtures are required. */
static u16 Sqrt(u32 value)
{
    u32 low = 0, high = 65536;
    while (low + 1 < high) {
        u32 middle = low + (high - low) / 2;
        if (middle <= value / middle) low = middle;
        else high = middle;
    }
    return low;
}
u32 route1_sqrt(u32 value) { return Sqrt(value); }

static u32 Route1GetMonData(struct Pokemon *mon, s32 field, void *unused)
{
    if (mon != &gPlayerParty[0] || unused != NULL) { Unexpected(); return 0; }
    if (field == MON_DATA_HP) return mon->hp;
    if (field == MON_DATA_MAX_HP) return gBattleMons[0].maxHP;
    Unexpected(); return 0;
}
static void Route1SetMonData(struct Pokemon *mon, s32 field, const void *data)
{
    if (mon == &gPlayerParty[0] && field == MON_DATA_HP) {
        u32 hp = *(const u32 *)data;
        if (hp > gBattleMons[0].maxHP) { Unexpected(); return; }
        mon->hp = hp;
    } else if (mon == &gEnemyParty[0] && field == MON_DATA_POKEBALL
               && data == &gLastUsedItem && gLastUsedItem == ITEM_POKE_BALL) {
        sCapturedBall = gLastUsedItem;
    } else Unexpected();
}
static void BtlController_EmitGetMonData(u8 buffer, u8 request, u8 party)
{
    if (buffer != BUFFER_A || request != REQUEST_ALL_BATTLE || party != 0 || gActiveBattler != 0) {
        Unexpected(); return;
    }
    Emit(2, 0, gBattleMons[0].hp);
}
static void BtlController_EmitBallThrowAnim(u8 buffer, u8 shakes)
{
    if (buffer != BUFFER_A || shakes > BALL_3_SHAKES_SUCCESS || gActiveBattler != 0) {
        Unexpected(); return;
    }
    sItemShakes = shakes;
    /* Diagnostic transport; source animation/controller timing is not run. */
    Emit(8, 1, shakes);
}
static u8 CalculatePlayerPartyCount(void)
{
    if (!gPlayerParty[0].species || gPlayerParty[0].isEgg) { Unexpected(); return 0; }
    for (u32 slot = 1; slot < PARTY_SIZE; slot++) {
        if (gPlayerParty[slot].species) { Unexpected(); return 0; }
    }
    return 1; /* strict admitted sole-party policy guarantees a free slot */
}

s32 route1_item(u32 item)
{
    if (!sRoute1Started || gBattleOutcome || !gBattleMons[0].hp || !gBattleMons[1].hp)
        return Fail(SPIKE_NOT_READY);
    if (item != ITEM_POTION && item != ITEM_POKE_BALL) return Fail(SPIKE_UNSUPPORTED);
    if (!Route1AbilityPair() || gBattleTypeFlags || gBattleWeather || gBattleControllerExecFlags
        || gBattleMons[0].status1 || gBattleMons[1].status1 || gBattleMons[0].status2 || gBattleMons[1].status2
        || gBattleMons[0].item || gBattleMons[1].item) return Fail(SPIKE_UNSUPPORTED);
    if (item == ITEM_POTION && gBattleMons[0].hp == gBattleMons[0].maxHP)
        return Fail(SPIKE_INVALID_ARGUMENT);
    /* The host synchronizes these before terminal capture. Reject unsupported
     * raw party context before any command writes or random draw. */
    for (u32 side = 0; side < 2; side++) {
        struct Pokemon *party = side ? gEnemyParty : gPlayerParty;
        if (party[0].species != gBattleMons[side].species || party[0].hp != gBattleMons[side].hp || party[0].isEgg)
            return Fail(SPIKE_UNSUPPORTED);
        for (u32 slot = 1; slot < PARTY_SIZE; slot++)
            if (party[slot].species || party[slot].hp || party[slot].isEgg) return Fail(SPIKE_UNSUPPORTED);
    }
    sStatus = SPIKE_OK; sEventCount = 0; Zero(sEvents, sizeof(sEvents));
    sItemId = item; sItemRestored = sItemOdds = sItemThreshold = sItemShakes = 0;
    gActiveBattler = gBattlerAttacker = 0; gBattlerTarget = 1;
    gLastUsedItem = item; gBattleResults.numHealingItemsUsed = 0;
    if (item == ITEM_POTION) {
        u32 before = gBattleMons[0].hp;
        if (SourcePotion()) return Fail(SPIKE_UNEXPECTED_DEPENDENCY);
        sItemRestored = gBattleMons[0].hp - before;
    } else {
        gSpeciesInfo[gBattleMons[1].species].catchRate = sRoute1CatchRates[gBattleMons[1].species];
        gBattlescriptCurrInstr = NULL;
        SourcePokeBall();
        if (!sStatus && gBattlescriptCurrInstr == BattleScript_SuccessBallThrow) {
            if (sCapturedBall != ITEM_POKE_BALL || sItemShakes != BALL_3_SHAKES_SUCCESS)
                return Fail(SPIKE_UNEXPECTED_DEPENDENCY);
            sCapturedShakes = sItemShakes;
            /* Explicit headless boundary: combat settles before the source
             * success script's external dex/nickname/GiveMonToPlayer work.
             * No owned creature or persistent effect is created here. */
            gBattleOutcome = B_OUTCOME_CAUGHT;
        } else if (!sStatus && gBattlescriptCurrInstr != BattleScript_ShakeBallThrow) {
            return Fail(SPIKE_UNEXPECTED_DEPENDENCY);
        }
    }
    return sStatus;
}
s32 route1_item_get(u32 field)
{
    if (field == 0) return sItemId;
    if (field == 1) return sItemRestored;
    if (field == 2) return sItemOdds;
    if (field == 3) return sItemThreshold;
    if (field == 4) return sItemShakes;
    if (field == 5) return gBattleOutcome == B_OUTCOME_CAUGHT;
    if (field == 6) return sItemEffect_Potion[6];
    return -1;
}
