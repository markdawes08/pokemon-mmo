/** Bounded separate-process regression for source AI retry loops at RNG exhaustion. */
import assert from 'node:assert/strict';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { jump } from '../encounter-core/verify-support';
import { Route1Driver, instantiateRoute1, type Route1Checkpoint } from './driver';
import { loadRoute1Module } from './engine';
import { importRaw } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; checkpoint: Route1Checkpoint };
assert.notEqual(input.parentPid, process.pid);
const module = await loadRoute1Module(), max = Number.MAX_SAFE_INTEGER;
const resources = { profile: await loadDevelopmentProfile(), encounters: await loadEncounterCore() };
function at(draws: number): Route1Checkpoint {
  const state = structuredClone(input.checkpoint), words = state.core.words;
  state.rng.draws = draws; words[5] = draws >>> 0; words[6] = Math.floor(draws / 0x100000000);
  state.rng.state = words[4] = jump(words[14]!, draws, 24691);
  // The supplied source Rattata has Tail Whip in slot 1. Slot 0 is exhausted.
  assert.equal(words[87], 39); assert(words[91]! > 0); words[90] = 0; state.host.wildSlot = 1;
  return state;
}
const checks = [];
for (const empty of [false, true]) {
  const raw = instantiateRoute1(module), state = at(max - 1);
  // This explicit raw diagnostic seed makes the final legal draw select slot 0.
  // The following retry must trap, rather than receive an endless zero stream.
  state.core.words[14] = 6;
  state.core.words[4] = jump(6, max - 1, 24691);
  if (empty) state.core.words[86] = 0;
  assert.equal(importRaw(raw, state.core.words), 0);
  assert.throws(() => raw.route1_choose_wild(), WebAssembly.RuntimeError);
  assert.equal((raw.spike3_get_rng_draws(0) >>> 0) + (raw.spike3_get_rng_draws(1) >>> 0) * 0x100000000, max);
  checks.push(empty ? 'inner-empty-slot-loop-traps' : 'outer-depleted-slot-loop-traps');
}
// Both status moves consume one accuracy draw, followed by one selection draw.
// Unequal real speeds consume no tie draws, so AI is reached exactly at max.
const prepared = at(max - 3), raw = instantiateRoute1(module);
assert.equal(importRaw(raw, prepared.core.words), 0);
assert.equal(raw.route1_order(1, 1, 0), 0);
assert.equal(raw.spike2_attack(0, 1), 0); assert.equal(raw.spike2_attack(1, 1), 0);
assert.equal(raw.spike2_residual_order(), 0); assert.equal(raw.spike2_begin_turn(), 0);
assert.equal((raw.spike3_get_rng_draws(0) >>> 0) + (raw.spike3_get_rng_draws(1) >>> 0) * 0x100000000, max);
assert.throws(() => raw.route1_choose_wild(), WebAssembly.RuntimeError);
const driver = Route1Driver.restore(module, resources, prepared), before = driver.snapshot();
assert.throws(() => driver.advanceChoices([{ actor: 0, choice: { kind: 'move', slot: 1 } }]), WebAssembly.RuntimeError);
assert.deepEqual(driver.snapshot(), before, 'Failed next-turn AI never publishes attacks, PP, RNG or stage changes');
checks.push('next-turn-ai-trap-discards-host-candidate');
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, checks }));
