/* Headless storage seam. Complete extracted source functions own creation rules.
 * Names, encrypted save layout, language and met-location display metadata are
 * intentionally not part of this private factory's gameplay checkpoint. */
struct BoxPokemon { u32 fields[89]; };
struct Pokemon { struct BoxPokemon box; };
static struct Pokemon gEnemyParty[PARTY_SIZE], gPlayerParty[PARTY_SIZE];
static struct { u8 playerTrainerId[4]; u8 playerName[8]; u8 playerGender; } sTrainer;
#define gSaveBlock2Ptr (&sTrainer)
static const u8 gGameLanguage = 2, gGameVersion = 4;
static struct { s32 levelUpHP; } gBattleScripting;
static u32 gBattleTypeFlags;
static u8 gLastUsedAbility;
static u32 GetBoxMonData(struct BoxPokemon *, s32, ...);
static u32 GetMonData(struct Pokemon *, s32, ...);
static void SetBoxMonData(struct BoxPokemon *, s32, const void *);
static void SetMonData(struct Pokemon *, s32, const void *);
static void ZeroBoxMonData(struct BoxPokemon *);
static void ZeroMonData(struct Pokemon *);
static u16 CalculateBoxMonChecksum(struct BoxPokemon *);
static void EncryptBoxMon(struct BoxPokemon *);
static void GetSpeciesName(u8 *, u16);
static u8 GetCurrentRegionMapSectionId(void);
void CreateMon(struct Pokemon *, u16, u8, u8, u8, u32, u8, u32);
void CreateBoxMon(struct BoxPokemon *, u16, u8, u8, u8, u32, u8, u32);
void CreateMonWithNature(struct Pokemon *, u16, u8, u8, u8);
void CalculateMonStats(struct Pokemon *);
static u8 GetLevelFromMonExp(struct Pokemon *);
u8 GetLevelFromBoxMonExp(struct BoxPokemon *);
static u16 GiveMoveToBoxMon(struct BoxPokemon *, u16);
static void GiveBoxMonInitialMoveset(struct BoxPokemon *);
static void DeleteFirstMoveAndGiveMoveToBoxMon(struct BoxPokemon *, u16);
u8 GetNature(struct Pokemon *);
static u8 GetNatureFromPersonality(u32);
static u16 ModifyStatByNature(u8, u16, u8);
u8 GetGenderFromSpeciesAndPersonality(u16, u32);
u8 GetAbilityBySpecies(u16, bool8);
u8 GetMonAbility(struct Pokemon *);
void SetWildMonHeldItem(void);
