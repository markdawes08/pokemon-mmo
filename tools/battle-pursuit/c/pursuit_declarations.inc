/* Source switch-interception variables; reconstructed from a validated order.
 * These cannot survive an exported settled boundary. */
static u8 gMultiHitCounter,gChosenMovePos,gActionsByTurnOrder[MAX_BATTLERS_COUNT];
static u16 gChosenMoveByBattler[MAX_BATTLERS_COUNT];
static u8 sPursuitPending,sPursuitIndex,sPursuitIntercepted,sPursuitCompleting,sPursuitConsumed;
static void PursuitReset(void);
static void PursuitFieldBegin(void);
