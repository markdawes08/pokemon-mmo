/* Batch-two admission and transport around verbatim lifecycle source bodies.
 * This is not the full switch, faint, residual or battle script interpreter.
 * Included after adapter.c so source faults use the same Fail/Unexpected/events.
 */
static u8 sResidualScript;
static const u8 sLifecycleActorScript[] = {0, BS_ATTACKER, 0};
static const u8 sLifecycleTeamsScript[] = {0, 0, 0, 0, 0};

static void ResetLifecycle(void)
{
    Zero(gPlayerParty, sizeof(gPlayerParty));
    Zero(gEnemyParty, sizeof(gEnemyParty));
    Zero(gSpeciesInfo, sizeof(gSpeciesInfo));
    Zero(gActionSelectionCursor, sizeof(gActionSelectionCursor));
    Zero(gMoveSelectionCursor, sizeof(gMoveSelectionCursor));
    Zero(gLastHitBy, sizeof(gLastHitBy));
    Zero(gBattlerPartyIndexes, sizeof(gBattlerPartyIndexes));
    Zero(gLastMoves, sizeof(gLastMoves));
    Zero(gLastResultingMoves, sizeof(gLastResultingMoves));
    Zero(gLastPrintedMoves, sizeof(gLastPrintedMoves));
    gBattleOutcome = sResidualScript = 0;
}

static u32 GetMonData(struct Pokemon *mon, s32 field)
{
    if (field == MON_DATA_SPECIES) return mon->species;
    if (field == MON_DATA_HP) return mon->hp;
    if (field == MON_DATA_IS_EGG) return mon->isEgg;
    Unexpected();
    return 0;
}

s32 spike2_set_party(u32 side, u32 index, u32 species, u32 hp, u32 isEgg)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (side >= 2 || index >= PARTY_SIZE || species > 65535 || hp > 65535 || isEgg > 1
        || (species == 0 && (hp != 0 || isEgg != 0))) return Fail(SPIKE_INVALID_ARGUMENT);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    struct Pokemon *party = side == 0 ? gPlayerParty : gEnemyParty;
    /* Source Cmd_checkteamslost sums into u16. Stress-fixture HP is wider than
     * real Gen III team totals; reject overflow before writing any record. */
    u32 total = species != 0 && !isEgg ? hp : 0;
    for (u32 i = 0; i < PARTY_SIZE; i++)
        if (i != index && party[i].species != 0 && !party[i].isEgg) total += party[i].hp;
    if (total > 65535) return Fail(SPIKE_INVALID_ARGUMENT);
    party[index].species = species;
    party[index].hp = hp;
    party[index].isEgg = isEgg;
    return Fail(SPIKE_OK);
}

s32 spike2_get_party(u32 side, u32 index, u32 field)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (side >= 2 || index >= PARTY_SIZE || field > 2) return Fail(SPIKE_INVALID_ARGUMENT);
    struct Pokemon *mon = side == 0 ? &gPlayerParty[index] : &gEnemyParty[index];
    if (field == 0) return mon->species;
    if (field == 1) return mon->hp;
    return mon->isEgg;
}

static void BattleScriptExecute(const u8 *script)
{
    if (script == BattleScript_PoisonTurnDmg) sResidualScript = 1;
    else if (script == BattleScript_BurnTurnDmg) sResidualScript = 2;
    else Unexpected();
}

static s32 LifecycleReady(u32 actor)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (actor >= 2) return Fail(SPIKE_INVALID_ARGUMENT);
    if (!sConfigured[actor]) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    if (gBattleMons[actor].species != actor + 1) return Fail(SPIKE_UNEXPECTED_DEPENDENCY);
    if (gBattleControllerExecFlags || gBattleTypeFlags || gBattleWeather
        || gBattleMons[actor].ability != ABILITY_NONE || gBattleMons[actor].item != ITEM_NONE)
        return Fail(SPIKE_UNSUPPORTED);
    if (gBattleMons[actor].status1 != 0 && gBattleMons[actor].status1 != STATUS1_POISON
        && gBattleMons[actor].status1 != STATUS1_BURN) return Fail(SPIKE_UNSUPPORTED);
    return SPIKE_OK;
}

s32 spike2_switch_cleanup(u32 actor)
{
    s32 status = LifecycleReady(actor);
    if (status != SPIKE_OK) return status;
    if (!gBattleMons[actor].hp) return Fail(SPIKE_NOT_READY);
    if (gCurrentMove >= MOVES_COUNT || gBattleMoves[gCurrentMove].effect == EFFECT_BATON_PASS)
        return Fail(SPIKE_UNSUPPORTED);
    sStatus = SPIKE_OK;
    gActiveBattler = actor;
    SwitchInClearSetData();
    return sStatus;
}

s32 spike2_faint_cleanup(u32 actor)
{
    s32 status = LifecycleReady(actor);
    if (status != SPIKE_OK) return status;
    if (gBattleMons[actor].hp != 0) return Fail(SPIKE_INVALID_ARGUMENT);
    sStatus = SPIKE_OK;
    sEventCount = 0;
    Zero(sEvents, sizeof(sEvents));
    gBattlerAttacker = actor;
    gBattlescriptCurrInstr = sLifecycleActorScript;
    Cmd_cleareffectsonfaint();
    return sStatus;
}

s32 spike2_residual(u32 actor)
{
    s32 status = LifecycleReady(actor);
    if (status != SPIKE_OK) return status;
    if (!gBattleMons[actor].hp) return Fail(SPIKE_NOT_READY);
    u32 condition = gBattleMons[actor].status1;
    if (condition != 0 && condition != STATUS1_POISON && condition != STATUS1_BURN)
        return Fail(SPIKE_UNSUPPORTED);
    sStatus = SPIKE_OK;
    sEventCount = 0;
    Zero(sEvents, sizeof(sEvents));
    sResidualScript = 0;
    gBattleMoveDamage = gHpDealt = 0;
    sBaseDamage = sAfterCritical = sAfterType = 0;
    gMoveResultFlags = 0;
    if (condition == 0) return SPIKE_OK;
    gActiveBattler = gBattlerAttacker = actor;
    gBattlerTarget = actor ^ 1;
    gBattleStruct->turnEffectsTracker = condition == STATUS1_POISON ? ENDTURN_POISON : ENDTURN_BURN;
    /* DoBattlerEndTurnEffects sets these before entering its source cases. */
    gHitMarker |= HITMARKER_GRUDGE | HITMARKER_SKIP_DMG_TRACK;
    u8 effect = SpikeSourceResidualCase();
    if (sStatus != SPIKE_OK) return sStatus;
    if (effect != 0)
    {
        if (!sResidualScript) return Fail(SPIKE_UNEXPECTED_DEPENDENCY);
        /* BattleScript_DoTurnDmg's source sequence; no attack RNG/critical/type
         * arithmetic belongs to passive poison or burn damage. */
        gHitMarker |= HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_DAMAGE;
        gBattlescriptCurrInstr = sLifecycleActorScript;
        Cmd_healthbarupdate();
        if (sStatus != SPIKE_OK) return sStatus;
        gBattlescriptCurrInstr = sLifecycleActorScript;
        Cmd_datahpupdate();
        if (sStatus != SPIKE_OK) return sStatus;
    }
    /* The bounded API returns at a clean operation boundary. The real source
     * scheduler and turn cleanup own these flags in the complete engine. */
    gHitMarker &= ~(HITMARKER_GRUDGE | HITMARKER_SKIP_DMG_TRACK | HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_DAMAGE);
    return sStatus;
}

s32 spike2_check_teams_lost(void)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (gBattleControllerExecFlags || gBattleTypeFlags) return Fail(SPIKE_UNSUPPORTED);
    for (u32 side = 0; side < 2; side++)
    {
        struct Pokemon *party = side == 0 ? gPlayerParty : gEnemyParty;
        u8 present = 0;
        for (u32 i = 0; i < PARTY_SIZE; i++)
            if (party[i].species && !party[i].isEgg) present = 1;
        if (!present) return Fail(SPIKE_NOT_READY);
    }
    sStatus = SPIKE_OK;
    gBattlescriptCurrInstr = sLifecycleTeamsScript;
    Cmd_checkteamslost();
    return sStatus;
}

u32 spike2_get_outcome(void) { return gBattleOutcome; }
