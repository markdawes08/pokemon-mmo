import copy
import json
from pathlib import Path
import unittest

from c_source import CSource
from gameplay_export import export_encounters, export_growth_and_types
from import_content import Source


class GameplayTablesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        lock = json.loads((root / 'source-lock.json').read_text(encoding='utf-8'))
        records = json.loads((root / lock['fingerprint']['manifest']).read_text(encoding='utf-8'))['records']
        cls.source = Source(Path(lock['reference']['localPath']), {row['path']: row for row in records})

    def environment(self):
        env = CSource(defines={'FIRERED': 1, 'ENGLISH': 1, 'REVISION': 0})
        env.load(self.source.text('include/constants/species.h'))
        env.load(self.source.text('include/constants/pokemon.h'))
        return env

    def test_route1_preserves_all_slots_levels_and_source_rate(self):
        area = export_encounters(self.source, self.environment())[0]
        self.assertEqual(area['sourceRate'], 21)
        self.assertEqual([row['weight'] for row in area['slots']], [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1])
        self.assertEqual([row['species']['id'] for row in area['slots']], [16, 19] * 6)
        self.assertEqual([row['minLevel'] for row in area['slots']], [3, 3, 3, 3, 2, 2, 3, 3, 4, 4, 5, 4])
        self.assertTrue(all(row['minLevel'] == row['maxLevel'] for row in area['slots']))

    def test_growth_literal_early_entries_and_integer_formula_results(self):
        growth, types, chart = export_growth_and_types(self.source, self.environment(), {'GROWTH_MEDIUM_FAST', 'GROWTH_MEDIUM_SLOW'})
        self.assertEqual([row['id'] for row in growth], [0, 3])
        self.assertEqual([growth[0]['experience'][level] for level in (0, 1, 5, 50, 100)], [0, 1, 125, 125000, 1000000])
        self.assertEqual([growth[1]['experience'][level] for level in (0, 1, 2, 5, 50, 100)], [0, 1, 9, 135, 117360, 1059860])
        self.assertEqual(len(types), 18)
        self.assertEqual(types[9]['name'], '???')
        relationships = {(row['attack']['symbol'], row['defense']['symbol']): row for row in chart}
        self.assertEqual(relationships['TYPE_GHOST', 'TYPE_STEEL']['multiplierTenths'], 5)
        self.assertEqual(relationships['TYPE_DARK', 'TYPE_STEEL']['multiplierTenths'], 5)
        self.assertTrue(relationships['TYPE_NORMAL', 'TYPE_GHOST']['ignoreWhenForesight'])
        self.assertTrue(relationships['TYPE_FIGHTING', 'TYPE_GHOST']['ignoreWhenForesight'])
        self.assertFalse(relationships['TYPE_GHOST', 'TYPE_NORMAL']['ignoreWhenForesight'])
        self.assertEqual(sum(row['ignoreWhenForesight'] for row in chart), 2)
        self.assertFalse(any(row['attack']['id'] >= 18 or row['defense']['id'] >= 18 for row in chart))

    def test_bad_slot_weights_or_levels_fail_before_projection(self):
        class Altered:
            def text(_, path):
                return self.source.text(path)
            def json(_, path):
                return mutated
        original = self.source.json('src/data/wild_encounters.json')
        mutated = copy.deepcopy(original)
        mutated['wild_encounter_groups'][0]['fields'][0]['encounter_rates'][0] = 19
        with self.assertRaisesRegex(ValueError, 'weights'):
            export_encounters(Altered(), self.environment())
        mutated = copy.deepcopy(original)
        row = next(row for row in mutated['wild_encounter_groups'][0]['encounters'] if row['base_label'] == 'sRoute1_FireRed')
        row['land_mons']['mons'][0]['min_level'] = 101
        with self.assertRaisesRegex(ValueError, 'level range'):
            export_encounters(Altered(), self.environment())


if __name__ == '__main__':
    unittest.main()
