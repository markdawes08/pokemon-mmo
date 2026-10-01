/* Restricted environment and logical ABI; source numerical bodies are separate. */
#include "adapter.h"
#include "encounter_defs.h"
static struct WildEncounterData sWildEncounterData;
static bool8 sWildEncountersDisabled;
#include "creature_adapter.h"
#include "source_random.inc"

static u16 Random(void)
{
    if (gMainDraws == 0xffffffffu) __builtin_trap();
    gMainDraws++;
    return SourceRandom();
}
static u16 WildEncounterRandom(void)
{
    if (gWildDraws == 0xffffffffu) __builtin_trap();
    gWildDraws++;
    return SourceWildEncounterRandom();
}
static u32 OrderedRandom32(void)
{
    u32 low = Random();
    return low | ((u32)Random() << 16);
}
#define Random32() OrderedRandom32()
#include "creature_source.inc"
#include "creature.inc"

static const struct WildPokemonHeader gWildMonHeaders[] = {
    {0, 0, &sRoute1_FireRed_LandMonsInfo, NULL, NULL, NULL}
};
struct Roamer { u8 level; };
static struct { struct Roamer roamer; } sUnusedSave1;
#define gSaveBlock1Ptr (&sUnusedSave1)
static u16 GetCurrentMapWildMonHeaderId(void) { return 0; }
/* The admitted policy has no flags, repel, bike/surf, active roamer or bridges. */
static bool8 FlagGet(u16 flag) { (void)flag; return FALSE; }
static u16 VarGet(u16 var) { (void)var; return 0; }
static bool8 TestPlayerAvatarFlags(u8 flags) { (void)flags; return FALSE; }
static bool8 MetatileBehavior_IsBridge(u8 behavior) { (void)behavior; return FALSE; }
static bool8 TryStartRoamerEncounter(void) { return FALSE; }
static void StartRoamerBattle(void) { __builtin_trap(); }
static void StartWildBattle(void) { /* Caller receives the generated private creature. */ }
static u8 ChooseWildMonIndex_WaterRock(void) { __builtin_trap(); }
static void GenerateWildMon(u16 species, u8 level, u8 slot)
{
    encounter_create_creature(species, level, slot);
}
static bool8 IsWildLevelAllowedByRepel(u8 level);
static void ApplyFluteEncounterRateMod(u32 *rate);
static u8 GetFluteEncounterRateModType(void);
static void ApplyCleanseTagEncounterRateMod(u32 *rate);
static bool8 IsLeadMonHoldingCleanseTag(void);
static void AddToWildEncounterRateBuff(u8 encounterRate);
void ResetEncounterRateModifiers(void);
#include "encounter_source.inc"

enum { CORE_WORDS = 12, STATE_WORDS = CORE_WORDS + CREATURE_WORDS };
static u32 sImport[STATE_WORDS];
static u8 sImportWritten[STATE_WORDS];
static bool8 sImportActive;
static bool8 sInitialized;

u32 encounter_abi_version(void) { return 1; }
u32 encounter_state_word_count(void) { return STATE_WORDS; }

s32 encounter_reset(u32 mainSeed, u32 wildSeed, u32 trainerId)
{
    if (wildSeed > 0xffffu) return -1;
    gRngValue = mainSeed;
    gMainDraws = gWildDraws = 0;
    gTrainerId = trainerId;
    gEncounterSerial = 0;
    sWildEncounterData = (struct WildEncounterData){0};
    sWildEncountersDisabled = FALSE;
    SeedWildEncounterRng((u16)wildSeed);
    encounter_creature_clear();
    sImportActive = FALSE;
    sInitialized = TRUE;
    return 0;
}

s32 encounter_step(u32 attributes)
{
    if (!sInitialized) return -3;
    u32 type = ExtractMetatileAttribute(attributes, METATILE_ATTRIBUTE_ENCOUNTER_TYPE);
    u32 behavior = ExtractMetatileAttribute(attributes, METATILE_ATTRIBUTE_BEHAVIOR);
    /* Land is only the pinned Route 1 tall grass; no-encounter steps retain prev behavior. */
    if (type > TILE_ENCOUNTER_LAND || (type == TILE_ENCOUNTER_LAND && behavior != MB_TALL_GRASS)) return -1;
    if (gEncounterSerial == 0xffffffffu) return -2;
    if (!TryStandardWildEncounter(attributes)) return 0;
    gEncounterSerial++;
    return 1;
}

s32 encounter_generate(void)
{
    if (!sInitialized) return -3;
    if (gEncounterSerial == 0xffffffffu) return -2;
    if (!TryGenerateWildMon(&sRoute1_FireRed_LandMonsInfo, WILD_AREA_LAND, WILD_CHECK_REPEL)) return -1;
    ResetEncounterRateModifiers();
    gEncounterSerial++;
    return 1;
}

u32 encounter_creature_get(u32 index) { return sInitialized && index < CREATURE_WORDS ? creature_get(index) : 0xffffffffu; }
u32 encounter_state_get(u32 index)
{
    if (!sInitialized) return 0xffffffffu;
    switch (index) {
    case 0: return 1;
    case 1: return gRngValue;
    case 2: return sWildEncounterData.rngState;
    case 3: return gMainDraws;
    case 4: return gWildDraws;
    case 5: return sWildEncounterData.prevMetatileBehavior;
    case 6: return sWildEncounterData.encounterRateBuff;
    case 7: return sWildEncounterData.stepsSinceLastEncounter;
    case 8: return sWildEncounterData.abilityEffect;
    case 9: return sWildEncounterData.leadMonHeldItem;
    case 10: return gTrainerId;
    case 11: return gEncounterSerial;
    default: return index < STATE_WORDS ? creature_get(index - CORE_WORDS) : 0xffffffffu;
    }
}
void encounter_import_begin(void)
{
    for (u32 i = 0; i < STATE_WORDS; i++) { sImport[i] = 0; sImportWritten[i] = 0; }
    sImportActive = TRUE;
}
s32 encounter_import_set(u32 index, u32 value)
{
    if (!sImportActive || index >= STATE_WORDS || sImportWritten[index]) {
        sImportActive = FALSE;
        return -1;
    }
    sImport[index] = value;
    sImportWritten[index] = 1;
    return 0;
}
s32 encounter_import_commit(void)
{
    if (!sImportActive) return -1;
    sImportActive = FALSE;
    for (u32 i = 0; i < STATE_WORDS; i++) if (!sImportWritten[i]) return -1;
    if (sImport[0] != 1 || sImport[5] > 511 || sImport[6] > 65535 || sImport[7] > 6 || sImport[8] || sImport[9]) return -1;
    if ((sImport[11] == 0) != (sImport[CORE_WORDS] == 0)) return -1;
    if (sImport[CORE_WORDS]) {
        u32 slot = sImport[CORE_WORDS + 1];
        if (slot >= LAND_WILD_COUNT || sImport[CORE_WORDS + 9] != sImport[10]) return -1;
        const struct WildPokemon *entry = &sRoute1_FireRed_LandMons[slot];
        if (sImport[CORE_WORDS + 2] != entry->species || sImport[CORE_WORDS + 3] != entry->minLevel) return -1;
    }
    if (!creature_validate(sImport + CORE_WORDS)) return -1;
    gRngValue = sImport[1]; sWildEncounterData.rngState = sImport[2];
    gMainDraws = sImport[3]; gWildDraws = sImport[4];
    sWildEncounterData.prevMetatileBehavior = sImport[5];
    sWildEncounterData.encounterRateBuff = sImport[6]; sWildEncounterData.stepsSinceLastEncounter = sImport[7];
    sWildEncounterData.abilityEffect = 0; sWildEncounterData.leadMonHeldItem = 0;
    gTrainerId = sImport[10]; gEncounterSerial = sImport[11];
    creature_restore(sImport + CORE_WORDS);
    sInitialized = TRUE;
    return 0;
}
