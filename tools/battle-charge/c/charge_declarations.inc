static u16 gLockedMoves[MAX_BATTLERS_COUNT];
static bool8 ChargeActive(u32 actor);
static bool8 ChargeSlotValid(u32 actor,u32 slot);
static void ChargeReset(void);
static s32 ChargeFirstTurn(u32 actor,u32 target);
static void ChargeClearForRelease(u32 actor);
static s32 ChargeValidateCheckpoint(const u32 *w);
