/* Profile-v1 portable logical checkpoint. No struct bytes or pointer values.
 * Only settled host choice/replacement/terminal boundaries are supported. */
#define SPIKE_CHECKPOINT_VERSION 1
#define SPIKE_CHECKPOINT_WORDS 148
#define SPIKE_CHECKPOINT_MAGIC 0x57424350u
static u32 sCheckpointExport[SPIKE_CHECKPOINT_WORDS];
static u32 sCheckpointImport[SPIKE_CHECKPOINT_WORDS];
static u8 sCheckpointSeen[SPIKE_CHECKPOINT_WORDS];
static u8 sCheckpointExportReady, sCheckpointImportReady, sCheckpointImportBad;
static u32 sCheckpointImportBoundary;

static void ResetCheckpoint(void)
{
    Zero(sCheckpointExport, sizeof(sCheckpointExport));
    Zero(sCheckpointImport, sizeof(sCheckpointImport));
    Zero(sCheckpointSeen, sizeof(sCheckpointSeen));
    sCheckpointExportReady = sCheckpointImportReady = sCheckpointImportBad = 0;
    sCheckpointImportBoundary = 0;
}

u32 spike3_checkpoint_version(void) { return SPIKE_CHECKPOINT_VERSION; }
u32 spike3_checkpoint_word_count(void) { return SPIKE_CHECKPOINT_WORDS; }
u32 spike3_get_rng_draws(u32 field) { return field == 0 ? sRngDrawsLo : field == 1 ? sRngDrawsHi : 0; }

/* Validate count/state consistency in O(64), without consuming a source draw.
 * This composes the source LCG affine map modulo 2^32; actual gameplay always
 * uses the unchanged source Random body via the counted wrapper. */
static u32 RngAfter(u32 seed, u32 low, u32 high)
{
    u32 multiplier = RAND_MULT, increment = ISO_RANDOMIZE1(0u);
    u32 accumulatedMultiplier = 1, accumulatedIncrement = 0;
    for (u32 bit = 0; bit < 64; bit++) {
        u32 selected = bit < 32 ? (low >> bit) & 1u : (high >> (bit - 32)) & 1u;
        if (selected) {
            accumulatedMultiplier *= multiplier;
            accumulatedIncrement = accumulatedIncrement * multiplier + increment;
        }
        increment *= multiplier + 1u;
        multiplier *= multiplier;
    }
    return accumulatedMultiplier * seed + accumulatedIncrement;
}

static bool8 CheckpointType(u32 type) { return type < NUMBER_OF_MON_TYPES && type != TYPE_MYSTERY; }
static bool8 CheckpointMove(u32 move) { return move == MOVE_NONE || SupportedMove(move); }
static bool8 CheckpointActor(u32 value) { return value < 2; }

static s32 ValidateCheckpoint(const u32 *words)
{
    if (words[0] != SPIKE_CHECKPOINT_MAGIC || words[1] != SPIKE_CHECKPOINT_VERSION
        || words[2] != SPIKE_CHECKPOINT_WORDS || words[3] > 3 || words[7] > 65535
        || words[8] > 3 || words[15] != 0 || words[6] > 0x1FFFFFu)
        return SPIKE_INVALID_ARGUMENT;
    if (RngAfter(words[14], words[5], words[6]) != words[4]) return SPIKE_INVALID_ARGUMENT;
    if (!CheckpointMove(words[13])) return SPIKE_UNSUPPORTED;
    for (u32 actor = 0; actor < 2; actor++) {
        u32 action = words[9 + actor];
        if (action != B_ACTION_USE_MOVE && action != B_ACTION_SWITCH && action != B_ACTION_NONE)
            return SPIKE_UNSUPPORTED;
        if (words[11 + actor] >= MAX_MON_MOVES) return SPIKE_INVALID_ARGUMENT;
        if (words[3] == 0 && action != B_ACTION_NONE) return SPIKE_INVALID_ARGUMENT;
        const u32 *mon = words + 16 + actor * 48;
        if (mon[0] < 1 || mon[0] > MAX_LEVEL || mon[2] < 1 || mon[2] > 65535 || mon[1] > mon[2])
            return SPIKE_INVALID_ARGUMENT;
        for (u32 stat = 3; stat <= 7; stat++)
            if (mon[stat] < 1 || mon[stat] > 999) return SPIKE_INVALID_ARGUMENT;
        /* Checkpoint v1 is the turn-host profile, which admits all stages only
           with defenses >=4. Legacy damage-kernel configurations stay separate. */
        if (mon[4] < 4 || mon[6] < 4) return SPIKE_UNSAFE_DEFENSE;
        if (!CheckpointType(mon[8]) || !CheckpointType(mon[9])
            || !CheckpointType(mon[12]) || !CheckpointType(mon[13])) return SPIKE_UNSUPPORTED;
        if (mon[8] != mon[12] || mon[9] != mon[13]) return SPIKE_UNSUPPORTED;
        if (mon[10] != 0 && mon[10] != STATUS1_POISON && mon[10] != STATUS1_BURN) return SPIKE_UNSUPPORTED;
        if (mon[11] != 0 && mon[11] != STATUS2_FORESIGHT) return SPIKE_UNSUPPORTED;
        if (mon[14] != DEFAULT_STAT_STAGE) return SPIKE_UNSUPPORTED;
        for (u32 stat = 0; stat < NUM_BATTLE_STATS; stat++) {
            if (mon[14 + stat] > MAX_STAT_STAGE) return SPIKE_INVALID_ARGUMENT;
            if (mon[1] == 0 && mon[14 + stat] != DEFAULT_STAT_STAGE) return SPIKE_INVALID_ARGUMENT;
        }
        if (mon[1] == 0 && (mon[10] != 0 || mon[11] != 0)) return SPIKE_INVALID_ARGUMENT;
        for (u32 slot = 0; slot < MAX_MON_MOVES; slot++) {
            if (!CheckpointMove(mon[22 + slot])) return SPIKE_UNSUPPORTED;
            if (mon[26 + slot] > gBattleMoves[mon[22 + slot]].pp) return SPIKE_INVALID_ARGUMENT;
        }
        if (mon[30] || mon[31] || mon[47] || mon[36] > 1 || mon[37] > 1 || mon[46] > 2
            || !CheckpointActor(mon[34]) || !CheckpointActor(mon[35]) || !CheckpointActor(mon[39])
            || (mon[45] >= 2 && mon[45] != 255)) return SPIKE_INVALID_ARGUMENT;
        if (!CheckpointMove(mon[40]) || !CheckpointMove(mon[42]) || !CheckpointMove(mon[43])
            || !CheckpointMove(mon[44]) || !CheckpointType(mon[41])) return SPIKE_UNSUPPORTED;
    }
    u32 hp0 = words[17], hp1 = words[65];
    if (words[3] == 0 && (!hp0 || !hp1 || words[8] != 0)) return SPIKE_INVALID_ARGUMENT;
    if ((words[3] == 1 || words[3] == 2) && ((hp0 && hp1) || words[8] != 0)) return SPIKE_INVALID_ARGUMENT;
    if (words[3] == 3 && words[8] == 0) return SPIKE_INVALID_ARGUMENT;
    if (words[3] == 3 && (((words[8] & B_OUTCOME_LOST) && hp0)
        || ((words[8] & B_OUTCOME_WON) && hp1))) return SPIKE_INVALID_ARGUMENT;
    u32 total[2] = {0, 0};
    u32 present[2] = {0, 0};
    for (u32 side = 0; side < 2; side++) {
        for (u32 slot = 0; slot < PARTY_SIZE; slot++) {
            const u32 *row = words + 112 + side * 18 + slot * 3;
            if (row[0] > 65535 || row[1] > 65535 || row[2] > 1
                || (row[0] == 0 && (row[1] || row[2]))) return SPIKE_INVALID_ARGUMENT;
            if (row[0] && !row[2]) { total[side] += row[1]; present[side] = 1; }
        }
        if (total[side] > 65535) return SPIKE_INVALID_ARGUMENT;
    }
    /* Ordinary boundaries may contain deliberately stale party projections;
       the host rewrites them before source outcome reads. Terminal records
       were just read by Cmd_checkteamslost and must agree with its outcome. */
    if (words[3] == 3) {
        u32 outcome = (total[0] == 0 ? B_OUTCOME_LOST : 0) | (total[1] == 0 ? B_OUTCOME_WON : 0);
        if (!present[0] || !present[1] || words[8] != outcome) return SPIKE_INVALID_ARGUMENT;
    }
    return SPIKE_OK;
}

static s32 CheckpointContext(void)
{
    if (!sInitialized || !sConfigured[0] || !sConfigured[1]) return SPIKE_NOT_READY;
    if (gBattlersCount != 2 || gBattlerPositions[0] != 0 || gBattlerPositions[1] != 1
        || gBattleTypeFlags || gBattleWeather || gBattleControllerExecFlags || gDynamicBasePower
        || gSideStatuses[0] || gSideStatuses[1] || gStatuses3[0] || gStatuses3[1]
        || gBattleStruct->dynamicMoveType) return SPIKE_UNSUPPORTED;
    for (u32 actor = 0; actor < 2; actor++) {
        if (gBattleMons[actor].species != actor + 1 || gBattleMons[actor].ability || gBattleMons[actor].item
            || gProtectStructs[actor].protected || gProtectStructs[actor].endured
            || gProtectStructs[actor].noValidMoves || gProtectStructs[actor].helpingHand
            || gDisableStructs[actor].mimickedMoves || gDisableStructs[actor].substituteHP
            || gDisableStructs[actor].rechargeTimer || sResourceFlags.flags[actor]) return SPIKE_UNSUPPORTED;
    }
    return SPIKE_OK;
}

s32 spike3_checkpoint_export(u32 boundary)
{
    sCheckpointExportReady = 0;
    s32 status = CheckpointContext();
    if (status) return Fail(status);
    u32 *words = sCheckpointExport;
    Zero(words, sizeof(sCheckpointExport));
    words[0] = SPIKE_CHECKPOINT_MAGIC; words[1] = SPIKE_CHECKPOINT_VERSION;
    words[2] = SPIKE_CHECKPOINT_WORDS; words[3] = boundary;
    words[4] = gRngValue; words[5] = sRngDrawsLo; words[6] = sRngDrawsHi;
    words[7] = gRandomTurnNumber; words[8] = gBattleOutcome;
    words[13] = gCurrentMove; words[14] = sRngInitialSeed;
    for (u32 actor = 0; actor < 2; actor++) {
        words[9 + actor] = gChosenActionByBattler[actor];
        words[11 + actor] = gBattleStruct->chosenMovePositions[actor];
        struct BattlePokemon *mon = &gBattleMons[actor];
        u32 *row = words + 16 + actor * 48;
        row[0] = mon->level; row[1] = mon->hp; row[2] = mon->maxHP;
        row[3] = mon->attack; row[4] = mon->defense; row[5] = mon->spAttack; row[6] = mon->spDefense;
        row[7] = mon->speed; row[8] = mon->type1; row[9] = mon->type2;
        row[10] = mon->status1; row[11] = mon->status2;
        row[12] = gSpeciesInfo[actor + 1].types[0]; row[13] = gSpeciesInfo[actor + 1].types[1];
        for (u32 stat = 0; stat < NUM_BATTLE_STATS; stat++) row[14 + stat] = mon->statStages[stat];
        for (u32 slot = 0; slot < MAX_MON_MOVES; slot++) { row[22 + slot] = mon->moves[slot]; row[26 + slot] = mon->pp[slot]; }
        row[32] = gProtectStructs[actor].physicalDmg; row[33] = gProtectStructs[actor].specialDmg;
        row[34] = gProtectStructs[actor].physicalBattlerId; row[35] = gProtectStructs[actor].specialBattlerId;
        row[36] = gProtectStructs[actor].targetNotAffected; row[37] = gProtectStructs[actor].notFirstStrike;
        row[38] = (u32)gTakenDmg[actor]; row[39] = gTakenDmgByBattler[actor];
        row[40] = gLastLandedMoves[actor]; row[41] = gLastHitByType[actor];
        row[42] = gLastMoves[actor]; row[43] = gLastResultingMoves[actor]; row[44] = gLastPrintedMoves[actor];
        row[45] = gLastHitBy[actor]; row[46] = gDisableStructs[actor].isFirstTurn;
    }
    for (u32 side = 0; side < 2; side++) {
        struct Pokemon *party = side == 0 ? gPlayerParty : gEnemyParty;
        for (u32 slot = 0; slot < PARTY_SIZE; slot++) {
            u32 *row = words + 112 + side * 18 + slot * 3;
            row[0] = party[slot].species; row[1] = party[slot].hp; row[2] = party[slot].isEgg;
        }
    }
    status = ValidateCheckpoint(words);
    if (status) return Fail(status);
    sCheckpointExportReady = 1;
    return Fail(SPIKE_OK);
}

u32 spike3_checkpoint_get(u32 index)
{
    if (!sCheckpointExportReady || index >= SPIKE_CHECKPOINT_WORDS) { Fail(SPIKE_INVALID_ARGUMENT); return 0; }
    return sCheckpointExport[index];
}

s32 spike3_import_begin(u32 version, u32 boundary, u32 count)
{
    sCheckpointImportReady = 0;
    sCheckpointImportBad = 0;
    if (version != SPIKE_CHECKPOINT_VERSION) return Fail(SPIKE_UNSUPPORTED);
    if (boundary > 3 || count != SPIKE_CHECKPOINT_WORDS) return Fail(SPIKE_INVALID_ARGUMENT);
    Zero(sCheckpointImport, sizeof(sCheckpointImport));
    Zero(sCheckpointSeen, sizeof(sCheckpointSeen));
    sCheckpointImportBoundary = boundary;
    sCheckpointImportReady = 1;
    return Fail(SPIKE_OK);
}

s32 spike3_import_set(u32 index, u32 value)
{
    if (!sCheckpointImportReady) return Fail(SPIKE_NOT_READY);
    if (index >= SPIKE_CHECKPOINT_WORDS || sCheckpointSeen[index]) {
        sCheckpointImportBad = 1;
        return Fail(SPIKE_INVALID_ARGUMENT);
    }
    sCheckpointImport[index] = value; sCheckpointSeen[index] = 1;
    return Fail(SPIKE_OK);
}

s32 spike3_import_commit(void)
{
    if (!sCheckpointImportReady) return Fail(SPIKE_NOT_READY);
    if (sCheckpointImportBad) return Fail(SPIKE_INVALID_ARGUMENT);
    for (u32 i = 0; i < SPIKE_CHECKPOINT_WORDS; i++) if (!sCheckpointSeen[i]) return Fail(SPIKE_NOT_READY);
    if (sCheckpointImport[3] != sCheckpointImportBoundary) return Fail(SPIKE_INVALID_ARGUMENT);
    s32 status = ValidateCheckpoint(sCheckpointImport);
    if (status) return Fail(status);
    /* Scalar copy survives reset of the staging area. Validation is complete;
       no fallible operation, source command or RNG draw follows this point. */
    u32 words[SPIKE_CHECKPOINT_WORDS];
    for (u32 i = 0; i < SPIKE_CHECKPOINT_WORDS; i++) words[i] = sCheckpointImport[i];
    spike_reset(words[14]);
    gRngValue = words[4]; sRngDrawsLo = words[5]; sRngDrawsHi = words[6];
    gRandomTurnNumber = words[7]; gBattleOutcome = words[8]; gCurrentMove = words[13];
    for (u32 actor = 0; actor < 2; actor++) {
        const u32 *row = words + 16 + actor * 48;
        struct BattlePokemon *mon = &gBattleMons[actor];
        mon->level = row[0]; mon->hp = row[1]; mon->maxHP = row[2];
        mon->attack = row[3]; mon->defense = row[4]; mon->spAttack = row[5]; mon->spDefense = row[6];
        mon->speed = row[7]; mon->type1 = row[8]; mon->type2 = row[9];
        mon->status1 = row[10]; mon->status2 = row[11]; mon->species = actor + 1;
        gSpeciesInfo[actor + 1].types[0] = row[12]; gSpeciesInfo[actor + 1].types[1] = row[13];
        for (u32 stat = 0; stat < NUM_BATTLE_STATS; stat++) mon->statStages[stat] = row[14 + stat];
        for (u32 slot = 0; slot < MAX_MON_MOVES; slot++) { mon->moves[slot] = row[22 + slot]; mon->pp[slot] = row[26 + slot]; }
        gProtectStructs[actor].physicalDmg = row[32]; gProtectStructs[actor].specialDmg = row[33];
        gProtectStructs[actor].physicalBattlerId = row[34]; gProtectStructs[actor].specialBattlerId = row[35];
        gProtectStructs[actor].targetNotAffected = row[36]; gProtectStructs[actor].notFirstStrike = row[37];
        gTakenDmg[actor] = (s32)row[38]; gTakenDmgByBattler[actor] = row[39];
        gLastLandedMoves[actor] = row[40]; gLastHitByType[actor] = row[41];
        gLastMoves[actor] = row[42]; gLastResultingMoves[actor] = row[43]; gLastPrintedMoves[actor] = row[44];
        gLastHitBy[actor] = row[45]; gDisableStructs[actor].isFirstTurn = row[46];
        gChosenActionByBattler[actor] = words[9 + actor];
        gBattleStruct->chosenMovePositions[actor] = words[11 + actor];
        sConfigured[actor] = 1;
    }
    for (u32 side = 0; side < 2; side++) {
        struct Pokemon *party = side == 0 ? gPlayerParty : gEnemyParty;
        for (u32 slot = 0; slot < PARTY_SIZE; slot++) {
            const u32 *row = words + 112 + side * 18 + slot * 3;
            party[slot].species = row[0]; party[slot].hp = row[1]; party[slot].isEgg = row[2];
        }
    }
    return Fail(SPIKE_OK);
}
