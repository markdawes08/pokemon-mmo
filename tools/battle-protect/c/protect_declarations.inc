/* Only settled boundaries omit the completed-attack continuation scratch. */
static u8 sProtectPending,sProtectActor,sProtectObeys;
static u16 sProtectMove;
static void ProtectReset(void);
static s32 ProtectValidateCheckpoint(const u32 *w);
static void ProtectCanceller(void);
static void SourceProtectMoveEnd(void);
static s32 UnprotectedFamilyAttack(u32 actor,u32 slot);
