/* This adapter owns validation, storage, diagnostics and controller transport.
 * All damage, type, random multiplier and HP arithmetic is in source_functions.
 * No unsupported item/ability/flag service is reported as implemented gameplay.
 */
static s32 sStatus, sBaseDamage, sAfterCritical, sAfterType;
static u8 sInitialized;
static u8 sConfigured[2];
struct SpikeEvent { s32 type, battler, value; };
static struct SpikeEvent sEvents[16];
static u32 sEventCount;
static const u8 sDamageScript[2] = {0, 0};
static const u8 sTargetScript[3] = {0, BS_TARGET, 0};

static void Zero(void *target, u32 bytes)
{
    volatile u8 *data = target;
    while (bytes--) *data++ = 0;
}

static s32 Fail(s32 status)
{
    sStatus = status;
    return status;
}

static void Unexpected(void)
{
    sStatus = SPIKE_UNEXPECTED_DEPENDENCY;
}

static void Emit(s32 type, s32 battler, s32 value)
{
    if (sEventCount >= ARRAY_COUNT(sEvents)) {
        sStatus = SPIKE_EVENT_OVERFLOW;
        return;
    }
    sEvents[sEventCount].type = type;
    sEvents[sEventCount].battler = battler;
    sEvents[sEventCount].value = value;
    sEventCount++;
}

/* Named empty-context services. Inputs are restricted before any source call. */
static u8 ItemId_GetHoldEffect(u16 item)
{
    if (item != ITEM_NONE) Unexpected();
    return HOLD_EFFECT_NONE;
}

static u8 ItemId_GetHoldEffectParam(u16 item)
{
    if (item != ITEM_NONE) Unexpected();
    return 0;
}

static bool8 FlagGet(u16 flag)
{
    if (flag != FLAG_BADGE01_GET && flag != FLAG_BADGE03_GET && flag != FLAG_BADGE05_GET && flag != FLAG_BADGE07_GET) Unexpected();
    return FALSE; /* explicit no-earned-badges experiment context */
}

static u8 AbilityBattleEffects(u8 effect, u8 battler, u8 ability, u8 special, u16 move)
{
#ifdef WATERBLUE_ROUTE1
    if (!Route1AbilityPair() || gStatuses3[0] || gStatuses3[1]) { Unexpected(); return 0; }
    if (effect == ABILITYEFFECT_ABSORBING && battler < 2 && ability == 0 && special == 0 && Route1SupportedMove(move)) return 0;
    if ((effect == ABILITYEFFECT_COUNT_ON_FIELD || effect == ABILITYEFFECT_COUNT_OTHER_SIDE)
        && battler < 2 && ability == ABILITY_PRESSURE && special == 0 && move == 0) return 0;
    if (battler == 0 && move == 0 && special == 0 && (ability == ABILITY_CLOUD_NINE || ability == ABILITY_AIR_LOCK)
        && (effect == ABILITYEFFECT_CHECK_ON_FIELD || effect == ABILITYEFFECT_FIELD_SPORT)) return 0;
    if (effect == ABILITYEFFECT_FIELD_SPORT && battler == 0 && ability == 0 && move == 0
        && (special == ABILITYEFFECT_MUD_SPORT || special == ABILITYEFFECT_WATER_SPORT)) return 0;
    Unexpected(); return 0;
#else
    if (gBattleMons[0].ability == ABILITY_NONE && gBattleMons[1].ability == ABILITY_NONE
        && gStatuses3[0] == 0 && gStatuses3[1] == 0) {
        if (effect == ABILITYEFFECT_CHECK_ON_FIELD && battler == 0 && special == 0 && move == 0
            && (ability == ABILITY_CLOUD_NINE || ability == ABILITY_AIR_LOCK)) return 0;
        if (effect == ABILITYEFFECT_ABSORBING && battler < 2 && ability == 0 && special == 0
            && (move == MOVE_TACKLE || move == MOVE_WATER_GUN || move == MOVE_QUICK_ATTACK || move == MOVE_POISON_POWDER)) return 0;
    }
    if (effect != ABILITYEFFECT_FIELD_SPORT || battler != 0 || move != 0
        || gBattleMons[0].ability != ABILITY_NONE || gBattleMons[1].ability != ABILITY_NONE
        || gStatuses3[0] != 0 || gStatuses3[1] != 0
        || !((special == 0 && (ability == ABILITY_CLOUD_NINE || ability == ABILITY_AIR_LOCK))
             || (ability == 0 && (special == ABILITYEFFECT_MUD_SPORT || special == ABILITYEFFECT_WATER_SPORT)))) Unexpected();
    return 0; /* the admitted field contains no abilities or sports */
#endif
}

/* These hooks must be unreachable under the admitted state. A hit fails. */
static u8 CountAliveMonsInBattle(u8 caseId) { (void)caseId; Unexpected(); return 0; }
static u8 AttacksThisTurn(u8 battler, u16 move) { (void)battler; (void)move; Unexpected(); return 0; }
#ifdef WATERBLUE_ROUTE1
static void RecordAbilityBattle(u8 battler, u8 ability)
{
    if (battler >= 2 || ability != gBattleMons[battler].ability || !Route1AbilityPair()) { Unexpected(); return; }
    Emit(7, battler, ability);
}
#else
static void RecordAbilityBattle(u8 battler, u8 ability) { (void)battler; (void)ability; Unexpected(); }
#endif
static void BattleScriptPushCursor(void) { Unexpected(); }
static void PrepareStringBattle(u16 stringId, u8 battler) { (void)stringId; (void)battler; Unexpected(); }

static void BtlController_EmitHealthBarUpdate(u8 buffer, s16 value)
{
    if (buffer != BUFFER_A || gActiveBattler >= 2 || value < 0) { Unexpected(); return; }
    Emit(1, gActiveBattler, value);
}

static void BtlController_EmitSetMonData(u8 buffer, u8 request, u8 party, u8 size, const void *data)
{
    if (buffer != BUFFER_A || party != 0 || gActiveBattler >= 2) { Unexpected(); return; }
    struct BattlePokemon *mon = &gBattleMons[gActiveBattler];
    if (request == REQUEST_HP_BATTLE && size == sizeof(mon->hp) && data == &mon->hp)
        Emit(2, gActiveBattler, mon->hp);
    else if (request >= REQUEST_PPMOVE1_BATTLE && request <= REQUEST_PPMOVE4_BATTLE
        && size == sizeof(u8) && data == &mon->pp[request - REQUEST_PPMOVE1_BATTLE])
        Emit(3, gActiveBattler, *(const u8 *)data);
    else if (request == REQUEST_STATUS_BATTLE && size == sizeof(mon->status1) && data == &mon->status1)
        Emit(4, gActiveBattler, mon->status1);
    else Unexpected();
}

static void MarkBattlerForControllerExec(u8 battler)
{
    if (battler >= 2) Unexpected();
    /* The event is synchronously queued; no graphics/controller acknowledgment
       remains outstanding. Original source command guards observe zero. */
    gBattleControllerExecFlags = 0;
}

u32 spike_abi_version(void) { return 1; }
u32 spike_battle_mon_size(void) { return sizeof(struct BattlePokemon); }

s32 spike_reset(u32 seed)
{
    Zero(gBattleMons, sizeof(gBattleMons));
    Zero(gProtectStructs, sizeof(gProtectStructs));
    Zero(gSpecialStatuses, sizeof(gSpecialStatuses));
    Zero(gDisableStructs, sizeof(gDisableStructs));
    Zero(&gBattleScripting, sizeof(gBattleScripting));
    Zero(gSideTimers, sizeof(gSideTimers));
    Zero(&sResourceFlags, sizeof(sResourceFlags));
    Zero(&sBattleStruct, sizeof(sBattleStruct));
    Zero(gEnigmaBerries, sizeof(gEnigmaBerries));
    Zero(&gBattleResults, sizeof(gBattleResults));
    Zero(gStatuses3, sizeof(gStatuses3));
    Zero(gTakenDmg, sizeof(gTakenDmg));
    Zero(gSideStatuses, sizeof(gSideStatuses));
    Zero(gLastLandedMoves, sizeof(gLastLandedMoves));
    Zero(gLastHitByType, sizeof(gLastHitByType));
    Zero(gTakenDmgByBattler, sizeof(gTakenDmgByBattler));
    Zero(gBattleCommunication, sizeof(gBattleCommunication));
    Zero(sConfigured, sizeof(sConfigured));
    Zero(sEvents, sizeof(sEvents));
    Zero(gChosenActionByBattler, sizeof(gChosenActionByBattler));
    gCurrMovePos = gPotentialItemEffectBattler = gRandomTurnNumber = gLastUsedItem = 0;
    ResetLifecycle();
    ResetCheckpoint();
#ifdef WATERBLUE_ROUTE1
    sRoute1Started = 0;
    Route1ResetItems();
#ifdef WATERBLUE_FAMILY
    FamilyReset();
#endif
    gCurrentTurnActionNumber = 0;
#endif
    sBattleResources.flags = &sResourceFlags;
    gRngValue = seed;
    sRngInitialSeed = seed;
    sRngDrawsLo = sRngDrawsHi = 0;
    gBattleTypeFlags = gHitMarker = gBattleControllerExecFlags = 0;
    gCurrentMove = gBattleMovePower = gDynamicBasePower = gBattleWeather = 0;
    gBattleMoveDamage = gHpDealt = 0;
    gBattlerAttacker = gActiveBattler = gEffectBattler = gBattlerFainted = 0;
    gBattlerTarget = 1;
    gBattlersCount = 2;
    gCritMultiplier = gBattleScripting.dmgMultiplier = 1;
    gMoveResultFlags = gLastUsedAbility = 0;
    gBattlescriptCurrInstr = sDamageScript;
    for (u32 i = 0; i < MAX_BATTLERS_COUNT; i++) {
        gBattlerPositions[i] = i < 2 ? i : 0xFF;
        for (u32 stat = 0; stat < NUM_BATTLE_STATS; stat++) gBattleMons[i].statStages[stat] = DEFAULT_STAT_STAGE;
    }
    sBaseDamage = sAfterCritical = sAfterType = 0;
    sEventCount = 0;
    sInitialized = 1;
    return Fail(SPIKE_OK);
}

s32 spike_set_battler(u32 index, u32 level, u32 hp, u32 maxHP, u32 attack, u32 defense,
                     u32 spAttack, u32 spDefense, u32 type1, u32 type2, u32 status1, u32 status2)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    if (index >= 2 || level < 1 || level > MAX_LEVEL || hp < 1 || hp > maxHP || maxHP > 65535
        || attack < 1 || attack > 999 || defense < 1 || defense > 999
        || spAttack < 1 || spAttack > 999 || spDefense < 1 || spDefense > 999
        || type1 >= NUMBER_OF_MON_TYPES || type2 >= NUMBER_OF_MON_TYPES) return Fail(SPIKE_INVALID_ARGUMENT);
    if (type1 == TYPE_MYSTERY || type2 == TYPE_MYSTERY || (status1 & ~STATUS1_BURN)
        || (status2 & ~STATUS2_FORESIGHT)) return Fail(SPIKE_UNSUPPORTED);
    struct BattlePokemon *mon = &gBattleMons[index];
    mon->level = level; mon->hp = hp; mon->maxHP = maxHP;
    mon->attack = attack; mon->defense = defense; mon->spAttack = spAttack; mon->spDefense = spDefense;
    mon->type1 = type1; mon->type2 = type2; mon->status1 = status1; mon->status2 = status2;
    mon->ability = ABILITY_NONE; mon->item = ITEM_NONE;
#ifdef WATERBLUE_ROUTE1
    mon->species = index == 0 ? SPECIES_SQUIRTLE : SPECIES_PIDGEY;
    mon->ability = index == 0 ? ABILITY_TORRENT : ABILITY_KEEN_EYE;
    gSpeciesInfo[mon->species].types[0] = type1;
    gSpeciesInfo[mon->species].types[1] = type2;
#else
    mon->species = index + 1;
    gSpeciesInfo[index + 1].types[0] = type1;
    gSpeciesInfo[index + 1].types[1] = type2;
#endif
    sConfigured[index] = 1;
    return Fail(SPIKE_OK);
}

s32 spike_set_stage(u32 index, u32 stat, u32 value)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    if (index >= 2 || stat >= NUM_BATTLE_STATS || value > MAX_STAT_STAGE) return Fail(SPIKE_INVALID_ARGUMENT);
    if (stat != STAT_ATK && stat != STAT_DEF && stat != STAT_SPATK && stat != STAT_SPDEF
        && value != DEFAULT_STAT_STAGE) return Fail(SPIKE_UNSUPPORTED);
    gBattleMons[index].statStages[stat] = value;
    return Fail(SPIKE_OK);
}

s32 spike_set_capabilities(u32 ability0, u32 ability1, u32 item0, u32 item1,
                           u32 weather, u32 battleFlags, u32 side0, u32 side1)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    if (ability0 || ability1 || item0 || item1 || weather || battleFlags || side0 || side1) return Fail(SPIKE_UNSUPPORTED);
    return Fail(SPIKE_OK);
}

s32 spike_damage(u32 move, u32 critical)
{
    if (!sInitialized) return Fail(SPIKE_NOT_READY);
    if (gBattleOutcome) return Fail(SPIKE_NOT_READY);
    if (critical != 1 && critical != 2) return Fail(SPIKE_INVALID_ARGUMENT);
    if (move != MOVE_TACKLE && move != MOVE_WATER_GUN) return Fail(SPIKE_UNSUPPORTED);
    if (!sConfigured[0] || !sConfigured[1] || !gBattleMons[0].hp || !gBattleMons[1].hp) return Fail(SPIKE_NOT_READY);
    /* Guard source integer division without altering its arithmetic. Critical
       hits ignore positive defender stages; negative stages still apply. */
    u32 stat = move == MOVE_TACKLE ? STAT_DEF : STAT_SPDEF;
    u32 stage = gBattleMons[1].statStages[stat];
    u32 defense = move == MOVE_TACKLE ? gBattleMons[1].defense : gBattleMons[1].spDefense;
    if (critical == 2 && stage > DEFAULT_STAT_STAGE) stage = DEFAULT_STAT_STAGE;
    if (defense * gStatStageRatios[stage][0] / gStatStageRatios[stage][1] == 0) return Fail(SPIKE_UNSAFE_DEFENSE);
    sStatus = SPIKE_OK;
    sEventCount = 0;
    Zero(sEvents, sizeof(sEvents));
    gCurrentMove = move;
    gCritMultiplier = critical;
    gMoveResultFlags = 0;
    gHpDealt = 0;
    gProtectStructs[0].targetNotAffected = 0;
    /* A command invocation exposes a fresh damage observation, not a complete
       turn reset or a serialization format for the original game's globals. */
    Zero(gSpecialStatuses, sizeof(gSpecialStatuses));
    gProtectStructs[1].physicalDmg = gProtectStructs[1].specialDmg = 0;
    gBattlescriptCurrInstr = sDamageScript;
    Cmd_damagecalc();
    sAfterCritical = gBattleMoveDamage;
    sBaseDamage = sAfterCritical / critical; /* exact diagnostic, not damage mechanics */
    if (sStatus) return sStatus;
    Cmd_typecalc();
    sAfterType = gBattleMoveDamage;
    if (sStatus) return sStatus;
    ApplyRandomDmgMultiplier();
    gBattlescriptCurrInstr = sTargetScript;
    Cmd_healthbarupdate();
    if (sStatus) return sStatus;
    gBattlescriptCurrInstr = sTargetScript;
    Cmd_datahpupdate();
    return sStatus;
}

s32 spike_get_result(u32 field)
{
    switch (field) {
    case 0: return sStatus;
    case 1: return sBaseDamage;
    case 2: return sAfterCritical;
    case 3: return sAfterType;
    case 4: return gBattleMoveDamage;
    case 5: return gMoveResultFlags;
    case 6: return gHpDealt;
    case 7: return gBattleMons[gBattlerTarget].hp;
    case 8: return gProtectStructs[gBattlerTarget].physicalDmg;
    case 9: return gProtectStructs[gBattlerTarget].specialDmg;
    case 10: return (s32)gRngValue;
    case 11: return sEventCount;
    case 12: return gCritMultiplier;
    case 13: return gBattleMons[gBattlerAttacker].pp[gCurrMovePos];
    case 14: return gBattlerAttacker;
    case 15: return gBattlerTarget;
    default: return -1;
    }
}

u32 spike_get_rng(void) { return gRngValue; }
u32 spike_rng_next(void) { return Random(); }

s32 spike_get_event(u32 index, u32 field)
{
    if (index >= sEventCount || field > 2) return -1;
    if (field == 0) return sEvents[index].type;
    if (field == 1) return sEvents[index].battler;
    return sEvents[index].value;
}

s32 spike_get_battler(u32 index, u32 field)
{
    if (index >= 2) return -1;
    switch (field) {
    case 0: return gBattleMons[index].hp;
    case 1: return gProtectStructs[index].physicalDmg;
    case 2: return gProtectStructs[index].specialDmg;
    case 3: return gBattleMons[index].status1;
    case 4: return gBattleMons[index].status2;
    case 5: return gTakenDmg[index];
    case 6: return gTakenDmgByBattler[index];
    case 7: return gProtectStructs[index].targetNotAffected;
#ifdef WATERBLUE_ROUTE1
    case 8: return gBattleMons[index].species;
    case 9: return gBattleMons[index].ability;
#endif
    default: return -1;
    }
}
