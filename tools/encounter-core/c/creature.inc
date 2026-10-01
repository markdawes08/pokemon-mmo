/* Projected storage and validation, not a second creature rules implementation. */
#define CREATURE_WORDS 32
static u32 sCreature[CREATURE_WORDS];
static u32 GetBoxMonData(struct BoxPokemon *mon, s32 field, ...)
{
    if (field < 0 || field >= 89) __builtin_trap();
    return mon->fields[field];
}
static u32 GetMonData(struct Pokemon *mon, s32 field, ...)
{ return GetBoxMonData(&mon->box, field); }
static void SetBoxMonData(struct BoxPokemon *mon, s32 field, const void *value)
{
    const u8 *bytes = value;
    u32 result;
    if (field < 0 || field >= 89) __builtin_trap();
    /* Non-gameplay save display/encryption fields have no projected storage. */
    if (field == MON_DATA_NICKNAME || field == MON_DATA_OT_NAME || field == MON_DATA_CHECKSUM
        || field == MON_DATA_LANGUAGE || field == MON_DATA_MET_LOCATION || field == MON_DATA_MET_GAME
        || field == MON_DATA_MET_LEVEL || field == MON_DATA_POKEBALL || field == MON_DATA_OT_GENDER
        || field == MON_DATA_MAIL) return;
    result = bytes[0];
    if (field == MON_DATA_PERSONALITY || field == MON_DATA_OT_ID || field == MON_DATA_EXP || field == MON_DATA_STATUS)
        result |= (u32)bytes[1] << 8 | (u32)bytes[2] << 16 | (u32)bytes[3] << 24;
    else if (field == MON_DATA_SPECIES || field == MON_DATA_HELD_ITEM
        || (field >= MON_DATA_MOVE1 && field <= MON_DATA_MOVE4)
        || (field >= MON_DATA_HP && field <= MON_DATA_SPDEF))
        result |= (u32)bytes[1] << 8;
    mon->fields[field] = result;
}
static void SetMonData(struct Pokemon *mon, s32 field, const void *value)
{ SetBoxMonData(&mon->box, field, value); }
static void ZeroBoxMonData(struct BoxPokemon *mon)
{ for (u32 i = 0; i < 89; i++) mon->fields[i] = 0; }
static void ZeroMonData(struct Pokemon *mon) { ZeroBoxMonData(&mon->box); }
static u16 CalculateBoxMonChecksum(struct BoxPokemon *mon) { (void)mon; return 0; }
static void EncryptBoxMon(struct BoxPokemon *mon) { (void)mon; }
static void GetSpeciesName(u8 *name, u16 species) { (void)species; name[0] = 0; }
static u8 GetCurrentRegionMapSectionId(void) { return 0; }

static void creature_project(struct Pokemon *mon, u8 slot, u32 *words)
{
    words[0] = 1; words[1] = slot;
    words[2] = GetMonData(mon, MON_DATA_SPECIES);
    words[3] = GetMonData(mon, MON_DATA_LEVEL);
    words[4] = GetMonData(mon, MON_DATA_PERSONALITY);
    words[5] = GetNature(mon); words[6] = GetMonAbility(mon);
    words[7] = GetMonData(mon, MON_DATA_ABILITY_NUM);
    words[8] = GetGenderFromSpeciesAndPersonality(words[2], words[4]);
    words[9] = GetMonData(mon, MON_DATA_OT_ID);
    for (u32 i = 0; i < 6; i++) words[10 + i] = GetMonData(mon, MON_DATA_HP_IV + i);
    for (u32 i = 0; i < 6; i++) words[16 + i] = GetMonData(mon, MON_DATA_MAX_HP + i);
    words[22] = GetMonData(mon, MON_DATA_HP);
    words[23] = GetMonData(mon, MON_DATA_EXP);
    words[24] = GetMonData(mon, MON_DATA_FRIENDSHIP);
    words[25] = GetMonData(mon, MON_DATA_STATUS);
    words[26] = GetMonData(mon, MON_DATA_HELD_ITEM);
    for (u32 i = 0; i < 4; i++) words[27 + i] = GetMonData(mon, MON_DATA_MOVE1 + i)
        | (GetMonData(mon, MON_DATA_PP1 + i) << 16);
    words[31] = 0;
}
static void encounter_creature_clear(void)
{
    for (u32 i = 0; i < CREATURE_WORDS; i++) sCreature[i] = 0;
    for (u32 i = 0; i < PARTY_SIZE; i++) { ZeroMonData(&gEnemyParty[i]); ZeroMonData(&gPlayerParty[i]); }
    gPlayerParty[0].box.fields[MON_DATA_SPECIES] = SPECIES_SQUIRTLE;
    gPlayerParty[0].box.fields[MON_DATA_SANITY_HAS_SPECIES] = 1;
    for (u32 i = 0; i < 4; i++) sTrainer.playerTrainerId[i] = gTrainerId >> (8 * i);
}
static void encounter_create_creature(u16 species, u8 level, u8 slot)
{
    if ((species != SPECIES_PIDGEY && species != SPECIES_RATTATA) || slot >= 12
        || level < 2 || level > (species == SPECIES_PIDGEY ? 5 : 4)) __builtin_trap();
    for (u32 i = 0; i < PARTY_SIZE; i++) ZeroMonData(&gEnemyParty[i]);
    /* The selected, non-Unown GenerateWildMon source call. The full dispatcher
     * lives in encounter_source; this seam supplies only its admitted branch. */
    CreateMonWithNature(&gEnemyParty[0], species, level, USE_RANDOM_IVS, Random() % NUM_NATURES);
    SetWildMonHeldItem();
    creature_project(&gEnemyParty[0], slot, sCreature);
}
static u32 creature_get(u32 field)
{ return field < CREATURE_WORDS ? sCreature[field] : 0; }
static bool8 creature_validate(const u32 *words)
{
    struct Pokemon mon;
    u32 projected[CREATURE_WORDS];
    if (words[0] == 0) {
        for (u32 i = 0; i < CREATURE_WORDS; i++) if (words[i]) return FALSE;
        return TRUE;
    }
    if (words[0] != 1 || words[1] >= 12 || (words[2] != SPECIES_PIDGEY && words[2] != SPECIES_RATTATA)
        || words[3] < 2 || words[3] > (words[2] == SPECIES_PIDGEY ? 5 : 4)) return FALSE;
    /* Recompute derived creation fields through source routines without Random.
     * Only personality, IVs, OT identity and source slot/level are independent. */
    ZeroMonData(&mon);
    mon.box.fields[MON_DATA_SPECIES] = words[2];
    mon.box.fields[MON_DATA_PERSONALITY] = words[4];
    mon.box.fields[MON_DATA_OT_ID] = words[9];
    mon.box.fields[MON_DATA_EXP] = gExperienceTables[gSpeciesInfo[words[2]].growthRate][words[3]];
    mon.box.fields[MON_DATA_FRIENDSHIP] = gSpeciesInfo[words[2]].friendship;
    mon.box.fields[MON_DATA_ABILITY_NUM] = gSpeciesInfo[words[2]].abilities[1] ? words[4] & 1 : 0;
    for (u32 i = 0; i < 6; i++) {
        if (words[10 + i] > 31) return FALSE;
        mon.box.fields[MON_DATA_HP_IV + i] = words[10 + i];
    }
    GiveBoxMonInitialMoveset(&mon.box);
    CalculateMonStats(&mon);
    creature_project(&mon, words[1], projected);
    for (u32 i = 0; i < CREATURE_WORDS; i++) if (words[i] != projected[i]) return FALSE;
    return TRUE;
}
static void creature_restore(const u32 *words)
{
    encounter_creature_clear();
    for (u32 i = 0; i < CREATURE_WORDS; i++) sCreature[i] = words[i];
}
