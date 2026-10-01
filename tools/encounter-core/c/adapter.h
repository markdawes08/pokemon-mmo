#ifndef ENCOUNTER_ADAPTER_H
#define ENCOUNTER_ADAPTER_H
typedef unsigned char u8;
typedef signed char s8;
typedef unsigned short u16;
typedef signed short s16;
typedef unsigned int u32;
typedef signed int s32;
typedef u8 bool8;
typedef u16 bool16;
typedef u32 bool32;
#define NULL ((void *)0)
#define EWRAM_DATA
#define IWRAM_DATA
#define COMMON_DATA
#define FIRERED 1
#define LEAFGREEN 0
#define ENGLISH 1
#include "constants/global.h"
#include "constants/pokemon.h"
#include "constants/species.h"
#include "constants/moves.h"
#include "constants/items.h"
#include "constants/abilities.h"
#include "constants/flags.h"
#include "constants/vars.h"
#include "constants/metatile_behaviors.h"
#include "constants/hold_effects.h"
#include "constants/battle.h"
static u32 gRngValue;
static u32 gMainDraws;
static u32 gWildDraws;
static u32 gTrainerId;
static u32 gEncounterSerial;
static u16 Random(void);
static u16 WildEncounterRandom(void);
static void encounter_create_creature(u16 species, u8 level, u8 slot);
static void encounter_creature_clear(void);
static u32 creature_get(u32 index);
static bool8 creature_validate(const u32 *words);
static void creature_restore(const u32 *words);
#endif
