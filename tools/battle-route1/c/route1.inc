/* Real-profile orchestration seams; source commands own all arithmetic. */
static bool8 Route1Identity(u32 actor, u32 species, u32 ability)
{
#ifdef WATERBLUE_FAMILY
    return actor < 2 && FamilyIdentity(species, ability);
#else
    if (actor == 0) return species == SPECIES_SQUIRTLE && ability == ABILITY_TORRENT;
    if (actor != 1) return FALSE;
    return (species == SPECIES_PIDGEY && ability == ABILITY_KEEN_EYE)
        || (species == SPECIES_RATTATA && (ability == ABILITY_RUN_AWAY || ability == ABILITY_GUTS));
#endif
}
static bool8 Route1AbilityPair(void)
{
    return Route1Identity(0, gBattleMons[0].species, gBattleMons[0].ability)
        && Route1Identity(1, gBattleMons[1].species, gBattleMons[1].ability);
}
static bool8 Route1SupportedMove(u32 move)
{
#ifdef WATERBLUE_FAMILY
    return FamilyMoveAllowed(move);
#else
    /* WATER_GUN is retained for a private raw Torrent arithmetic diagnostic.
     * Strict host admission accepts only the real level-five/Route 1 moves. */
    return move == MOVE_TACKLE || move == MOVE_TAIL_WHIP || move == MOVE_SAND_ATTACK
        || move == MOVE_STRUGGLE || move == MOVE_WATER_GUN;
#endif
}
s32 route1_set_identity(u32 actor, u32 species, u32 ability)
{
    s32 status = ActorReady(actor); if (status) return status;
    if (sRoute1Started || !Route1Identity(actor, species, ability)) return Fail(SPIKE_UNSUPPORTED);
    if (gBattleMons[actor].type1 != sRoute1Types[species][0]
        || gBattleMons[actor].type2 != sRoute1Types[species][1]) return Fail(SPIKE_UNSUPPORTED);
    gBattleMons[actor].species = species; gBattleMons[actor].ability = ability;
    gSpeciesInfo[species].types[0] = sRoute1Types[species][0];
    gSpeciesInfo[species].types[1] = sRoute1Types[species][1];
    return Fail(SPIKE_OK);
}
s32 route1_start(void)
{
    if (!sInitialized || !sConfigured[0] || !sConfigured[1] || sRoute1Started || !Route1AbilityPair()
        || !gBattleMons[0].speed || !gBattleMons[1].speed || !gBattleMons[0].hp || !gBattleMons[1].hp)
        return Fail(SPIKE_NOT_READY);
    sStatus = SPIKE_OK;
    /* TryDoEventsBeforeFirstTurn: mechanical switch-in order precedes the first
     * selection draw. Admitted abilities/items have no switch-in effect.
     * Display/VBlank RNG calls are deliberately outside this headless clock. */
    GetWhoStrikesFirst(0, 1, TRUE);
    if (sStatus) return sStatus;
    sRoute1Started = 1;
    return spike2_begin_turn();
}
s32 route1_choose_wild(void)
{
    if (!sRoute1Started || gBattleOutcome || !gBattleMons[1].hp) return -SPIKE_NOT_READY;
    sStatus = SPIKE_OK; gActiveBattler = 1;
    if (AreAllMovesUnusable()) return MAX_MON_MOVES;
    u8 slot;
    /* Source controller chooses a nonempty slot, then source selection rejects
     * zero PP and invokes the controller again. No uniform usable-slot shortcut. */
    do { slot = SourceWildChoice(); } while (gBattleMons[1].pp[slot] == 0);
    return sStatus ? -sStatus : slot;
}
s32 route1_order(u32 playerSlot, u32 wildSlot, u32 actionKind)
{
    if (!sRoute1Started || gBattleOutcome || !gBattleMons[0].hp || !gBattleMons[1].hp) return -SPIKE_NOT_READY;
    if (actionKind > 2 || playerSlot > MAX_MON_MOVES || wildSlot > MAX_MON_MOVES) return -SPIKE_INVALID_ARGUMENT;
    u32 slots[2] = {playerSlot, wildSlot};
    /* Validate without writing flags or consuming RNG. */
    for (u32 actor = 0; actor < 2; actor++) {
        if (actor == 0 && actionKind) continue;
        u8 all = CheckMoveLimitations(actor, 0, MOVE_LIMITATIONS_ALL) == ALL_MOVES_MASK;
        if ((slots[actor] == MAX_MON_MOVES) != all) return -SPIKE_INVALID_ARGUMENT;
        if (!all && (!Route1SupportedMove(gBattleMons[actor].moves[slots[actor]])
            || !gBattleMons[actor].pp[slots[actor]])) return -SPIKE_INVALID_ARGUMENT;
    }
    for (u32 actor = 0; actor < 2; actor++) {
        gActiveBattler = actor;
        if (actor == 0 && actionKind) gProtectStructs[actor].noValidMoves = 0;
        else AreAllMovesUnusable();
        gChosenActionByBattler[actor] = actor == 0 && actionKind
            ? (actionKind == 1 ? B_ACTION_RUN : B_ACTION_USE_ITEM) : B_ACTION_USE_MOVE;
        gBattleStruct->chosenMovePositions[actor] = slots[actor] == MAX_MON_MOVES ? 0 : slots[actor];
    }
    sStatus = SPIKE_OK;
    /* Source singles partition puts Run or Item before moves, without a tie. */
    if (actionKind) return 0;
    u8 first = GetWhoStrikesFirst(0, 1, FALSE);
    return sStatus ? -sStatus : first;
}
s32 route1_run(u32 actor)
{
    if (!sRoute1Started || actor >= 2 || gBattleOutcome || !gBattleMons[actor].hp) return -SPIKE_NOT_READY;
    if (!Route1AbilityPair()) return -SPIKE_UNSUPPORTED;
    sStatus = SPIKE_OK; sEventCount = 0; Zero(sEvents, sizeof(sEvents));
    gBattlerAttacker = actor;
    bool8 escaped = TryRunFromBattle(actor);
    if (sStatus) return -sStatus;
    if (escaped && gProtectStructs[actor].fleeType == FLEE_ABILITY) Emit(7, actor, ABILITY_RUN_AWAY);
    return escaped;
}
s32 route1_get(u32 field)
{
    if (field == 0) return gBattleStruct->runTries;
    if (field == 1) return sRoute1Started;
    if (field == 2) return gProtectStructs[0].noValidMoves;
    if (field == 3) return gProtectStructs[1].noValidMoves;
    return -1;
}
static s32 Route1Attack(u32 actor, u32 slot)
{
#ifdef WATERBLUE_FAMILY
    return FamilyAttack(actor, slot);
#else
    s32 status = ActorReady(actor); if (status) return status;
    if (!sRoute1Started || slot > MAX_MON_MOVES) return Fail(SPIKE_INVALID_ARGUMENT);
    u32 target = actor ^ 1;
    if (!sConfigured[target] || !gBattleMons[actor].hp || !gBattleMons[target].hp) return Fail(SPIKE_NOT_READY);
    u8 struggle = slot == MAX_MON_MOVES;
    if (struggle && CheckMoveLimitations(actor, 0, MOVE_LIMITATIONS_ALL) != ALL_MOVES_MASK) return Fail(SPIKE_INVALID_ARGUMENT);
    u32 move = struggle ? MOVE_STRUGGLE : gBattleMons[actor].moves[slot];
    if (!Route1SupportedMove(move)) return Fail(SPIKE_UNSUPPORTED);
    if (!struggle && !gBattleMons[actor].pp[slot]) return Fail(SPIKE_NOT_READY);
    bool8 statMove = move == MOVE_TAIL_WHIP || move == MOVE_SAND_ATTACK;
    if (!statMove) {
        u32 stat = move == MOVE_WATER_GUN ? STAT_SPDEF : STAT_DEF;
        u32 defense = move == MOVE_WATER_GUN ? gBattleMons[target].spDefense : gBattleMons[target].defense;
        u32 stage = gBattleMons[target].statStages[stat];
        if (defense * gStatStageRatios[stage][0] / gStatStageRatios[stage][1] == 0) return Fail(SPIKE_UNSAFE_DEFENSE);
    }
    sStatus = SPIKE_OK; sEventCount = 0; Zero(sEvents, sizeof(sEvents));
    gBattlerAttacker = actor; gBattlerTarget = target; gCurrMovePos = struggle ? 0 : slot;
    gCurrentMove = move; gCritMultiplier = gBattleScripting.dmgMultiplier = 1;
    gBattleMoveDamage = gHpDealt = sBaseDamage = sAfterCritical = sAfterType = 0;
    gHitMarker = struggle ? HITMARKER_NO_PPDEDUCT : 0; gMoveResultFlags = 0;
    gProtectStructs[actor].noValidMoves = 0; /* source HandleAction_UseMove */
    Zero(gBattleCommunication, sizeof(gBattleCommunication));
    Zero(gSpecialStatuses, sizeof(gSpecialStatuses));
    gProtectStructs[actor].targetNotAffected = 0;
    gProtectStructs[target].physicalDmg = gProtectStructs[target].specialDmg = 0;
    Accuracy(); Command(); Cmd_ppreduce();
    if (sStatus || (gMoveResultFlags & MOVE_RESULT_NO_EFFECT)) return sStatus;
    if (statMove) {
        u8 stat = move == MOVE_TAIL_WHIP ? STAT_DEF : STAT_ACC;
        u8 before = gBattleMons[target].statStages[stat];
        gBattleScripting.statChanger = SET_STAT_BUFF_VALUE(1) | STAT_BUFF_NEGATIVE | stat;
        Command(); sCommandScript[1] = STAT_CHANGE_ALLOW_PTR;
        Write32(sCommandScript + 2, (u32)sFailedScript);
        Cmd_statbuffchange();
        if (before != gBattleMons[target].statStages[stat]) Emit(6, target, stat * 16 + gBattleMons[target].statStages[stat]);
        return sStatus;
    }
    if (struggle) gBattleCommunication[MOVE_EFFECT_BYTE] = MOVE_EFFECT_RECOIL_25 | MOVE_EFFECT_AFFECTS_USER | MOVE_EFFECT_CERTAIN;
    Command(); Cmd_critcalc();
    Command(); Cmd_damagecalc();
    sAfterCritical = gBattleMoveDamage; sBaseDamage = sAfterCritical / gCritMultiplier;
    Command(); Cmd_typecalc(); sAfterType = gBattleMoveDamage;
    Command(); Cmd_adjustnormaldamage();
    gBattlescriptCurrInstr = sTargetScript; Cmd_healthbarupdate();
    gBattlescriptCurrInstr = sTargetScript; Cmd_datahpupdate();
    /* Preserve attack diagnostics: recoil reuses source damage globals. */
    s32 hitDamage = gBattleMoveDamage, hitDealt = gHpDealt;
    Command(); Cmd_seteffectwithchance();
    if (struggle && gBattlescriptCurrInstr == sRecoilScript) {
        gHitMarker |= HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_DAMAGE;
        gBattlescriptCurrInstr = sLifecycleActorScript; Cmd_healthbarupdate();
        gBattlescriptCurrInstr = sLifecycleActorScript; Cmd_datahpupdate();
        gHitMarker &= ~(HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_DAMAGE);
    }
    gBattleMoveDamage = hitDamage; gHpDealt = hitDealt;
    gHitMarker &= ~HITMARKER_NO_PPDEDUCT;
    return sStatus;
#endif
}
