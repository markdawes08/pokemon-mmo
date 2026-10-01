/** Source-literal comparisons for the private item extension. */
import assert from 'node:assert/strict';
import type { Route1Capture, Route1Checkpoint, Route1Event, Route1Inventory } from './driver';
import { eventsFromLiteral, summary, type Fixture, type LiteralBoundary, type State } from './verify-support';

type ItemEvent = Exclude<LiteralBoundary['events'][number], { kind: 'potion' | 'capture' }>
  | { kind: 'potion'; itemId: 13; hpBefore: number; hpAfter: number; healed: number; remaining: number }
  | { kind: 'capture-attempt'; itemId: 4; odds: number; threshold: number; shakes: number; caught: boolean; remaining: number };
export interface ItemState extends State { inventory: Route1Inventory; capture: Route1Capture | null }
export interface ItemBoundary extends Omit<LiteralBoundary, 'state' | 'events'> { state: ItemState; events: ItemEvent[] }
export interface ItemStep extends Omit<Fixture['steps'][number], 'expected'> { expected: ItemBoundary }
export interface ItemFixture extends Omit<Fixture, 'initial' | 'steps' | 'inventory'> {
  inventory: Route1Inventory; initial: ItemBoundary; steps: ItemStep[];
}
export interface Arithmetic { mainSeed: number; maxHP: number; hp: number; odds: number; threshold: number }
export interface ThresholdEdge extends Arithmetic {
  firstRoll: number; rngAnchor: number; rngStateBefore: number; rngDrawsBefore: number;
  values: number[]; shakes: number; caught: boolean; rngStateAfter: number;
}
export interface ItemFixtures {
  schemaVersion: number; sourceFingerprint: string; scope: string; independence: string; sqrtBoundary: string;
  schedulingAdaptation: string; sourceRecords: unknown[]; cases: ItemFixture[];
  captureArithmetic: Arithmetic[]; thresholdEdges: ThresholdEdge[]; sqrtCases: { input: number; expected: number }[];
}
export interface ItemRecoveryJob { id: string; checkpoint: Route1Checkpoint; expected: ItemState; remaining: ItemStep[] }
export function itemSummary(checkpoint: Route1Checkpoint): ItemState {
  return { ...summary(checkpoint), inventory: checkpoint.host.inventory, capture: checkpoint.capture };
}
export function assertItemState(checkpoint: Route1Checkpoint, expected: ItemState, label: string): void {
  assert.deepEqual(itemSummary(checkpoint), expected, `${label}: source state, inventory and exact pending capture`);
}
export function itemEvents(events: ItemEvent[]): Route1Event[] {
  return events.map(event => {
    if (event.kind === 'potion') return { kind: 'potion', itemId: 13, restoredHp: event.healed, remaining: event.remaining };
    if (event.kind === 'capture-attempt') return { kind: 'capture', itemId: 4, shakes: event.shakes, caught: event.caught, remaining: event.remaining };
    return eventsFromLiteral([event])[0]!;
  });
}
export function assertItemStep(events: Route1Event[], checkpoint: Route1Checkpoint, expected: ItemBoundary, label: string): void {
  assert.deepEqual(events, itemEvents(expected.events), `${label}: ordered item/wild/terminal source events`);
  assertItemState(checkpoint, expected.state, label);
}
