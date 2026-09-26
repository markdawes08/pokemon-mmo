"""Complete species-definition rows for the named R1 creature dependency set.

These records describe source data only. They do not execute abilities, moves,
evolution, breeding or create owned creatures. Level-up order and duplicate
entries are preserved exactly, including level-one moves on evolved species.
"""
from __future__ import annotations

from c_source import CSource, CSourceError, Expr, designated, fields, parse_table, string, symbol, values


SELECTED_SPECIES = (
    'SPECIES_BULBASAUR', 'SPECIES_IVYSAUR', 'SPECIES_VENUSAUR',
    'SPECIES_CHARMANDER', 'SPECIES_CHARMELEON', 'SPECIES_CHARIZARD',
    'SPECIES_SQUIRTLE', 'SPECIES_WARTORTLE', 'SPECIES_BLASTOISE',
    'SPECIES_PIDGEY', 'SPECIES_PIDGEOTTO', 'SPECIES_PIDGEOT',
    'SPECIES_RATTATA', 'SPECIES_RATICATE',
)
_STATS = {'hp': 'HP', 'attack': 'Attack', 'defense': 'Defense', 'speed': 'Speed',
          'spAttack': 'SpAttack', 'spDefense': 'SpDefense'}
_FIELDS = {f'base{field}' for field in _STATS.values()} | {f'evYield_{field}' for field in _STATS.values()} | {
    'types', 'catchRate', 'expYield', 'itemCommon', 'itemRare', 'genderRatio', 'eggCycles',
    'friendship', 'growthRate', 'eggGroups', 'abilities', 'safariZoneFleeRate', 'bodyColor', 'noFlip',
}


class SpeciesError(CSourceError):
    pass


def require(condition, message):
    if not condition:
        raise SpeciesError(message)


def export_species(read_text) -> dict:
    """Use a caller-owned pinned UTF-8 reader; write no files."""
    env = CSource({'FIRERED': 1, 'ENGLISH': 1, 'REVISION': 0})
    for path in ('include/constants/species.h', 'include/constants/pokemon.h',
                 'include/constants/items.h', 'include/constants/abilities.h', 'include/constants/moves.h'):
        env.load(read_text(path))
    env.load_definitions(read_text('include/global.h'), {'min'})
    env.load_definitions(read_text('include/gba/defines.h'), {'TRUE', 'FALSE'})
    info = designated(parse_table(env.load(read_text('src/data/pokemon/species_info.h')), 'gSpeciesInfo'))
    names = designated(parse_table(env.load(read_text('src/data/text/species_names.h')), 'gSpeciesNames'))
    pointers = designated(parse_table(env.load(read_text('src/data/pokemon/level_up_learnset_pointers.h')), 'gLevelUpLearnsets'))
    learnsets = env.load(read_text('src/data/pokemon/level_up_learnsets.h'))
    evolutions = designated(parse_table(env.load(read_text('src/data/pokemon/evolution.h')), 'gEvolutionTable'))
    require(len(info) == env.resolve('NUM_SPECIES'), 'SpeciesInfo inventory differs from NUM_SPECIES')
    require(len(names) == env.resolve('NUM_SPECIES'), 'Species name inventory differs from NUM_SPECIES')
    require(len(pointers) == env.resolve('NUM_SPECIES'), 'Learnset pointer inventory differs from NUM_SPECIES')
    require(env.resolve('LEVEL_UP_END') == 65535, 'Unsupported source learnset terminator')
    species = []
    move_dependencies, item_dependencies, ability_dependencies = set(), set(), set()

    def bounded(value, lower=0, upper=255, truncate=False):
        number = env.integer(value, truncate=truncate)
        require(lower <= number <= upper, f'Species numeric value outside {lower}..{upper}: {number}')
        return number

    def references(row, key, prefix):
        refs = [env.reference(value) for value in values(row[key])]
        require(len(refs) == 2 and all(ref['symbol'].startswith(prefix) for ref in refs), f'Invalid species pair {key}')
        return refs

    for name in SELECTED_SPECIES:
        require(name in info and name in names and name in pointers, f'Missing required species row {name}')
        row = fields(info[name])
        require(set(row) == _FIELDS, f'{name}: missing/unsupported SpeciesInfo fields {sorted(set(row) ^ _FIELDS)}')
        record = {
            **env.reference(name), 'name': string(names[name]),
            'stats': {key: bounded(row[f'base{field}'], 1) for key, field in _STATS.items()},
            'types': references(row, 'types', 'TYPE_'),
            'catchRate': bounded(row['catchRate'], 1),
            'expYield': bounded(row['expYield'], 1),
            'evYield': {key: bounded(row[f'evYield_{field}'], 0, 3) for key, field in _STATS.items()},
            'heldItems': {'common': env.reference(row['itemCommon']), 'rare': env.reference(row['itemRare'])},
            # Source SpeciesInfo.genderRatio is a u8. PERCENT_FEMALE(12.5)
            # computes 31.875 before that assignment truncates it to 31.
            'genderRatio': bounded(row['genderRatio'], truncate=True),
            'eggCycles': bounded(row['eggCycles']), 'friendship': bounded(row['friendship']),
            'growthRate': env.reference(row['growthRate']), 'eggGroups': references(row, 'eggGroups', 'EGG_GROUP_'),
            'abilities': references(row, 'abilities', 'ABILITY_'),
            'safariZoneFleeRate': bounded(row['safariZoneFleeRate']),
            'bodyColor': env.reference(row['bodyColor']), 'noFlip': bool(bounded(row['noFlip'], 0, 1)),
            'levelUpLearnset': [], 'evolutions': [],
        }
        require(record['name'] and len(record['name']) <= 10, f'{name}: invalid source name')
        require(all(0 <= ref['id'] < env.resolve('NUMBER_OF_MON_TYPES') for ref in record['types']), f'{name}: invalid types')
        require(record['growthRate']['symbol'].startswith('GROWTH_'), f'{name}: invalid growth symbol')
        require(record['bodyColor']['symbol'].startswith('BODY_COLOR_'), f'{name}: invalid body color symbol')
        item_dependencies.update(ref['symbol'] for ref in record['heldItems'].values())
        ability_dependencies.update(ref['symbol'] for ref in record['abilities'])
        entries = values(parse_table(learnsets, symbol(pointers[name])))
        require(entries and isinstance(entries[-1], Expr) and symbol(entries[-1]) == 'LEVEL_UP_END', f'{name}: missing learnset terminator')
        previous_level = 0
        for entry in entries[:-1]:
            require(isinstance(entry, Expr) and entry.kind == 'call' and entry.value == 'LEVEL_UP_MOVE' and len(entry.args) == 2,
                    f'{name}: unsupported level-up entry')
            level = bounded(entry.args[0], 1, 100)
            move = env.reference(entry.args[1])
            require(move['symbol'].startswith('MOVE_') and 1 <= move['id'] <= 511, f'{name}: invalid level-up move')
            require(previous_level <= level, f'{name}: non-monotonic learnset levels')
            require(env.integer(entry) == (level << 9) | move['id'], f'{name}: incompatible level-up packing')
            previous_level = level
            record['levelUpLearnset'].append({'level': level, 'move': move})
            move_dependencies.add(move['symbol'])
        require(record['levelUpLearnset'] and record['levelUpLearnset'][0]['level'] == 1, f'{name}: no initial moves')
        if name in evolutions:
            entries = values(evolutions[name])
            require(len(entries) <= env.resolve('EVOS_PER_MON'), f'{name}: too many evolutions')
            for entry in entries:
                parts = values(entry)
                require(len(parts) == 3, f'{name}: malformed evolution')
                method, parameter, target = env.reference(parts[0]), env.integer(parts[1]), env.reference(parts[2])
                require(method['symbol'] == 'EVO_LEVEL' and 1 <= parameter <= 100, f'{name}: unsupported required evolution rule')
                require(target['symbol'] in SELECTED_SPECIES, f'{name}: evolution dependency outside selected closure')
                record['evolutions'].append({'method': method, 'parameter': parameter, 'targetSpecies': target})
        species.append(record)
    require(len({row['id'] for row in species}) == len(species), 'Duplicate selected species source IDs')
    return {
        'species': species,
        'requiredMoveSymbols': sorted(move_dependencies, key=env.resolve),
        'requiredItemSymbols': sorted(item_dependencies, key=env.resolve),
        'requiredAbilitySymbols': sorted(ability_dependencies, key=env.resolve),
        'coverage': {'discoveredSpeciesRows': len(info), 'selectedSpeciesRows': len(species),
                     'discoveredEvolutionRows': len(evolutions), 'discoveredLearnsetPointers': len(pointers)},
    }
