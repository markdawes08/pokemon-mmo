/* Included immediately after the unchanged source Random definition. Every
 * subsequent source/adapter call is macro-routed through this counter. The
 * original LCG body, return bits and one-draw semantics remain unchanged. */
static u16 SpikeCountedRandom(void)
{
    if (sRngDrawsHi == 0x1FFFFFu && sRngDrawsLo == 0xFFFFFFFFu) {
        Unexpected(); /* host RNG envelope uses an exact safe-integer count */
        return 0;
    }
    u16 value = Random();
    if (++sRngDrawsLo == 0) ++sRngDrawsHi;
    return value;
}
#define Random SpikeCountedRandom
