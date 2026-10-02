/* Mirror Move's pending dispatch is one atomic source action. Only its four
 * singles history values need new portable checkpoint words. */
static u16 gChosenMove,sMirrorDispatchMove,sMirrorActualMove,sMirrorChosenMove;
static u8 sMirrorCopied,sMirrorTarget,sMirrorResultFlags;
static void MirrorReset(void);
static u32 MirrorActionMove(u32 actor,u32 slot);
static bool8 MirrorCopyable(u32 move);
static s32 MirrorValidateCheckpoint(const u32 *w);
static void MirrorMoveEnd(void);
static void SourceMirrorMoveEnd(void);

