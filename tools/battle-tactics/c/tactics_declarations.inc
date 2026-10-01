/* This profile permits only battle-generated temporary rain. */
static const u8 BattleScript_SuccessForceOut[]={50},BattleScript_RapidSpinAway[]={51};
static const u8 BattleScript_WrapFree[]={52},BattleScript_LeechSeedFree[]={53},BattleScript_SpikesFree[]={54};
static const u8 BattleScript_RainContinuesOrEnds[]={55};
static void TacticsReset(void);
static bool8 TacticsWeatherValid(void);
static void Cmd_damagetohalftargethp(void);
static void Cmd_setdamagetohealthdifference(void);
static void Cmd_adjustsetdamage(void);
static void Cmd_setrain(void);
static bool8 TryDoForceSwitchOut(void);
static void Cmd_rapidspinfree(void);
static void SourceTacticsRainEnd(void);
