"""Pinned lifecycle functions and complete poison/burn source case blocks.

The residual scheduler is deliberately not copied in full. Its two selected
case blocks retain their original text inside an explicitly named probe wrapper;
the emitted manifest must retain that transformation and the omitted schedule.
"""
from __future__ import annotations

import re


def complete_residual_case(source, label: str) -> str:
    path = "src/battle_util.c"
    text = source.read(path)
    start_function = text.find("u8 DoBattlerEndTurnEffects(void)")
    end_function = text.find("bool8 HandleWishPerishSongOnTurnEnd(void)", start_function)
    if start_function < 0 or end_function < 0:
        raise ValueError("Missing original battler end-turn function boundary")
    pattern = re.compile(r"(?m)^            case " + re.escape(label) + r":[^\n]*\n")
    matches = list(pattern.finditer(text, start_function, end_function))
    if len(matches) != 1:
        raise ValueError(f"Expected one complete residual case {label}")
    start = matches[0].start()
    following = re.search(r"(?m)^            case ENDTURN_[A-Z0-9_]+:", text[matches[0].end():end_function])
    if following is None:
        raise ValueError(f"Missing next source case after {label}")
    end = matches[0].end() + following.start()
    fragment = text[start:end]
    if not re.search(r"gBattleStruct->turnEffectsTracker\+\+;\s*break;\s*$", fragment):
        raise ValueError(f"Unsupported residual case termination {label}")
    return source.record(path, "DoBattlerEndTurnEffects:" + label, "complete-case", start, end, text)


def export(source) -> dict:
    declarations = source.enum_containing("src/battle_util.c", "ENDTURN_POISON")
    declarations += """
/* Non-executable identity markers for the two copied residual case outputs. */
static const u8 BattleScript_PoisonTurnDmg[] = {1};
static const u8 BattleScript_BurnTurnDmg[] = {2};
static void BattleScriptExecute(const u8 *script);
static u8 SpikeSourceResidualCase(void);
void SwitchInClearSetData(void);
void FaintClearSetData(void);
static void Cmd_cleareffectsonfaint(void);
static void Cmd_checkteamslost(void);
"""
    functions = source.block("src/battle_main.c", "SwitchInClearSetData", "function")
    functions += source.block("src/battle_main.c", "FaintClearSetData", "function")
    functions += source.block("src/battle_script_commands.c", "Cmd_cleareffectsonfaint", "function")
    functions += source.block("src/battle_script_commands.c", "Cmd_checkteamslost", "function")
    poison = complete_residual_case(source, "ENDTURN_POISON")
    burn = complete_residual_case(source, "ENDTURN_BURN")
    functions += """
/* ADAPTER WRAPPER: complete selected source cases, not the source scheduler. */
static u8 SpikeSourceResidualCase(void)
{
    u8 effect = 0;
    switch (gBattleStruct->turnEffectsTracker)
    {
""" + poison + burn + """
    default:
        Unexpected();
        break;
    }
    return effect;
}
"""
    return {
        "declarations": declarations,
        "functions": functions,
        "transformations": [
            "SwitchInClearSetData, FaintClearSetData, Cmd_cleareffectsonfaint and Cmd_checkteamslost retain complete original source function bodies.",
            "Only the complete ENDTURN_POISON and ENDTURN_BURN case blocks from DoBattlerEndTurnEffects are copied into SpikeSourceResidualCase. The enclosing full scheduler and its other effect cases are not implemented by this wrapper.",
            "Poison/Burn script symbols are identity markers; the adapter transports their original healthbar/datahp command path with passive-damage flags. It does not execute text, animation, full faint/replacement scripts or end2 callbacks.",
            "Party HP/species/egg access for Cmd_checkteamslost uses explicitly projected in-memory party records. It is not original encrypted Pokemon storage or persistence.",
            "FaintClearSetData reads its unchanged source type-restoration expression from a projected three-row SpeciesInfo array. Synthetic actor + 1 indices store admitted baseline fixture types; they are not source species IDs or the source species database.",
            "Party presence tokens and fixture HP are validated before storage. Eligible side HP totals above 65535 reject instead of overflowing the original Cmd_checkteamslost u16 accumulator; this admits all real Gen III totals but not every synthetic u16-per-mon stress state.",
        ],
    }
