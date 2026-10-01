"""Pinned, explicitly selected Potion/Poke Ball source branches for Route 1."""
from __future__ import annotations


def export(source):
    declarations = []
    declarations.append(source.macro('include/battle.h', 'B_ACTION_USE_ITEM'))
    declarations.append(source.enum_containing('include/battle_controllers.h', 'BALL_3_SHAKES_SUCCESS'))
    for name in ('ITEM4_HEAL_HP', 'ITEM4_REVIVE', 'ITEM6_HEAL_HP_FULL', 'ITEM6_HEAL_HP_HALF', 'ITEM6_HEAL_HP_LVL_UP'):
        declarations.append(source.macro('include/constants/item_effects.h', name))
    declarations.append(source.block('src/data/pokemon/item_effects.h', 'sItemEffect_Potion', 'table'))
    declarations.append(source.block('src/battle_script_commands.c', 'sBallCatchBonuses', 'table'))

    path = 'src/pokemon.c'
    text = source.read(path)
    case = text.index('                    case 2: // ITEM4_HEAL_HP')
    start = text.index('                            if (GetMonData(mon, MON_DATA_HP, NULL) == 0)', case)
    end = text.index('\n                        }', start)
    living = source.record(path, 'PokemonUseItemEffects:non-revive-living-guard', 'selected-branch', start, end, text)
    start = text.index('                        // Get amount of HP to restore', end)
    end = text.index('                    case 3: // ITEM4_HEAL_PP', start)
    healing = source.record(path, 'PokemonUseItemEffects:ITEM4_HEAL_HP-amount-update', 'selected-case-suffix', start, end, text)
    source.fragments[-1]['transformation'] = 'Unchanged source case suffix behind Potion-only wrapper; no revive, AI, alternate healing amount or nonbattle admission.'
    functions = ['#define GetMonData Route1GetMonData\n#define SetMonData Route1SetMonData\n',
                 'static bool8 SourcePotion(void) {\n struct Pokemon *mon = &gPlayerParty[0];\n const u8 *itemEffect = sItemEffect_Potion;\n u32 data; u8 idx = 6, val = itemEffect[4] >> 2, battleMonId = 0, r5, usedByAI = 0;\n bool8 retVal = TRUE;\n do {\n',
                 living, healing, '\n } while (0);\n return retVal;\n}\n']

    path = 'src/battle_script_commands.c'
    text = source.read(path)
    fn = text.index('static void Cmd_handleballthrow(void)\n{')
    start = text.index('        odds = (catchRate * ballMultiplier / 10)', fn)
    end = text.index('        if (gLastUsedItem != ITEM_SAFARI_BALL)', start)
    odds = source.record(path, 'Cmd_handleballthrow:odds-status', 'selected-branch', start, end, text)
    start = text.index('        if (odds > 254)', end)
    end = text.index('\n    }\n}', start)
    result = source.record(path, 'Cmd_handleballthrow:success-shake-result', 'selected-branch', start, end, text)
    marker = '            odds = 1048560 / odds;'
    if result.count(marker) != 1: raise ValueError('Source capture threshold changed')
    result = result.replace(marker, marker + '\n            sItemThreshold = odds; /* diagnostic copy; no extra draw */')
    source.fragments[-1]['transformation'] = 'Original complete success/shake result branch; one diagnostic assignment copies final threshold without affecting behavior.'
    catch_start = text.index('            catchRate = gSpeciesInfo[', fn)
    catch_end = text.index('\n', catch_start)
    rate = source.record(path, 'Cmd_handleballthrow:ordinary-catch-rate', 'selected-statement', catch_start, catch_end, text)
    multiplier_start = text.index('            ballMultiplier = sBallCatchBonuses[', catch_end)
    multiplier_end = text.index('\n', multiplier_start)
    multiplier = source.record(path, 'Cmd_handleballthrow:standard-ball-multiplier', 'selected-statement', multiplier_start, multiplier_end, text)
    functions.extend(['static void SourcePokeBall(void) {\n u32 odds; u8 catchRate, ballMultiplier;\n', rate, multiplier, odds,
                      '\n sItemOdds = odds;\n', result, '\n}\n#undef GetMonData\n#undef SetMonData\n'])

    evidence = []
    for path, names in {
        'src/item_use.c': ('BattleUseFunc_PokeBallEtc',),
        'src/party_menu.c': ('ItemUseCB_MedicineStep',),
        'src/battle_main.c': ('SetActionsAndBattlersTurnOrder', 'HandleAction_UseItem'),
        'src/battle_script_commands.c': ('Cmd_handleballthrow',),
    }.items():
        for name in names:
            evidence.append(source.block(path, name, 'function'))
            source.fragments[-1]['kind'] = 'function-evidence-not-compiled'
    path = 'data/battle_scripts_2.s'
    text = source.read(path)
    start, end = text.index('BattleScript_ThrowBall::'), text.index('BattleScript_AIUseFullRestoreOrHpHeal::')
    evidence.append(source.record(path, 'throw-success-failure-player-item-scripts', 'script-evidence-not-compiled', start, end, text))
    path = 'src/libagbsyscall.s'
    text = source.read(path)
    start, end = text.index('\tthumb_func_start Sqrt'), text.index('\tthumb_func_end Sqrt') + len('\tthumb_func_end Sqrt')
    evidence.append(source.record(path, 'Sqrt:BIOS-SWI-8', 'primitive-evidence-not-compiled', start, end, text))
    source.read('include/gba/syscall.h')
    return {'declarations': ''.join(declarations), 'functions': ''.join(functions), 'evidence': ''.join(evidence)}
