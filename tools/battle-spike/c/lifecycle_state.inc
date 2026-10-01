/* Deliberately projected probe storage, not original Pokemon layouts or a
 * species database. The two baseline type rows use synthetic actor + 1 IDs.
 * Party species values are presence tokens for source team-HP queries only.
 */
struct Pokemon { u16 species, hp; u8 isEgg; };
struct SpeciesInfo { u8 types[2];
#ifdef WATERBLUE_ROUTE1
    u8 catchRate;
#endif
};
static struct Pokemon gPlayerParty[PARTY_SIZE], gEnemyParty[PARTY_SIZE];
#ifdef WATERBLUE_ROUTE1
static struct SpeciesInfo gSpeciesInfo[NUM_SPECIES];
static const u8 sRecoilScript[] = {7};
#else
static struct SpeciesInfo gSpeciesInfo[3];
#endif
static u8 gActionSelectionCursor[MAX_BATTLERS_COUNT], gMoveSelectionCursor[MAX_BATTLERS_COUNT];
static u8 gLastHitBy[MAX_BATTLERS_COUNT], gBattlerPartyIndexes[MAX_BATTLERS_COUNT];
static u16 gLastMoves[MAX_BATTLERS_COUNT], gLastResultingMoves[MAX_BATTLERS_COUNT];
static u16 gLastPrintedMoves[MAX_BATTLERS_COUNT];
static u8 gBattleOutcome;

static u32 GetMonData(struct Pokemon *mon, s32 field);
static void ResetLifecycle(void);
s32 spike2_set_party(u32 side, u32 index, u32 species, u32 hp, u32 isEgg);
s32 spike2_get_party(u32 side, u32 index, u32 field);
s32 spike2_switch_cleanup(u32 actor);
s32 spike2_faint_cleanup(u32 actor);
s32 spike2_residual(u32 actor);
s32 spike2_check_teams_lost(void);
u32 spike2_get_outcome(void);
