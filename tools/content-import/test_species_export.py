"""Independently inspected FireRed species values and fail-closed fixtures."""
import json
from pathlib import Path
import unittest

from c_source import CSourceError
from import_content import ROOT, Source
from species_export import SELECTED_SPECIES, export_species


class PinnedSpeciesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lock = json.loads((ROOT / 'source-lock.json').read_text(encoding='utf-8-sig'))
        manifest = json.loads((ROOT / lock['fingerprint']['manifest']).read_text(encoding='utf-8-sig'))
        cls.source = Source(Path(lock['reference']['localPath']), {row['path']: row for row in manifest['records']})
        cls.result = export_species(cls.source.text)
        cls.species = {row['symbol']: row for row in cls.result['species']}

    def test_selected_closure_keeps_original_sparse_numeric_ids(self):
        self.assertEqual(list(self.species), list(SELECTED_SPECIES))
        self.assertEqual([row['id'] for row in self.result['species']], [1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20])
        self.assertEqual(self.result['coverage'], {'discoveredSpeciesRows': 412, 'selectedSpeciesRows': 14,
                                                'discoveredEvolutionRows': 172, 'discoveredLearnsetPointers': 412})
        self.assertEqual(len(self.result['requiredMoveSymbols']), 44)

    def test_independently_inspected_starter_and_route_one_stats(self):
        # Direct fixtures from species_info.h, not computed from the importer.
        expected = {
            'SPECIES_BULBASAUR': ([45, 49, 49, 45, 65, 65], 45, 64, 31),
            'SPECIES_CHARMANDER': ([39, 52, 43, 65, 60, 50], 45, 65, 31),
            'SPECIES_SQUIRTLE': ([44, 48, 65, 43, 50, 64], 45, 66, 31),
            'SPECIES_PIDGEY': ([40, 45, 40, 56, 35, 35], 255, 55, 127),
            'SPECIES_RATTATA': ([30, 56, 35, 72, 25, 35], 255, 57, 127),
            'SPECIES_RATICATE': ([55, 81, 60, 97, 50, 70], 127, 116, 127),
        }
        for name, (stats, catch_rate, experience, gender) in expected.items():
            with self.subTest(name=name):
                row = self.species[name]
                self.assertEqual(list(row['stats'].values()), stats)
                self.assertEqual((row['catchRate'], row['expYield'], row['genderRatio']), (catch_rate, experience, gender))
        bulbasaur = self.species['SPECIES_BULBASAUR']
        self.assertEqual(bulbasaur['types'], [{'id': 12, 'symbol': 'TYPE_GRASS'}, {'id': 3, 'symbol': 'TYPE_POISON'}])
        self.assertEqual(bulbasaur['evYield'], {'hp': 0, 'attack': 0, 'defense': 0, 'speed': 0, 'spAttack': 1, 'spDefense': 0})
        self.assertEqual(bulbasaur['growthRate'], {'id': 3, 'symbol': 'GROWTH_MEDIUM_SLOW'})
        self.assertEqual(self.species['SPECIES_RATTATA']['growthRate'], {'id': 0, 'symbol': 'GROWTH_MEDIUM_FAST'})
        self.assertEqual(bulbasaur['abilities'], [{'id': 65, 'symbol': 'ABILITY_OVERGROW'}, {'id': 0, 'symbol': 'ABILITY_NONE'}])
        self.assertEqual(bulbasaur['eggCycles'], 20)
        self.assertEqual(bulbasaur['friendship'], 70)
        self.assertFalse(bulbasaur['noFlip'])

    def test_level_up_order_duplicates_and_firered_metal_claw_survive(self):
        bulbasaur = self.species['SPECIES_BULBASAUR']['levelUpLearnset']
        self.assertEqual([(entry['level'], entry['move']['symbol']) for entry in bulbasaur], [
            (1, 'MOVE_TACKLE'), (4, 'MOVE_GROWL'), (7, 'MOVE_LEECH_SEED'), (10, 'MOVE_VINE_WHIP'),
            (15, 'MOVE_POISON_POWDER'), (15, 'MOVE_SLEEP_POWDER'), (20, 'MOVE_RAZOR_LEAF'),
            (25, 'MOVE_SWEET_SCENT'), (32, 'MOVE_GROWTH'), (39, 'MOVE_SYNTHESIS'), (46, 'MOVE_SOLAR_BEAM'),
        ])
        charizard = self.species['SPECIES_CHARIZARD']['levelUpLearnset']
        self.assertEqual([(entry['level'], entry['move']['symbol']) for entry in charizard[:7]], [
            (1, 'MOVE_HEAT_WAVE'), (1, 'MOVE_SCRATCH'), (1, 'MOVE_GROWL'), (1, 'MOVE_EMBER'),
            (1, 'MOVE_METAL_CLAW'), (7, 'MOVE_EMBER'), (13, 'MOVE_METAL_CLAW'),
        ])
        self.assertEqual(charizard[10], {'level': 36, 'move': {'id': 17, 'symbol': 'MOVE_WING_ATTACK'}})
        squirtle = self.species['SPECIES_SQUIRTLE']['levelUpLearnset']
        self.assertEqual(squirtle[-1], {'level': 47, 'move': {'id': 56, 'symbol': 'MOVE_HYDRO_PUMP'}})

    def test_evolution_closure_and_held_item_dependencies(self):
        expected = {
            'SPECIES_BULBASAUR': (16, 'SPECIES_IVYSAUR'), 'SPECIES_IVYSAUR': (32, 'SPECIES_VENUSAUR'),
            'SPECIES_CHARMANDER': (16, 'SPECIES_CHARMELEON'), 'SPECIES_CHARMELEON': (36, 'SPECIES_CHARIZARD'),
            'SPECIES_SQUIRTLE': (16, 'SPECIES_WARTORTLE'), 'SPECIES_WARTORTLE': (36, 'SPECIES_BLASTOISE'),
            'SPECIES_PIDGEY': (18, 'SPECIES_PIDGEOTTO'), 'SPECIES_PIDGEOTTO': (36, 'SPECIES_PIDGEOT'),
            'SPECIES_RATTATA': (20, 'SPECIES_RATICATE'),
        }
        for name, row in self.species.items():
            if name in expected:
                evolution, = row['evolutions']
                self.assertEqual((evolution['parameter'], evolution['targetSpecies']['symbol']), expected[name])
                self.assertEqual(evolution['method'], {'id': 4, 'symbol': 'EVO_LEVEL'})
            else:
                self.assertEqual(row['evolutions'], [])
        raticate = self.species['SPECIES_RATICATE']
        self.assertEqual(raticate['heldItems'], {'common': {'id': 139, 'symbol': 'ITEM_ORAN_BERRY'},
                                               'rare': {'id': 142, 'symbol': 'ITEM_SITRUS_BERRY'}})
        self.assertEqual(self.result['requiredItemSymbols'], ['ITEM_NONE', 'ITEM_ORAN_BERRY', 'ITEM_SITRUS_BERRY'])
        self.assertEqual(self.species['SPECIES_RATTATA']['types'], [{'id': 0, 'symbol': 'TYPE_NORMAL'}] * 2)

    def test_required_unknown_fields_constants_and_broken_learnsets_fail(self):
        mutations = [
            ('src/data/pokemon/species_info.h', '.baseHP = 45,', '.baseHealth = 45,'),
            ('src/data/pokemon/species_info.h', '.catchRate = 45,', '.catchRate = 0,'),
            ('src/data/pokemon/species_info.h', 'ABILITY_OVERGROW, ABILITY_NONE', 'ABILITY_UNKNOWN, ABILITY_NONE'),
            ('src/data/pokemon/level_up_learnsets.h', 'LEVEL_UP_MOVE(4, MOVE_GROWL)', 'LEVEL_UP_MOVE(0, MOVE_GROWL)'),
            ('src/data/pokemon/evolution.h', '{{EVO_LEVEL, 16, SPECIES_IVYSAUR}}', '{{EVO_LEVEL, 16, SPECIES_CATERPIE}}'),
        ]
        for path, old, new in mutations:
            def altered_read(relative):
                source = self.source.text(relative)
                return source.replace(old, new, 1) if relative == path else source
            with self.subTest(replacement=new), self.assertRaises(CSourceError):
                export_species(altered_read)


if __name__ == '__main__':
    unittest.main()
