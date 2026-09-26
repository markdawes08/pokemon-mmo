import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client, type Room } from '@colyseus/sdk';
import { createDatabase } from '@pokewaterblue/database';
import { CHARACTER_ROOM, PROTOCOL_VERSION, characterViewSchema, characterSnapshotSchema, characterTicketSchema,
  worldSnapshotSchema, worldLeftSchema, characterErrorSchema, profileSavedSchema, type CharacterSnapshot,
  type WorldCommand, type WorldInput, type WorldSnapshot, type CharacterError } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from './account-fixtures.js';
import { WorldTestBackend } from './world-backend.js';

const databaseUrl = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test';
await migrateAccountTestDatabase(databaseUrl);
const database = createDatabase(databaseUrl), backend = new WorldTestBackend();
const ownedEmails: string[] = [], checks: string[] = [];
const rooms: Room[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PALLET = 'MAP_PALLET_TOWN', HOUSE = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', ROUTE = 'MAP_ROUTE1';

async function api(path: string, cookie = '', body?: unknown) {
  const response = await fetch(backend.origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(8000),
    headers: { Origin: backend.origin, Cookie: cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() as unknown };
}
async function trainer(name: string, seeded = true) {
  const credentials = accountFixture(); ownedEmails.push(credentials.email);
  const signedUp = await api('/api/auth/sign-up/email', '', credentials); assert.equal(signedUp.response.status, 200);
  const cookie = signedUp.response.headers.getSetCookie().find(value => value.startsWith('pokewaterblue.session_token='))?.split(';')[0]; assert(cookie);
  const created = await api('/api/characters', cookie, { commandId: randomUUID(), name }); assert.equal(created.response.status, 200);
  const character = characterViewSchema.parse((created.data as { character: unknown }).character);
  if (seeded) await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  return { cookie, character };
}
function message(room: Room, type: string) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => { remove(); reject(new Error(`World test timed out waiting for ${type}`)); }, 5000);
    const remove = room.onMessage(type, (value: unknown) => { clearTimeout(timeout); remove(); resolve(value); });
  });
}
async function join(cookie: string, characterId: string) {
  const issued = await api(`/api/characters/${characterId}/ticket`, cookie, {}); assert.equal(issued.response.status, 200);
  const ticket = characterTicketSchema.parse(issued.data);
  const room = await new Client(`${backend.origin}/socket`, { headers: { Origin: backend.origin, Cookie: cookie } })
    .joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: ticket.ticket });
  room.reconnection.enabled = false; rooms.push(room);
  const state: { room: Room; profile?: CharacterSnapshot; world?: WorldSnapshot; history: WorldSnapshot[]; errors: CharacterError[]; sequence: number } = { room, history: [], errors: [], sequence: 0 };
  room.onMessage('snapshot', (data: unknown) => { state.profile = characterSnapshotSchema.parse(data); });
  room.onMessage('world', (data: unknown) => { state.world = worldSnapshotSchema.parse(data); state.history.push(state.world); });
  room.onMessage('error', (data: unknown) => { state.errors.push(characterErrorSchema.parse(data)); }); room.onMessage('saved', () => {}); room.onMessage('world-left', () => {});
  const snapshot = message(room, 'snapshot'); room.send('hello', { protocolVersion: PROTOCOL_VERSION }); await snapshot;
  return state;
}
type Joined = Awaited<ReturnType<typeof join>>;
async function until(test: () => boolean, description: string, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (test()) return; await delay(20); }
  throw new Error(`World assertion timed out: ${description}`);
}
function command(client: Joined): WorldCommand {
  assert(client.profile); return { commandId: randomUUID(), activityId: client.profile.character.activityId, expectedRevision: client.profile.character.revision };
}
async function enter(client: Joined) {
  client.room.send('world-enter', command(client));
  await until(() => !!client.world && client.profile?.character.activity === 'overworld', 'enter shared world');
  assert(client.world); return client.world;
}
function input(client: Joined, direction: WorldInput['direction'], run = false): WorldInput {
  assert(client.world);
  client.sequence = Math.max(client.sequence, client.world.lastInputSequence) + 1;
  return { sequence: client.sequence, connectionGeneration: client.world.connectionGeneration, zoneGeneration: client.world.zoneGeneration, direction, run };
}
async function step(client: Joined, direction: WorldInput['direction'], run = false, destinationMap?: string) {
  let packet = input(client, direction, run); const start = client.history.length;
  let errorIndex = client.errors.length;
  client.room.send('world-input', packet);
  const deadline = Date.now() + 5000;
  while (true) {
    const nextErrors = client.errors.slice(errorIndex); errorIndex = client.errors.length;
    for (const detail of nextErrors) {
      assert.equal(detail.code, 'BUSY', `Unexpected movement error: ${detail.code}`);
      if (client.world!.lastInputSequence < packet.sequence) {
        // A room heartbeat can apply bounded backpressure before the input queue; retry with a fresh monotonic sequence.
        await delay(40); packet = input(client, direction, run); client.room.send('world-input', packet);
      }
    }
    if (client.world && client.world.lastInputSequence >= packet.sequence && !client.world.self.motion && (!destinationMap || client.world.self.mapId === destinationMap)) break;
    assert(Date.now() < deadline, `Finish ${direction} ${packet.sequence}: ${JSON.stringify(client.world)}`);
    await delay(20);
  }
  return client.history.slice(start).find(state => state.self.motion)?.self.motion;
}
async function walk(client: Joined, direction: WorldInput['direction'], count: number, run = false) {
  for (let index = 0; index < count; index++) await step(client, direction, run);
}
function position(client: Joined, mapId: string, x: number, y: number) {
  assert(client.world); assert.deepEqual({ mapId: client.world.self.mapId, x: client.world.self.x, y: client.world.self.y }, { mapId, x, y });
}
async function error(client: Joined, type: string, body: unknown) {
  const pending = message(client.room, 'error'); client.room.send(type, body); return characterErrorSchema.parse(await pending);
}
async function leave(client: Joined) {
  const pending = message(client.room, 'world-left'); client.room.send('world-leave', command(client));
  return worldLeftSchema.parse(await pending);
}
async function save(client: Joined) {
  const pending = message(client.room, 'saved');
  client.room.send('save', { ...command(client), type: 'save-profile', version: 1, payload: {} });
  const saved = profileSavedSchema.parse(await pending);
  if (client.profile) client.profile.character = saved.character;
  return saved;
}
async function checkpoint(characterId: string) {
  return (await database.pool.query('SELECT map_id,position_x,position_y,activity,transition_generation,revision FROM characters WHERE id=$1', [characterId])).rows[0];
}
async function closeRooms() {
  await Promise.allSettled(rooms.filter(room => room.connection?.isOpen).map(room => room.leave())); rooms.length = 0;
}

try {
  await backend.start();
  const alice = await trainer('LEAF'), bob = await trainer('RED'), ordinary = await trainer('BLUE', false);
  const staged = await join(ordinary.cookie, ordinary.character.id);
  assert.equal((await error(staged, 'world-enter', command(staged))).code, 'NOT_READY');
  assert.equal(staged.world, undefined); await staged.room.leave();
  checks.push('ordinary-staged-trainer-cannot-enter-development-world');
  let a = await join(alice.cookie, alice.character.id);
  const b = await join(bob.cookie, bob.character.id);
  await enter(a); await enter(b);
  await until(() => a.world!.nearby.some(avatar => avatar.id === bob.character.id) && b.world!.nearby.some(avatar => avatar.id === alice.character.id), 'two authenticated accounts see each other');
  for (const state of [a.world!, b.world!]) {
    for (const avatar of [state.self, ...state.nearby]) assert.deepEqual(Object.keys(avatar).sort(), ['direction', 'elevation', 'id', 'mapId', 'motion', 'name', 'x', 'y']);
    assert(!/party|inventory|story|session|cookie|token|password|lease|account|iv_hp|personality|rng/i.test(JSON.stringify(state)));
  }
  position(a, PALLET, 10, 12); position(b, PALLET, 10, 12);
  checks.push('two-real-account-public-avatar-whitelist', 'same-tile-players-are-nonblocking');
  const walking = await step(a, 'west'); position(a, PALLET, 9, 12);
  assert(walking); assert.equal(walking.movementMode, 'walk'); assert(Math.abs(walking.durationMs - 16 * 1000 / 60) < 1);
  await step(a, 'north'); position(a, PALLET, 9, 12); // Source sign/wall at 9,11.
  await step(b, 'west'); position(b, PALLET, 9, 12);
  const running = await step(a, 'east', true); position(a, PALLET, 10, 12);
  assert(running); assert.equal(running.movementMode, 'run'); assert(Math.abs(running.durationMs - 8 * 1000 / 60) < 1);
  checks.push('source-collision-and-walk-default-shift-running-timing');

  assert.equal((await error(a, 'world-input', { ...input(a, 'east'), x: 999, y: 999 })).code, 'INVALID_MESSAGE');
  a.sequence = a.world!.lastInputSequence; // Rejected malformed envelopes never consume a server input sequence.
  position(a, PALLET, 10, 12);
  const speedPacket = input(a, 'east'); a.room.send('world-input', speedPacket);
  const early = await error(a, 'world-input', input(a, 'east'));
  assert.equal(early.code, 'BUSY');
  await until(() => a.world?.self.x === 11 && !a.world.self.motion, 'one bounded step after rapid input');
  await delay(350); position(a, PALLET, 11, 12);
  a.room.send('world-input', speedPacket); await delay(350);
  position(a, PALLET, 11, 12);
  checks.push('injected-coordinates-rejected', 'fast-input-does-not-queue-or-speed-up', 'duplicate-sequence-cannot-repeat-movement');

  await step(a, 'west'); position(a, PALLET, 10, 12); // A rejected early packet must not strand the next sequence.
  await walk(a, 'north', 4); await walk(a, 'west', 4); position(a, PALLET, 6, 8);
  const oldZone = a.world!.zoneGeneration;
  await step(a, 'north', false, HOUSE); position(a, HOUSE, 4, 8);
  assert(a.world!.zoneGeneration > oldZone);
  await until(() => !b.world!.nearby.some(avatar => avatar.id === alice.character.id), 'source transfer removes old-zone membership');
  const oldPacket = { ...input(a, 'south'), zoneGeneration: oldZone };
  assert(['INVALID_MESSAGE', 'RECONNECT_REQUIRED'].includes((await error(a, 'world-input', oldPacket)).code));
  position(a, HOUSE, 4, 8);
  await delay(150);
  if (!a.room.connection.isOpen) { a = await join(alice.cookie, alice.character.id); await enter(a); }
  else a.sequence = a.world!.lastInputSequence;
  const indoor = await step(a, 'north', true); position(a, HOUSE, 4, 7);
  assert(indoor); assert.equal(indoor.movementMode, 'walk'); assert(Math.abs(indoor.durationMs - 16 * 1000 / 60) < 1);
  await save(a); const homeSave = await checkpoint(alice.character.id);
  assert.equal(homeSave.map_id, HOUSE); assert.equal(homeSave.position_x, 4); assert.equal(homeSave.position_y, 7);
  checks.push('source-door-arrow-warp-and-zone-membership', 'old-zone-input-rejected-after-transfer', 'indoor-running-disallowed', 'save-captures-authoritative-world-position');

  await step(a, 'south'); await step(a, 'south', false, PALLET); position(a, PALLET, 6, 8);
  await walk(a, 'east', 6, true); await walk(a, 'north', 8, true); position(a, PALLET, 12, 0);
  await step(a, 'north', false, ROUTE); position(a, ROUTE, 12, 39);
  await walk(a, 'north', 7, true); position(a, ROUTE, 12, 32);
  await step(a, 'north'); position(a, ROUTE, 12, 32);
  await walk(a, 'west', 6, true); await walk(a, 'north', 2, true); await walk(a, 'east', 6, true); position(a, ROUTE, 12, 30);
  const jump = await step(a, 'south'); position(a, ROUTE, 12, 32);
  assert(jump); assert.equal(jump.kind, 'jump'); assert(Math.abs(jump.durationMs - 32 * 1000 / 60) < 1);
  await step(a, 'north'); position(a, ROUTE, 12, 32);
  checks.push('source-pallet-route-boundary', 'source-one-way-ledge-and-two-tile-jump');

  const left = await leave(a); assert.equal(left.character.activity, 'recovering');
  const routeSave = await checkpoint(alice.character.id); assert.equal(routeSave.map_id, ROUTE); assert.equal(routeSave.position_y, 32);
  await a.room.leave();
  const recovered = await join(alice.cookie, alice.character.id); await enter(recovered); position(recovered, ROUTE, 12, 32);
  checks.push('leave-and-reconnect-restore-committed-checkpoint');
  let replacedCode: number | undefined; recovered.room.onLeave(code => { replacedCode = code; });
  const replacement = await join(alice.cookie, alice.character.id);
  await until(() => replacedCode !== undefined, 'old world socket closes after replacement'); assert.notEqual(replacedCode, 1000);
  await enter(replacement); position(replacement, ROUTE, 12, 32);
  assert(replacement.world!.connectionGeneration > recovered.world!.connectionGeneration);
  recovered.room.send('world-input', input(recovered, 'west'));
  await delay(350); position(replacement, ROUTE, 12, 32);
  checks.push('replacement-session-fences-stale-world-socket');

  await leave(b); await b.room.leave();
  const content = await WorldContent.load();
  content.validateLocation({ mapId: PALLET, x: 12, y: 17, elevation: 3 });
  // Offline fixture setup uses a validated source tile, never a public teleport.
  await database.pool.query("UPDATE characters SET map_id=$2,position_x=12,position_y=17,position_elevation=3,position_facing='east' WHERE id=$1", [bob.character.id, PALLET]);
  const npc = await join(bob.cookie, bob.character.id); await enter(npc); await step(npc, 'east'); position(npc, PALLET, 12, 17);
  checks.push('visible-source-npc-occupancy-blocks-authoritative-step');
  assert.equal((await api('/api/auth/sign-out', bob.cookie, {})).response.status, 200);
  assert.equal((await error(npc, 'world-input', input(npc, 'west'))).code, 'AUTH_REQUIRED');
  checks.push('revoked-session-cannot-send-world-input');
  await save(replacement);
  await closeRooms(); await backend.stop();
  await backend.start(); assert.notEqual(backend.pids[0], backend.pids[1]);
  const afterRestart = await join(alice.cookie, alice.character.id); await enter(afterRestart); position(afterRestart, ROUTE, 12, 32);
  const fresh = await checkpoint(alice.character.id); assert.equal(fresh.map_id, ROUTE); assert.equal(fresh.position_y, 32);
  checks.push('fresh-os-process-restores-authenticated-world-checkpoint');
  await closeRooms(); await backend.stop();
  await writeFile('reports/world-network.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), checks, backendPids: backend.pids,
    scope: 'Real PostgreSQL, real cookie sessions and Colyseus, explicit development accounts only. World interaction is exploration; no battle or story mechanics.' }, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'world_network_passed', checks }));
} finally {
  try { await closeRooms(); await backend.stop(); }
  finally { try { await removeAccountFixturesByEmails(database, ownedEmails); } finally { await database.close(); } }
}
