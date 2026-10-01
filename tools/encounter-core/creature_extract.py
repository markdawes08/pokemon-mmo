"""Extract complete creature rules; projected storage is in c/creature.inc."""
import re


def generate(extraction):
    out = [extraction.block('include/pokemon.h', 'SpeciesInfo', 'struct')]
    out.append(extraction.macro('include/pokemon.h', 'GET_SHINY_VALUE'))
    species_path = 'src/data/pokemon/species_info.h'
    out.append(extraction.macro(species_path, 'PERCENT_FEMALE'))
    species_text = extraction.read(species_path)
    out.append('const struct SpeciesInfo gSpeciesInfo[NUM_SPECIES] = {\n')
    # Entire selected entries, including all fields, are retained verbatim.
    for species in ['SQUIRTLE', 'PIDGEY', 'RATTATA']:
        # Entries contain nested array initializers; find the next entry instead.
        start = species_text.index('    [SPECIES_' + species + '] =')
        end = species_text.index('\n    [', start + 1)
        out.append(extraction.record(species_path, 'SPECIES_' + species, 'selected-table-entry', start, end, species_text))
    out.append('};\n')
    out.append(extraction.read('src/data/pokemon/experience_tables.h'))
    out.append(extraction.block('src/pokemon.c', 'sNatureStatTable', 'table'))
    learnsets = 'src/data/pokemon/level_up_learnsets.h'
    out.append(extraction.macro(learnsets, 'LEVEL_UP_MOVE'))
    out.append(extraction.macro(learnsets, 'LEVEL_UP_END'))
    for species in ['Pidgey', 'Rattata']:
        out.append(extraction.block(learnsets, 's' + species + 'LevelUpLearnset', 'table'))
    out.append('static const u16 *const gLevelUpLearnsets[NUM_SPECIES] = { [SPECIES_PIDGEY] = sPidgeyLevelUpLearnset, [SPECIES_RATTATA] = sRattataLevelUpLearnset };\n')
    # Only PP is read during creation. Its literal source field is copied,
    # rather than importing unrelated battle execution into this factory.
    move_path = 'src/data/battle_moves.h'
    move_text = extraction.read(move_path)
    out.append('static const struct { u8 pp; } gBattleMoves[MOVES_COUNT] = {\n')
    for move in ['TACKLE', 'SAND_ATTACK', 'TAIL_WHIP']:
        start = move_text.index('    [MOVE_' + move + '] =')
        end = move_text.index('\n    [', start + 1)
        field = re.search(r'        \.pp = [^,]+,', move_text[start:end])
        if field is None:
            raise ValueError('Missing source move PP')
        out.append('[MOVE_' + move + '] = {\n')
        out.append(extraction.record(move_path, 'MOVE_' + move + '.pp', 'selected-field', start + field.start(), start + field.end(), move_text))
        out.append('},\n')
    out.append('};\n')
    out.append(extraction.macro('src/pokemon.c', 'CALC_STAT'))
    for function in [
        'CreateMon', 'CreateBoxMon', 'CreateMonWithNature', 'CalculateMonStats',
        'GetLevelFromMonExp', 'GetLevelFromBoxMonExp', 'GiveMoveToBoxMon',
        'GiveBoxMonInitialMoveset', 'DeleteFirstMoveAndGiveMoveToBoxMon',
        'GetNature', 'GetNatureFromPersonality', 'ModifyStatByNature',
        'GetGenderFromSpeciesAndPersonality', 'GetAbilityBySpecies', 'GetMonAbility',
        'SetWildMonHeldItem',
    ]:
        out.append(extraction.block('src/pokemon.c', function, 'function'))
    return '\n'.join(out)
