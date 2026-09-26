"""Independent, bounded fixture arithmetic; never imports or runs the C/WASM probe.

This deliberately tiny oracle covers only the explicitly listed synthetic cases.
It is not a production battle engine or a substitute for the extraction decision.
Source derivation/provenance is recorded in battle-spike-batch-2-source-evidence.json.
"""
from copy import deepcopy
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[3]
MOVES = {33: (35, 0, 95, 0), 55: (40, 11, 100, 0),
         98: (40, 0, 100, 1), 77: (0, 3, 75, 0)}
RATIOS = [(10, 40), (10, 35), (10, 30), (10, 25), (10, 20), (10, 15),
          (10, 10), (15, 10), (20, 10), (25, 10), (30, 10), (35, 10), (40, 10)]
ACCURACY_RATIOS = [(33, 100), (36, 100), (43, 100), (50, 100), (60, 100), (75, 100),
                   (1, 1), (133, 100), (166, 100), (2, 1), (233, 100), (133, 50), (3, 1)]
TYPE_ROWS = {0: [(5, 5), (8, 5), (7, 0)],
             11: [(10, 20), (11, 5), (12, 5), (4, 20), (5, 20), (16, 5)]}
FAILED = 32  # include/constants/battle.h: MOVE_RESULT_FAILED=(1<<5); 64 is FOE_ENDURED.


def mon(move=33, pp=None, **changes):
    base = dict(level=5, hp=40, maxHP=40, attack=12, defense=9,
                spAttack=13, spDefense=8, speed=20, type1=0, type2=0,
                status1=0, status2=0, stages=[6]*8,
                moves=[dict(move=move, pp=pp if pp is not None else {33: 35, 55: 25, 98: 30, 77: 35}[move])])
    base.update(changes)
    return base


MOVE = {'kind': 'move', 'slot': 0}


def turn(a=MOVE, b=MOVE):
    return {'kind': 'turn', 'choices': [deepcopy(a), deepcopy(b)]}


def replace(a=None, b=None):
    return {'kind': 'replace', 'choices': [a, b]}


def switch(index):
    return {'kind': 'switch', 'partyIndex': index}


class Oracle:
    def __init__(self, initial):
        self.parties = deepcopy(initial['parties'])
        self.active = [0, 0]
        self.rng = initial['seed']
        self.sequence = 0
        self.turn = 1
        self.phase = 'choice'
        self.outcome = None
        self.trace = []
        self.events = []
        self.continuation = None
        self.draw('initial action-selection gRandomTurnNumber')

    def draw(self, label):
        before = self.rng
        self.rng = (self.rng*1103515245+24691) % (1 << 32)
        result = self.rng >> 16
        self.trace.append(dict(label=label, before=before, value=result, after=self.rng))
        return result

    def current(self, side):
        return self.parties[side][self.active[side]]

    def summary(self):
        return dict(sequence=self.sequence, turn=self.turn, phase=self.phase,
                    outcome=self.outcome, active=self.active[:], rngState=self.rng,
                    resume=('before-residual' if self.continuation[0] == 'residual' else 'after-residual')
                    if self.phase == 'replacement' else None,
                    parties=[[dict(hp=m['hp'], status1=m['status1'], status2=m['status2'],
                                   stages=m['stages'][:], pp=[x['pp'] for x in m['moves']])
                              for m in party] for party in self.parties])

    def order(self, choices, phase):
        if phase == 'actions' and any(c['kind'] == 'switch' for c in choices):
            result = sorted([0, 1], key=lambda a: choices[a]['kind'] != 'switch')
        else:
            priority, speeds = [], []
            for actor in [0, 1]:
                m, c = self.current(actor), choices[actor]
                priority.append(MOVES[m['moves'][c['slot']]['move']][3] if c['kind'] == 'move' else 0)
                numerator, denominator = RATIOS[m['stages'][3]]
                speeds.append(m['speed']*numerator//denominator)
            if priority[0] != priority[1]:
                result = [0, 1] if priority[0] > priority[1] else [1, 0]
            elif speeds[0] != speeds[1]:
                result = [0, 1] if speeds[0] > speeds[1] else [1, 0]
            else:
                result = [1, 0] if self.draw(phase+' order speed tie') & 1 else [0, 1]
        self.events.append(dict(kind='order', phase=phase, actors=result))
        return result

    def faint(self, actor):
        m = self.current(actor)
        m['status1'], m['status2'], m['stages'] = 0, 0, [6]*8
        self.events.append(dict(kind='faint', actor=actor, partyIndex=self.active[actor],
                                commands=[dict(type=4, battler=actor, value=0)]))
        alive = [any(m['hp'] for m in party) for party in self.parties]
        if not all(alive):
            self.outcome = 'draw' if not any(alive) else 'won' if alive[0] else 'lost'
            self.phase = 'ended'
            self.events.append(dict(kind='outcome', outcome=self.outcome))

    def damage(self, actor, move, critical):
        a, d = self.current(actor), self.current(1-actor)
        power, typ, _, _ = MOVES[move]
        physical = typ < 9
        ai, di = (1, 2) if physical else (4, 5)
        attack = a['attack' if physical else 'spAttack']
        defense = d['defense' if physical else 'spDefense']
        if not (critical == 2 and a['stages'][ai] <= 6):
            n, q = RATIOS[a['stages'][ai]]
            attack = attack*n//q
        if not (critical == 2 and d['stages'][di] >= 6):
            n, q = RATIOS[d['stages'][di]]
            defense = defense*n//q
        raw = attack*power*(2*a['level']//5+2)//defense//50
        if physical:
            if a['status1'] == 16:
                raw //= 2
            raw = max(1, raw)
        base = raw+2
        after_crit = value = base*critical
        if typ in (a['type1'], a['type2']):
            value = value*15//10
        flags = 0
        for target, multiplier in TYPE_ROWS[typ]:
            if target not in (d['type1'], d['type2']):
                continue
            if typ == 0 and target == 7 and d['status2'] & (1 << 29):
                continue
            value = value*multiplier//10
            if not value and multiplier:
                value = 1
            if multiplier == 0:
                flags = (flags | 8) & ~6
            elif multiplier == 5 and not flags & 8:
                flags = flags & ~2 if flags & 2 else flags | 4
            elif multiplier == 20 and not flags & 8:
                flags = flags & ~4 if flags & 4 else flags | 2
        after_type = value
        roll = self.draw(f'actor{actor} damage variance')
        value = max(1, value*(100-roll % 16)//100) if value else 0
        applied = min(value, d['hp']) if not flags & 8 else 0
        d['hp'] -= applied
        return dict(baseDamage=base, afterCritical=after_crit, afterType=after_type,
                    damage=value, flags=flags, hpDealt=applied, targetHP=d['hp'], critical=critical)

    def attack(self, actor, slot):
        a, d = self.current(actor), self.current(1-actor)
        selected = a['moves'][slot]
        move = selected['move']
        selected['pp'] -= 1  # Controller event occurs after accuracy on hit/miss scripts; result is same here.
        commands = [dict(type=3, battler=actor, value=selected['pp'])]
        result = dict(baseDamage=0, afterCritical=0, afterType=0, damage=0, flags=0,
                      hpDealt=0, targetHP=d['hp'], critical=1)
        blocked_status = move == 77 and (d['status1'] or 3 in (d['type1'], d['type2']) or 8 in (d['type1'], d['type2']))
        accuracy = 0 if blocked_status else self.draw(f'actor{actor} accuracy') % 100+1
        buff = a['stages'][6] if d['status2'] & (1 << 29) else a['stages'][6]+6-d['stages'][7]
        numerator, denominator = ACCURACY_RATIOS[max(0, min(12, buff))]
        accuracy_threshold = MOVES[move][2]*numerator//denominator
        if blocked_status:
            result['flags'] = 0 if d['status1'] == 8 else 8 if 3 in (d['type1'], d['type2']) or 8 in (d['type1'], d['type2']) else FAILED
        elif accuracy > accuracy_threshold:
            result['flags'] = 1 | FAILED if move == 77 else 1
        elif move == 77:
            d['status1'] = 8
            commands.append(dict(type=4, battler=1-actor, value=8))
        else:
            critical = 2 if self.draw(f'actor{actor} critical') % 16 == 0 else 1
            result = self.damage(actor, move, critical)
            if not result['flags'] & 8:
                commands.extend([dict(type=1, battler=1-actor, value=min(10000, result['damage'])),
                                 dict(type=2, battler=1-actor, value=d['hp'])])
            self.draw(f'actor{actor} zero-effect secondary check')
        self.events.append(dict(kind='attack', actor=actor, partyIndex=self.active[actor],
                                slot=slot, move=move, result=result, commands=commands))
        if d['hp'] == 0:
            self.faint(1-actor)

    def switch(self, actor, index, forced):
        previous = self.active[actor]
        old = self.current(actor)
        old['status2'], old['stages'] = 0, [6]*8
        self.active[actor] = index
        new = self.current(actor)
        new['status2'], new['stages'] = 0, [6]*8
        self.events.append(dict(kind='switch', actor=actor, **{'from': previous}, to=index, forced=forced))

    def finish(self):
        self.turn += 1
        self.phase = 'choice'
        self.draw('next action-selection gRandomTurnNumber')

    def residual(self, choices):
        for actor in self.order(choices, 'residual'):
            m = self.current(actor)
            if not m['hp'] or not m['status1']:
                continue
            status = m['status1']
            assert status in (8, 16)
            amount = max(1, m['maxHP']//8)
            m['hp'] = max(0, m['hp']-amount)
            self.events.append(dict(kind='residual', actor=actor, status=status,
                                    commands=[dict(type=1, battler=actor, value=amount),
                                              dict(type=2, battler=actor, value=m['hp'])]))
            if m['hp'] == 0:
                self.faint(actor)
                if self.phase == 'ended':
                    return
        if any(self.current(actor)['hp'] == 0 for actor in [0, 1]):
            self.phase, self.continuation = 'replacement', ('finish', choices)
        else:
            self.finish()

    def step(self, step):
        self.trace, self.events = [], []
        choices = step['choices']
        if step['kind'] == 'replace':
            assert self.phase == 'replacement'
            for actor, choice in enumerate(choices):
                if choice:
                    self.switch(actor, choice['partyIndex'], True)
            continuation, prior_choices = self.continuation
            self.phase = 'choice'
            if continuation == 'residual':
                self.residual(prior_choices)
            else:
                self.finish()
        else:
            assert self.phase == 'choice'
            for actor in self.order(choices, 'actions'):
                choice = choices[actor]
                if choice['kind'] == 'switch':
                    self.switch(actor, choice['partyIndex'], False)
                else:
                    self.attack(actor, choice['slot'])
                if self.phase == 'ended':
                    break
                if any(self.current(a)['hp'] == 0 for a in [0, 1]):
                    self.phase, self.continuation = 'replacement', ('residual', choices)
                    break
            if self.phase == 'choice':
                self.residual(choices)
        self.sequence += 1
        return dict(state=self.summary(), goldenEvents=deepcopy(self.events), rngDrawTrace=deepcopy(self.trace))


CASES = [
    ('ordinary-attacks-and-pp-two-turns', 0,
     [[mon()], [mon(55, speed=10, type1=11, type2=11)]], [turn(), turn()]),
    ('tackle-miss-consumes-pp-only-one-attack-draw', 58,
     [[mon()], [mon(55, speed=10, type1=11, type2=11)]], [turn()]),
    ('critical-knockout-victory-cancels-opponent', 50,
     [[mon()], [mon(speed=10, hp=10)]], [turn()]),
    ('speed-tie-actions-and-residual-resort', 1,
     [[mon()], [mon()]], [turn()]),
    ('quick-attack-priority-beats-speed', 0,
     [[mon(98, speed=5)], [mon(55, speed=30, type1=11, type2=11)]], [turn()]),
    ('voluntary-switch-cleans-volatiles-preserves-bench-burn', 0,
     [[mon(status1=16, status2=1 << 29, stages=[6, 12, 6, 6, 6, 6, 6, 6]), mon(speed=25)],
      [mon(speed=10)]], [turn(switch(1)), turn(switch(0))]),
    ('burn-residual-faint-and-forced-replacement', 0,
     [[mon(hp=7, status1=16), mon(speed=25)], [mon(speed=10, attack=1)]],
     [turn(), replace(switch(1), None)]),
    ('poison-powder-infliction-and-residual-loss', 0,
     [[mon(speed=10, hp=5)], [mon(77, type1=3, type2=3)]], [turn()]),
    ('poison-powder-steel-immunity-skips-accuracy', 0,
     [[mon(speed=10, type1=8, type2=8)], [mon(77, type1=3, type2=3)]], [turn()]),
    ('attack-knockout-replacement-before-incoming-residual', 50,
     [[mon()], [mon(speed=10, hp=10), mon(speed=10, status1=16)]],
     [turn(), replace(None, switch(1))]),
    ('first-residual-terminal-stops-second-burn', 0,
     [[mon(77, hp=3, status1=16)], [mon(77, speed=10, hp=3, status1=16)]], [turn()]),
    ('already-poisoned-powder-deducts-pp-without-accuracy', 0,
     [[mon(77)], [mon(speed=10, status1=8)]], [turn()]),
    ('accuracy-evasion-stages-floor-to-forty', 2,
     [[mon(stages=[6, 6, 6, 6, 6, 6, 4, 6])], [mon(speed=10, stages=[6, 6, 6, 6, 6, 6, 6, 8])]], [turn()]),
    ('foresight-ignores-evasion-but-retains-accuracy-drop', 2,
     [[mon(stages=[6, 6, 6, 6, 6, 6, 4, 6])], [mon(speed=10, status2=1 << 29, stages=[6, 6, 6, 6, 6, 6, 6, 8])]], [turn()]),
    ('poison-powder-accuracy-miss-combines-failure-flags', 58,
     [[mon(77)], [mon(speed=10)]], [turn()]),
]


def main():
    rows = []
    for case_id, seed, parties, steps in CASES:
        initial = dict(seed=seed, parties=parties)
        oracle = Oracle(initial)
        expected_initial = dict(state=oracle.summary(), rngDrawTrace=deepcopy(oracle.trace))
        transcript = [dict(input=deepcopy(step), expected=oracle.step(step)) for step in steps]
        rows.append(dict(id=case_id, initial=initial, expectedInitial=expected_initial, steps=transcript))
    # Independently hand-checked anchor values: changing the oracle must not silently change these.
    assert rows[1]['steps'][0]['expected']['rngDrawTrace'][0]['value'] == 597
    assert rows[1]['steps'][0]['expected']['goldenEvents'][1]['result']['flags'] == 1
    assert rows[2]['steps'][0]['expected']['state']['rngState'] == 2478993009
    assert rows[2]['steps'][0]['expected']['goldenEvents'][1]['result']['damage'] == 14
    assert rows[7]['steps'][0]['expected']['state']['outcome'] == 'lost'
    assert rows[7]['steps'][0]['expected']['state']['rngState'] == 3805062638
    assert rows[8]['steps'][0]['expected']['goldenEvents'][1]['commands'] == [dict(type=3, battler=1, value=34)]
    assert rows[9]['steps'][0]['expected']['state']['resume'] == 'before-residual'
    assert rows[9]['steps'][1]['expected']['state']['parties'][1][1]['hp'] == 35
    assert rows[10]['steps'][0]['expected']['state']['rngState'] == 24691
    assert rows[10]['steps'][0]['expected']['state']['parties'][1][0]['hp'] == 3
    assert rows[10]['steps'][0]['expected']['state']['outcome'] == 'lost'
    assert rows[11]['steps'][0]['expected']['goldenEvents'][1]['result']['flags'] == 0
    assert rows[12]['steps'][0]['expected']['goldenEvents'][1]['result']['flags'] == 1
    assert rows[13]['steps'][0]['expected']['goldenEvents'][1]['result']['flags'] == 0
    assert rows[14]['steps'][0]['expected']['goldenEvents'][1]['result']['flags'] == 33
    result = dict(schemaVersion=1, scope='p03-batch-2-bounded-turn-reference',
                  sourceFingerprint='f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982',
                  provenance='Independently inspected source arithmetic and script ordering, with synthetic fixture inputs; not compiled-probe output or a production engine.',
                  cases=rows,
                  isolation={'caseIds': [CASES[0][0], CASES[6][0]],
                             'schedule': [[0, 0], [1, 0], [0, 1], [1, 1]],
                             'expectation': 'Every step matches the same literal standalone transcript, including RNG and all party summaries.'})
    destination = Path(__file__).with_name('batch-2.json')
    destination.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'cases': len(rows), 'steps': sum(len(row['steps']) for row in rows),
                      'summaries': [{'id': row['id'], 'state': row['steps'][-1]['expected']['state']} for row in rows]}))


if __name__ == '__main__':
    main()
