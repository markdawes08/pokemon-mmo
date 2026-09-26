"""Synthetic boundaries for the deliberate C data grammar and evaluation."""
import unittest

from c_source import CSource, CSourceError, designated, fields, parse_table, string, values


class CSourceTests(unittest.TestCase):
    def test_nested_macros_and_c_integer_semantics(self):
        env = CSource()
        env.load('''
            #define A 7
            #define B (A << 3)
            #define CUBE(n) ((n) * (n) * (n))
            #define GROW(n) ((6 * CUBE(n)) / 5 - (15 * (n) * (n)) + (100 * (n)) - 140)
            #define min(a, b) ((a) < (b) ? (a) : (b))
            #define PERCENT_FEMALE(percent) min(254, ((percent * 255) / 100))
            #define BAD_SQUARE(x)x*x
            #define BAD_SUM 1 + 2
            #define BAD_DOUBLE(x) x + x
        ''')
        self.assertEqual(env.integer('B | 3'), 59)
        self.assertEqual(env.integer('GROW(5)'), 135)
        self.assertEqual(env.integer('-7 / 3'), -2)
        self.assertEqual(env.integer('-7 % 3'), -1)
        self.assertEqual(env.integer('7 / -3'), -2)
        self.assertEqual(env.integer('1 ? 4 : MISSING'), 4)
        self.assertEqual(env.integer('0 && MISSING'), 0)
        self.assertEqual(env.integer('PERCENT_FEMALE(12.5)', truncate=True), 31)
        self.assertEqual(env.integer('BAD_SQUARE(2 + 1)'), 5)
        self.assertEqual(env.integer('BAD_SUM * 3'), 7)
        self.assertEqual(env.integer('BAD_DOUBLE(2) * 3'), 8)
        self.assertEqual(env.integer('defined A && !defined MISSING'), 1)
        with self.assertRaisesRegex(CSourceError, 'explicit integer conversion'):
            env.integer('PERCENT_FEMALE(12.5)')

    def test_profile_and_include_guards_preserve_one_branch(self):
        env = CSource({'FIRERED': 1})
        source = '''
            #ifndef GUARD_SAMPLE_H
            #define GUARD_SAMPLE_H
            #include "other.h"
            #if defined(FIRERED)
            #define SELECTED 4
            #elif defined(LEAFGREEN)
            #define SELECTED 8
            #else
            #error unsupported
            #endif
            const int rows[] = {SELECTED};
            #endif
        '''
        self.assertEqual(env.integer(values(parse_table(env.load(source), 'rows'))[0]), 4)
        self.assertEqual(env.includes, ['"other.h"'])
        self.assertEqual(env.load(source).strip(), '')
        with self.assertRaisesRegex(CSourceError, 'Unresolved'):
            CSource().load('#if UNKNOWN_PROFILE\n#endif')
        with self.assertRaisesRegex(CSourceError, 'Unclosed'):
            CSource().load('#ifdef FIRERED')
        with self.assertRaisesRegex(CSourceError, 'Unexpected #else'):
            CSource().load('#if 0\n#else\n#else\n#endif')

    def test_initializer_keeps_order_designators_strings_and_symbols(self):
        env = CSource()
        source = env.load('''
            #define FIRST 8
            #define SECOND 9
            enum Kind { ZERO, KIND = 4, NEXT, MORE = NEXT << 1 };
            const Row rows[2] = {
                [FIRST] = {.name = _("POKé" "MON // /*"), .values = {1, 1, KIND}},
                [SECOND] = {.name = _("quoted \\\"text\\\""), .values = {[4] = 1, [6] = 20}},
            };
        ''')
        rows = designated(parse_table(source, 'rows'))
        self.assertEqual(list(rows), ['FIRST', 'SECOND'])
        first = fields(rows['FIRST'])
        self.assertEqual(string(first['name']), 'POKéMON // /*')
        self.assertEqual([env.integer(v) for v in values(first['values'])], [1, 1, 4])
        self.assertEqual(env.reference('MORE'), {'id': 10, 'symbol': 'MORE'})
        second = fields(rows['SECOND'])
        self.assertEqual(string(second['name']), 'quoted "text"')
        self.assertEqual([env.integer(key[1]) for key, _ in second['values'].entries], [4, 6])

    def test_malformed_or_unsupported_required_inputs_fail(self):
        env = CSource()
        env.load('#define LOOP LOOP\n#define FUNC(x) FUNC(x)\n#define ALIAS TARGET\n#define TARGET(x) x+x')
        for text, message in [('NOT_DEFINED', 'Unresolved'), ('LOOP', 'Recursive'),
                              ('FUNC(1)', 'Recursive'), ('OTHER(1)', 'Unresolved'),
                              ('1 / 0', 'zero'), ('(u8) 3', 'trailing'), ('1 << 99', 'shift'), ('"three"', 'Unsupported numeric'),
                              ('ALIAS(2) * 3', 'unsupported source macro')]:
            with self.subTest(text=text), self.assertRaisesRegex(CSourceError, message):
                env.integer(text)
        with self.assertRaisesRegex(CSourceError, 'Duplicate'):
            designated(parse_table('int rows[] = {[A] = 1, [A] = 2};', 'rows'))
        with self.assertRaisesRegex(CSourceError, 'Duplicate'):
            fields(parse_table('int row = {.power = 1, .power = 2};', 'row'))
        with self.assertRaisesRegex(CSourceError, 'exactly one'):
            parse_table('int rows[] = {1}; int rows[] = {2};', 'rows')
        with self.assertRaises(CSourceError):
            parse_table('int rows[] = {1, 2;', 'rows')
        self.assertEqual(len(values(parse_table('#include "header.h"\nint rows[] = {1,2};\nvoid f(void) { value++; }', 'rows'))), 2)
        with self.assertRaises(CSourceError):
            parse_table('int rows[] = {#unsupported};', 'rows')

    def test_named_helper_definitions_must_be_unconditional(self):
        env = CSource()
        env.load_definitions('#ifndef GUARD_TEST\n#define GUARD_TEST\n#define min(a,b) ((a)<(b)?(a):(b))\n#endif', {'min'})
        self.assertEqual(env.integer('min(3,4)'), 3)
        with self.assertRaisesRegex(CSourceError, 'Conditional'):
            env.load_definitions('#if SOMETHING\n#define X 1\n#endif', {'X'})


if __name__ == '__main__':
    unittest.main()
