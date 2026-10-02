import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client, type Room } from '@colyseus/sdk';
import { createDatabase } from '@pokewaterblue/database';
import { CHARACTER_ROOM, PROTOCOL_VERSION, characterViewSchema, characterTicketSchema, characterErrorSchema, characterSnapshotSchema, worldSnapshotSchema, worldLeftSchema,
  practiceSnapshotSchema, type CharacterError, type PracticeSnapshot, type PracticeCommand } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from './account-fixtures.js';
import { WorldTestBackend } from './world-backend.js';

const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
const database = createDatabase(url), backend = new WorldTestBackend(), emails: string[] = [], rooms: Room[] = [], checks: string[] = [];
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean) {
  const end = Date.now() + 10_000;
  while (!test()) { assert(Date.now() < end, 'Practice network response timed out'); await delay(20); }
}
async function api(path: string, cookie = '', body?: unknown) {
  const response = await fetch(backend.origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(8000),
    headers: { Origin: backend.origin, Cookie: cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() as unknown };
}
async function fixture() {
  const identity = accountFixture(); emails.push(identity.email);
  const signed = await api('/api/auth/sign-up/email', '', identity); assert.equal(signed.response.status, 200);
  const cookie = signed.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); assert(cookie);
  const created = await api('/api/characters', cookie, { commandId: randomUUID(), name: 'PRACTIC' });
  assert.equal(created.response.status, 200);
  const character = characterViewSchema.parse((created.data as { character: unknown }).character);
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  return { cookie, characterId: character.id };
}
async function join(f: { cookie: string; characterId: string }, enterOnFirstSnapshot = false) {
  const issued = await api(`/api/characters/${f.characterId}/ticket`, f.cookie, {}); assert.equal(issued.response.status, 200);
  const ticket = characterTicketSchema.parse(issued.data);
  const room = await new Client(`${backend.origin}/socket`, { headers: { Origin: backend.origin, Cookie: f.cookie } })
    .joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: ticket.ticket });
  rooms.push(room); room.reconnection.enabled = false;
  const state = { room, practice: [] as PracticeSnapshot[], errors: [] as CharacterError[] };
  let firstSnapshot = true, entered = false, leaving = false, left = false;
  room.onMessage('snapshot', value => {
    const profile = characterSnapshotSchema.parse(value);
    if (firstSnapshot && enterOnFirstSnapshot) {
      // A hello snapshot is the ready acknowledgement: immediately submit the next
      // operation, without waiting for practice or masking BUSY with a retry.
      room.send('world-enter', { commandId: randomUUID(), activityId: profile.character.activityId, expectedRevision: profile.character.revision });
    }
    firstSnapshot = false;
    if (enterOnFirstSnapshot && !leaving && profile.character.activity === 'overworld') {
      leaving = true;
      room.send('world-leave', { commandId: randomUUID(), activityId: profile.character.activityId, expectedRevision: profile.character.revision });
    }
  });
  room.onMessage('world', value => { worldSnapshotSchema.parse(value); entered = true; });
  room.onMessage('world-left', value => { worldLeftSchema.parse(value); left = true; });
  room.onMessage('saved', () => {});
  room.onMessage('practice', value => state.practice.push(practiceSnapshotSchema.parse(value)));
  room.onMessage('error', value => state.errors.push(characterErrorSchema.parse(value)));
  room.send('hello', { protocolVersion: PROTOCOL_VERSION });
  await until(() => state.practice.length > 0 && (!enterOnFirstSnapshot || entered && left));
  if (enterOnFirstSnapshot) assert.deepEqual(state.errors, [], 'Hello must finish its practice read before publishing readiness.');
  return state;
}
type Joined = Awaited<ReturnType<typeof join>>;
async function command(client: Joined, value: PracticeCommand): Promise<PracticeSnapshot | CharacterError> {
  for (let retry = 0; retry < 6; retry++) {
    const p = client.practice.length, e = client.errors.length;
    client.room.send('practice-command', value);
    await until(() => client.practice.slice(p).some(row => row.commandId === value.commandId) || client.errors.slice(e).some(row => row.commandId === value.commandId));
    const result = client.practice.slice(p).find(row => row.commandId === value.commandId); if (result) return result;
    const error = client.errors.slice(e).find(row => row.commandId === value.commandId)!;
    if (error.code !== 'BUSY') return error;
    await delay(100);
  }
  throw new Error('Practice network command remained busy');
}
try {
  await backend.start();
  const a = await fixture(), b = await fixture(), one = await join(a, true), two = await join(b);
  checks.push('hello-snapshot-allows-immediate-world-entry-and-leave-without-practice-read-backpressure');
  const setup = one.practice[0]!.catalogue.presets[0]!.setup;
  const start: PracticeCommand = { commandId: randomUUID(), expectedRevision: 0, kind: 'start', setup };
  const began = await command(one, start); assert('state' in began); assert.equal(began.state.revision, 1);
  assert.equal(two.practice.at(-1)!.state.session, null);
  const attack = began.state.session!.presentation.availableChoices.find(row => row.kind === 'move'); assert(attack);
  const turn: PracticeCommand = { commandId: randomUUID(), expectedRevision: 1, kind: 'choose', battleId: began.state.session!.battleId, choice: attack };
  const settled = await command(one, turn); assert('state' in settled); assert.equal(settled.state.revision, 2);
  const retry = await command(one, turn); assert('state' in retry); assert(retry.replayed); assert.deepEqual(retry.state, settled.state);
  checks.push('authenticated-browser-protocol-starts-plays-and-retries-one-committed-turn');
  const forged = await command(two, { ...turn, commandId: randomUUID(), expectedRevision: 0 });
  assert('code' in forged); assert.equal(forged.code, 'STALE_REVISION'); assert(forged.commandId);
  const changed = await command(one, { ...turn, choice: { kind: 'run' } });
  assert('code' in changed); assert.equal(changed.code, 'COMMAND_CONFLICT'); assert.equal(changed.commandId, turn.commandId);
  const malformed = one.errors.length; one.room.send('practice-query', { unsafe: true });
  await until(() => one.errors.length > malformed);
  assert.equal(one.errors.at(-1)!.code, 'INVALID_MESSAGE'); assert.equal(one.errors.at(-1)!.commandId, undefined);
  checks.push('cross-account-commands-fail-and-errors-correlate-only-to-their-own-command', 'unrelated-query-errors-do-not-claim-a-battle-command-id');
  const encoded = JSON.stringify(settled);
  for (const hidden of ['privateEngineState', 'rng', 'wildSlot', 'checkpoint', 'protectPolicy', 'afterCritical']) assert(!encoded.includes(`"${hidden}"`));
  checks.push('actual-socket-projection-excludes-private-checkpoint-rng-and-attack-diagnostics');
  // Restart an isolated owned backend, then authenticate with the surviving session cookie.
  for (const room of rooms) if (room.connection.isOpen) await room.leave();
  await backend.stop(); await backend.start();
  const resumed = await join(a);
  assert.deepEqual(resumed.practice[0]!.state, settled.state);
  const prior = await command(resumed, turn); assert('state' in prior); assert(prior.replayed); assert.deepEqual(prior.state, settled.state);
  const closed = await command(resumed, { commandId: randomUUID(), expectedRevision: 2, kind: 'close', battleId: settled.state.session!.battleId });
  assert('state' in closed); assert.equal(closed.state.session, null); assert.equal(closed.state.revision, 3);
  checks.push('backend-restart-preserves-authenticated-battle-and-command-receipts');
  await writeFile('reports/practice-network-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks,
    processIds: backend.pids, scope: 'Two real local test accounts, authenticated Colyseus protocol, owner isolation, correlated rejection and fresh backend process recovery. No user testing account access.' }, null, 2) + '\n');
  console.log(`Practice network passed: ${checks.length} groups.`);
} finally {
  for (const room of rooms) if (room.connection.isOpen) await room.leave().catch(() => {});
  await backend.stop(); await removeAccountFixturesByEmails(database, emails); await database.close();
}
