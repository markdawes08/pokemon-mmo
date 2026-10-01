/* Included immediately after the unchanged source Random definition. Every
 * subsequent source/adapter call is macro-routed through this counter. The
 * original LCG body, return bits and one-draw semantics remain unchanged. */
static u16 SpikeCountedRandom(void)
{
    if (sRngDrawsHi == 0x1FFFFFu && sRngDrawsLo == 0xFFFFFFFFu) {
#ifdef WATERBLUE_ROUTE1
        /* Abort the candidate: returning a constant could make source wild
         * move/nature rejection loops repeat forever after exhaustion. */
        __builtin_trap();
#else
        Unexpected(); /* host RNG envelope uses an exact safe-integer count */
        return 0;
#endif
    }
    u16 value = Random();
    if (++sRngDrawsLo == 0) ++sRngDrawsHi;
    return value;
}
#define Random SpikeCountedRandom
