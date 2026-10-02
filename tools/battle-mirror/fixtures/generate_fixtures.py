"""Independent reference-source Mirror Move oracle, never production generated.

Extends the retained test-only arithmetic. The source script dispatches the
copied effect without changing the selected slot: Mirror's PP, original action
priority and residual order stay selected; GetMoveTarget consumes its own RNG.
"""
from __future__ import annotations
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fixtures"))
from fixture_io import read_fixture_text, write_fixture_text

ROOT=Path(__file__).resolve().parents[3]
TARGET=Path(__file__).with_name('source-cases.json')
spec=importlib.util.spec_from_file_location('independent_pursuit',ROOT/'tools/battle-pursuit/fixtures/generate_fixtures.py')
pursuit=importlib.util.module_from_spec(spec);spec.loader.exec_module(pursuit)
protect=pursuit.protect;charge=protect.charge;family=pursuit.family;creature=pursuit.creature
MOVE,RUN,STRUGGLE,NEXT,ESCAPE,CONTINUE=pursuit.MOVE,pursuit.RUN,pursuit.STRUGGLE,pursuit.NEXT,pursuit.ESCAPE,pursuit.CONTINUE
switch,replace=pursuit.switch,pursuit.replace
family.MOVES[119]=(0,0,2,0,0,'mirror')
# Literal flags/targets in src/data/battle_moves.h, not emitted move tables.
AFFECTED={16,17,18,28,33,39,44,55,56,98,130,145,158,162,165,184,228,229,283,297}
TARGET_BOTH={39,145}

class Oracle(pursuit.Oracle):
    def __init__(self,initial):
        self.taken=[0,0];self.taken_from=[0,0,0,0]
        super().__init__(initial)

    def summary(self):
        value=super().summary()
        value.update(lastTakenMoves=self.taken[:],lastTakenFrom=self.taken_from[:])
        return value

    def clear_history(self):
        # In this single-battle profile, source switch/faint clearing the
        # battler's row and column clears the complete meaningful matrix.
        self.taken=[0,0];self.taken_from=[0,0,0,0]

    def faint(self,actor):
        self.clear_history();return super().faint(actor)

    def load(self,index,forced=False):
        # ActionSwitch's final mirror-history command is inert: interception
        # skips attackcanceler and never sets OBEYS after action cleanup.
        self.clear_history();return super().load(index,forced)

    def attack(self,actor,slot,action_index,action_order):
        a,t=self.actors[actor],self.actors[actor^1]
        roster_move=165 if slot==4 else a['moves'][slot]['moveId']
        releasing=bool(a['status2']&charge.MULTIPLE)
        chosen=self.locked[actor] if releasing else roster_move
        cancelled=bool(a['status2']&family.FLINCH)
        effective=chosen
        if chosen==119 and not cancelled:
            effective=self.taken[actor]
            if effective in (0,65535):
                candidates=[self.taken_from[actor*2+i] for i in range(2) if i!=actor and self.taken_from[actor*2+i] not in (0,65535)]
                if candidates:effective=candidates[self.draw(f'actor{actor}-mirror-fallback')%len(candidates)]
            if effective in (0,65535):
                a['moves'][slot]['pp']-=1
                self.events.append(dict(kind='move',actor=actor,slot=slot,moveId=119,flags=32,baseDamage=0,
                    afterCritical=0,afterType=0,damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,cancelled=False,targetHP=t['hp']))
                self.resulting[actor]=119;return
            # Exact GetMoveTarget SELECTED retries self; BOTH has no draw.
            if effective not in TARGET_BOTH:
                while self.draw(f'actor{actor}-mirror-target')%2==actor:pass
            # GetMoveTarget persists the resolved target even for a move that
            # does not charge; the same source field is retained for releases.
            self.targets[actor]=actor^1
        start=len(self.events)
        if slot!=4:a['moves'][slot]['moveId']=effective
        try:super().attack(actor,slot,action_index,action_order)
        finally:
            if slot!=4:a['moves'][slot]['moveId']=roster_move
            # Parent arithmetic may synchronize during a KO; retained party
            # identity is selected Mirror, never the temporary copied effect.
            if actor==0 and slot!=4:self.party[self.active]['moves'][slot]['moveId']=roster_move
        move_event=next(e for e in self.events[start:] if e['kind']=='move' and e['actor']==actor)
        if chosen==119 and not cancelled:
            move_event['selectedMoveId']=119
            self.events.insert(start,dict(kind='mirror',actor=actor,moveId=effective))
        # MOVEEND_MIRROR_MOVE checks the originally chosen move's flags, and
        # records chosen rather than resulting move. Copied effects therefore
        # cannot teach the opponent Mirror Move recursively.
        if self.outcome!='forced-escape' and chosen in AFFECTED and not cancelled and not(move_event['flags']&41) and t['hp']:
            self.taken[actor^1]=chosen;self.taken_from[(actor^1)*2+actor]=chosen

def transcript(seed,player,opponent,choices):
    initial=dict(kind='diagnostic',seed=seed,player=deepcopy(player),opponent=deepcopy(opponent));o=Oracle(initial)
    row=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        actual=CONTINUE if choice.get('kind')=='auto-fight' and o.actors[0]['status2']&charge.MULTIPLE else MOVE if choice.get('kind')=='auto-fight' else choice
        row['steps'].append(dict(choice=deepcopy(actual),expected=o.advance(actual)))
    return row

def fixtures():
    cases=[]
    def add(name,player,wild,choices,seed=0,predicate=None,limit=20000):
        for candidate in range(seed,seed+limit if predicate else seed+1):
            row=transcript(candidate,player,wild,choices)
            if predicate is None or predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError('No independent Mirror witness: '+name)
    def moves(row):return [e for s in row['steps'] for e in s['expected']['events'] if e['kind']=='move']
    controls=pursuit.fixtures()
    for old in controls['cases']:
        add(old['id'],old['input']['player'],old['input']['opponent'],[s['choice'] for s in old['steps']],old['input']['seed'])
    auto={'kind':'auto-fight'}
    bird=lambda **kw:creature(16,60,[119],**kw)
    passive=creature(9,100,[110])
    for species,level in [(16,47),(17,52),(18,62)]:
        for actor in [0,1]:
            mirror=creature(species,level,[119]);other=creature(9,100,[33])
            add(f'mirror-first-source-level-{species}-actor-{actor}',[mirror if actor==0 else other],other if actor==0 else mirror,[MOVE]*2)
    for excluded,species in [(97,16),(110,7),(116,19),(119,16),(182,7),(240,7)]:
        add(f'mirror-no-history-after-ineligible-{excluded}',[bird()],creature(species,100,[excluded]),[MOVE]*2)
    for move,species in [(16,16),(17,16),(28,16),(33,7),(39,7),(44,7),(55,7),(56,7),(98,19),(145,7),(158,19),(162,19),(184,20),(228,19),(229,7),(283,19),(297,16)]:
        for actor in [0,1]:
            mirror=bird();other=creature(species,60,[move])
            add(f'mirror-copy-{move}-actor-{actor}',[mirror if actor==0 else other],other if actor==0 else mirror,[MOVE]*3)
    for slot in range(4):
        ids=[16,28,98,17];ids[slot]=119
        for ups in range(4):
            add(f'mirror-slot-{slot}-PPups-{ups}',[creature(16,60,ids,ups=[ups]*4)],creature(7,60,[39]),[dict(kind='move',slot=slot)]*2)
    for critical in [1,2]:
        add(f'mirror-copied-damage-critical-{critical}',[bird()],creature(7,60,[33]),[MOVE]*3,
            predicate=lambda r,critical=critical:any(e.get('selectedMoveId')==119 and e['critical']==critical and e['damage']>0 for e in moves(r)))
    for status in [8,16]:
        add(f'mirror-user-residual-status-{status}',[bird(status=status)],creature(7,60,[33]),[MOVE]*3)
    add('mirror-selected-priority-stays-zero',[bird()],creature(19,60,[98]),[MOVE]*3)
    add('mirror-target-rejection-multiple-draws',[bird()],creature(7,60,[33]),[MOVE]*3,
        predicate=lambda r:any(sum(t['role']=='actor0-mirror-target' for t in s['expected']['trace'])>=3 for s in r['steps']))
    add('mirror-copied-Struggle-spends-Mirror-PP',[bird()],creature(7,60,[110],pp=[0,0,0,0]),[MOVE]*2,
        predicate=lambda r:any(e.get('selectedMoveId')==119 and e['moveId']==165 for e in moves(r)))
    add('mirror-last-PP-then-Struggle',[bird(pp=[1,0,0,0])],creature(9,60,[33]),[MOVE,STRUGGLE],
        predicate=lambda r:any(e.get('selectedMoveId')==119 for e in moves(r)))
    add('mirror-both-users-no-recursion',[bird()],creature(17,70,[119]),[MOVE]*3)
    for actor in [0,1]:
        mirror=bird();skull=creature(7,60,[130])
        add(f'mirror-copied-SkullBash-actor-{actor}',[mirror if actor==0 else skull],skull if actor==0 else mirror,[auto]*5)
    add('mirror-copied-SkullBash-last-PP',[bird(pp=[1,0,0,0])],creature(9,60,[130]),[MOVE,CONTINUE,STRUGGLE],
        predicate=lambda r:any(e['actor']==0 and e.get('ppSpent') is False for e in moves(r)))
    add('mirror-flinch-before-copy-or-PP',[bird()],creature(20,60,[158]),[MOVE]*3,
        predicate=lambda r:any(e['actor']==0 and e['cancelled'] for e in moves(r)))
    add('mirror-retains-hit-history-through-self-boost',[bird()],creature(9,60,[33,110],pp=[1,40,0,0]),[MOVE]*3,
        predicate=lambda r:r['initial']['state']['wildSlot']==0 and any(e.get('selectedMoveId')==119 and e['moveId']==33 for e in moves(r)))
    add('mirror-failed-Whirlwind-does-not-create-history',[creature(16,100,[119])],creature(16,20,[18]),[MOVE]*2,
        predicate=lambda r:r['steps'][-1]['expected']['state']['outcome'] is None)
    add('mirror-keeps-history-through-Protect',[bird()],creature(7,100,[33,182],pp=[1,10,0,0]),[MOVE]*3,
        predicate=lambda r:r['initial']['state']['wildSlot']==0)
    add('mirror-copy-cannot-teach-other-Mirror',[creature(16,60,[119,16])],creature(17,70,[119]),[dict(kind='move',slot=1),MOVE,MOVE])
    add('mirror-history-cleared-by-switch',[bird(),bird()],creature(7,60,[39]),[MOVE,switch(1),MOVE,switch(0),MOVE])
    add('mirror-copied-Pursuit-not-switch-interception',[creature(19,40,[228]),passive],bird(),[MOVE,MOVE,switch(1)],
        predicate=lambda r:any(e.get('selectedMoveId')==119 and e['moveId']==228 for e in moves(r)) and len(r['steps'])==3)
    add('mirror-history-cleared-by-faint',[bird(hp=1),bird()],creature(9,100,[33]),[MOVE,NEXT,replace(1),MOVE])
    add('mirror-history-miss-does-not-overwrite',[bird()],creature(7,60,[33,56],pp=[1,5,0,0]),[MOVE]*3,
        predicate=lambda r:any(e['actor']==1 and e['moveId']==56 and e['flags']==1 for e in moves(r)) and any(e.get('selectedMoveId')==119 and e['moveId']==33 for e in moves(r)))
    records=deepcopy(controls['sourceRecords'])
    for record in records:
        if record['path']=='src/battle_script_commands.c':record['evidence']+='; Cmd_trymirrormove source dispatch; MOVEEND_MIRROR_MOVE chosen flags/history and no-effect exclusion'
        if record['path']=='src/battle_util.c':record['evidence']+='; GetMoveTarget target-selected rejection RNG, BOTH no draw'
        if record['path']=='src/battle_main.c':record['evidence']+='; switch/faint row+column history clears; locked move release keeps selected slot'
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,independence=controls['independence'],
        scope='Private 25-move family party diagnostics plus Struggle; natural singles Mirror history and copied source effects',
        schedulingAdaptation=controls['schedulingAdaptation'],allowedMoves=sorted(controls['allowedMoves']+[119]),unsupportedFamilyMoves=[],
        protectPolicy=controls['protectPolicy'],sourceRecords=records,cases=cases)

def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    data=json.dumps(fixtures(),indent=2)+'\n'
    if '--check' in sys.argv:
        assert read_fixture_text(TARGET)==data,'Independent Mirror literals changed; audit reference before regeneration'
        print('Independent Mirror fixture reproduction passed.')
    else:write_fixture_text(TARGET, data);print(f"Wrote {len(json.loads(data)['cases'])} independent Mirror cases.")

if __name__=='__main__':main()
