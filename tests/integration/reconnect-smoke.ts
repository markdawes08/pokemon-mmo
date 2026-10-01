import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { Client, type Room } from '@colyseus/sdk';
import { createDatabase } from '@pokewaterblue/database';
import { CHARACTER_ROOM, PROTOCOL_VERSION, characterViewSchema, characterTicketSchema, characterSnapshotSchema,
  worldSnapshotSchema, characterErrorSchema, type CharacterSnapshot, type WorldSnapshot, type WorldInput } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from './account-fixtures.js';
import { WorldTestBackend } from './world-backend.js';

const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
const database = createDatabase(url), backend = new WorldTestBackend();
const emails: string[] = [], rooms: Room[] = [], checks: string[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await delay(25); }
  throw new Error(`Reconnect assertion timed out: ${label}`);
}
async function api(path: string, cookie = '', body?: unknown) {
  const response = await fetch(backend.origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(8000),
    headers: { Origin: backend.origin, Cookie: cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() as unknown };
}
async function trainer(name: string) {
  const credentials = accountFixture(); emails.push(credentials.email);
  const signup = await api('/api/auth/sign-up/email', '', credentials); assert.equal(signup.response.status, 200);
  const cookie = signup.response.headers.getSetCookie().find(value => value.startsWith('pokewaterblue.session_token='))?.split(';')[0]; assert(cookie);
  const created = await api('/api/characters', cookie, { commandId: randomUUID(), name }); assert.equal(created.response.status, 200);
  const character = characterViewSchema.parse((created.data as { character: unknown }).character);
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  return { character, cookie };
}
type Trainer = Awaited<ReturnType<typeof trainer>>;
async function join(owner: Trainer, automatic = false) {
  const issued = await api(`/api/characters/${owner.character.id}/ticket`, owner.cookie, {}); assert.equal(issued.response.status, 200);
  const room = await new Client(`${backend.origin}/socket`, { headers: { Origin: backend.origin, Cookie: owner.cookie } })
    .joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: characterTicketSchema.parse(issued.data).ticket });
  rooms.push(room);
  Object.assign(room.reconnection, { enabled: automatic, minUptime: 0, maxEnqueuedMessages: 0, minDelay: 1000, maxDelay: 1000, delay: 1000, maxRetries: 5, backoff: () => 1000 });
  const state: { room: Room; profile?: CharacterSnapshot; world?: WorldSnapshot; drops: number; resumed: number; errors: string[]; sequence: number; leaveCode?: number } = { room, drops: 0, resumed: 0, errors: [], sequence: 0 };
  room.onMessage('snapshot', (data: unknown) => { state.profile = characterSnapshotSchema.parse(data); });
  room.onMessage('world', (data: unknown) => { state.world = worldSnapshotSchema.parse(data); });
  room.onMessage('error', (data: unknown) => { state.errors.push(characterErrorSchema.parse(data).code); });
  room.onMessage('saved', () => {}); room.onMessage('world-left', () => {});
  room.onDrop(() => { state.drops++; }); room.onLeave(code => { state.leaveCode = code; });
  room.onReconnect(() => {
    state.resumed++; state.world = undefined; state.profile = undefined; state.sequence = 0;
    // SDK onReconnect fires before its JOIN_ROOM acknowledgement.
    setTimeout(() => room.send('hello', { protocolVersion: PROTOCOL_VERSION }), 0);
  });
  room.send('hello', { protocolVersion: PROTOCOL_VERSION }); await until(() => !!state.profile, 'initial authenticated snapshot');
  return state;
}
type Joined = Awaited<ReturnType<typeof join>>;
async function enter(client: Joined) {
  const profile = client.profile!.character;
  const command = { commandId: randomUUID(), activityId: profile.activityId, expectedRevision: profile.revision };
  let observedErrors = client.errors.length, retries = 0;
  client.room.send('world-enter', command);
  await until(async () => {
    for (const code of client.errors.slice(observedErrors)) {
      observedErrors++;
      assert.equal(code, 'BUSY', `Unexpected world entry rejection: ${code}`);
      assert(retries++ < 5, 'World entry exceeded bounded BUSY retries');
      await delay(150); client.room.send('world-enter', command);
    }
    return !!client.world;
  }, 'initial shared world').catch(error => {
    throw new Error(`Initial shared world failed: errors=${client.errors.join(',')}; leaveCode=${client.leaveCode ?? 'none'}; transportOpen=${client.room.connection.isOpen}; profileRevision=${client.profile?.character.revision}`, { cause: error });
  });
}
function input(client: Joined, direction: WorldInput['direction']): WorldInput {
  return { sequence: ++client.sequence, direction, run: false, connectionGeneration: client.world!.connectionGeneration, zoneGeneration: client.world!.zoneGeneration };
}
function drop(client: Joined) {
  const socket = (client.room.connection.transport as unknown as { ws: { terminate?: () => void; close: (code: number) => void } }).ws;
  if (socket.terminate) socket.terminate(); else socket.close(4010);
}
function reconnectUrl(client: Joined) {
  const target = new URL(client.room.connection.url!);
  target.searchParams.set('reconnectionToken', client.room.reconnectionToken.split(':')[1]!); target.searchParams.set('skipHandshake', 'true');
  return target;
}
async function rejectedUpgrade(target: URL, cookie: string, origin = backend.origin) {
  // Exercise the real upgrade guard without letting a hostile attempt consume a seat.
  const status = await new Promise<number>((resolve, reject) => {
    const httpTarget = new URL(target); httpTarget.protocol = 'http:';
    const request = httpRequest(httpTarget, { headers: { Origin: origin, Cookie: cookie, Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
    request.setTimeout(4000, () => request.destroy(new Error('Reconnect upgrade guard timed out')));
    request.once('response', response => { response.resume(); resolve(response.statusCode ?? 0); });
    request.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Unauthorized reconnect upgrade succeeded')); });
    request.once('error', reject); request.end();
  });
  assert([401, 403, 404, 410].includes(status), `Reconnect upgrade must reject, received ${status}`);
}
async function rejectedManualReconnect(client: Joined, cookie: string, origin = backend.origin, method = 'reconnect') {
  const token = client.room.reconnectionToken.split(':')[1]!;
  const response = await fetch(`${backend.origin}/socket/matchmake/${method}/${client.room.roomId}`, {
    method: 'POST', signal: AbortSignal.timeout(5000), headers: { Origin: origin, Cookie: cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ reconnectionToken: token }),
  });
  const body = await response.text();
  assert([401, 403].includes(response.status), `Manual reconnect must reject before room lookup, received ${response.status}`);
  assert(!body.includes(token)); assert(!body.includes(client.room.sessionId));
}
async function oversizedManualReconnect(client: Joined, cookie: string) {
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${backend.origin}/socket/matchmake/reconnect/${client.room.roomId}`, {
      method: 'POST', headers: { Origin: backend.origin, Cookie: cookie, 'content-type': 'application/json' },
    }, response => { response.resume(); resolve(response.statusCode ?? 0); });
    request.setTimeout(5000, () => request.destroy(new Error('Chunked reconnect body guard timed out'))); request.once('error', reject);
    // No Content-Length: actual streamed bytes must be bounded before matchmaking.
    request.write(JSON.stringify({ reconnectionToken: client.room.reconnectionToken.split(':')[1], padding: 'x'.repeat(9000) })); request.end();
  });
  assert.equal(status, 413);
}
const leaseActive = async (id: string) => (await database.pool.query<{ active: boolean }>('SELECT expires_at>clock_timestamp() AS active FROM character_leases WHERE character_id=$1', [id])).rows[0]?.active === true;
let cleanupFailure: unknown;
async function shutdownRooms() {
  for (const room of rooms) room.reconnection.enabled = false;
  await Promise.allSettled(rooms.filter(room => room.connection.isOpen).map(room => room.leave()));
}

try {
  await backend.start();
  const alice = await trainer('LEAF'), bob = await trainer('RED'), graceOwner = await trainer('BLUE'), revokedOwner = await trainer('MISTY'), expiredOwner = await trainer('BROCK');
  const peer = await join(bob); await enter(peer);
  const grace = await join(graceOwner); await enter(grace);
  const graceUrl = reconnectUrl(grace), graceStarted = Date.now(); drop(grace);
  await until(() => !peer.world!.nearby.some(avatar => avatar.id === graceOwner.character.id), 'grace client hidden');

  const live = await join(alice, true); await enter(live);
  await until(() => peer.world!.nearby.some(avatar => avatar.id === alice.character.id), 'initial peer presence');
  const sessionId = live.room.sessionId, generation = live.world!.connectionGeneration, activityId = live.profile!.character.activityId;
  const original = { x: live.world!.self.x, y: live.world!.self.y }, oldPacket = input(live, 'west'), liveUrl = reconnectUrl(live);
  await rejectedManualReconnect(live, ''); await rejectedManualReconnect(live, bob.cookie); await rejectedManualReconnect(live, alice.cookie, 'https://example.test');
  await rejectedManualReconnect(live, bob.cookie, backend.origin, '%72econnect'); await oversizedManualReconnect(live, alice.cookie);
  await delay(100); assert(live.room.connection.isOpen); assert.equal(live.drops, 0); assert.equal(live.resumed, 0);
  checks.push('manual-reconnect-wrong-cookie-or-origin-cannot-evict-live-owner');
  checks.push('encoded-manual-reconnect-method-and-chunked-body-limit-enforced');
  drop(live); await until(() => live.drops === 1, 'native SDK onDrop');
  await until(() => !peer.world!.nearby.some(avatar => avatar.id === alice.character.id), 'dropped peer hidden');
  live.room.send('world-input', oldPacket); assert.equal(live.room.reconnection.enqueuedMessages.length, 0);
  await rejectedUpgrade(liveUrl, ''); await rejectedUpgrade(liveUrl, bob.cookie); await rejectedUpgrade(liveUrl, alice.cookie, 'https://example.test');
  await rejectedManualReconnect(live, ''); await rejectedManualReconnect(live, bob.cookie); await rejectedManualReconnect(live, alice.cookie, 'https://example.test');
  const manualSeat = await api(`/socket/matchmake/reconnect/${live.room.roomId}`, alice.cookie, { reconnectionToken: live.room.reconnectionToken.split(':')[1] });
  assert.equal(manualSeat.response.status, 200);
  assert.equal((manualSeat.data as { sessionId: string }).sessionId, sessionId);
  await until(() => live.resumed === 1 && !!live.world && !!live.profile, 'same SDK room resumes with fresh authoritative snapshots');
  assert.equal(live.room.sessionId, sessionId); assert(live.world!.connectionGeneration > generation); assert.equal(live.profile!.character.activityId, activityId);
  assert.equal(live.world!.lastInputSequence, 0); assert.deepEqual({ x: live.world!.self.x, y: live.world!.self.y }, original);
  await until(() => peer.world!.nearby.some(avatar => avatar.id === alice.character.id), 'resumed peer visible once');
  assert.equal(peer.world!.nearby.filter(avatar => avatar.id === alice.character.id).length, 1);
  checks.push('native-drop-hides-peer-and-resumes-same-session-with-new-generation', 'offline-input-buffer-empty-and-no-movement-replay', 'missing-cookie-wrong-cookie-and-origin-cannot-steal-reconnect');
  checks.push('manual-reconnect-negatives-preserve-rightful-resume-and-hide-admission-data');
  checks.push('authenticated-manual-seat-lookup-preserves-rightful-auto-resume');
  for (let cycle = 0; cycle < 3; cycle++) {
    await delay(1050); const previousResume = live.resumed, previousGeneration = live.world!.connectionGeneration;
    drop(live);
    await until(() => live.resumed === previousResume + 1 && !!live.world && live.world.connectionGeneration > previousGeneration, 'repeated drop resumes around heartbeat');
    assert.equal(live.room.sessionId, sessionId);
    await delay(150); assert(live.room.connection.isOpen); assert.equal(live.profile!.connectionGeneration, live.world!.connectionGeneration);
  }
  checks.push('repeated-drops-around-heartbeats-retain-one-live-owner');
  live.room.send('world-input', oldPacket); await until(() => live.errors.includes('RECONNECT_REQUIRED'), 'old generation rejected after resume');
  checks.push('old-connection-generation-fenced-after-resume');

  const previous = await join(alice, true);
  assert.equal(previous.profile!.character.activity, 'overworld');
  assert('worldActive' in previous.profile!); assert.equal(previous.profile!.worldActive, false);
  drop(previous); await until(() => previous.resumed === 1 && !!previous.profile, 'profile-only transport resumes');
  assert.equal(previous.profile!.worldActive, false); await delay(250); assert.equal(previous.world, undefined);
  checks.push('profile-only-resume-does-not-reactivate-persisted-overworld');
  await enter(previous); previous.room.reconnection.enabled = false;
  const previousUrl = reconnectUrl(previous); drop(previous); await delay(100);
  const replacement = await join(alice); await enter(replacement); await rejectedUpgrade(previousUrl, alice.cookie);
  assert.equal(peer.world!.nearby.filter(avatar => avatar.id === alice.character.id).length <= 1, true);
  checks.push('fresh-ticket-takeover-cancels-dropped-transport');
  const revoked = await join(revokedOwner); await enter(revoked); const revokedUrl = reconnectUrl(revoked); drop(revoked); await delay(100);
  assert.equal((await api('/api/auth/sign-out', revokedOwner.cookie, {})).response.status, 200); await rejectedUpgrade(revokedUrl, revokedOwner.cookie);
  checks.push('revoked-cookie-cannot-resume-dropped-transport');
  const expired = await join(expiredOwner); await enter(expired); const expiredUrl = reconnectUrl(expired); drop(expired); await delay(100);
  await database.pool.query("UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=(SELECT account_id FROM characters WHERE id=$1)", [expiredOwner.character.id]);
  await rejectedUpgrade(expiredUrl, expiredOwner.cookie); checks.push('expired-auth-session-cannot-resume');
  const consentedUrl = reconnectUrl(replacement); await replacement.room.leave(); await rejectedUpgrade(consentedUrl, alice.cookie);
  checks.push('consented-room-leave-does-not-reserve-reconnect');

  // The production sixty-second grace is measured against real elapsed time.
  // Failed hostile upgrades during this wait must never restart its deadline.
  for (const elapsed of [30_000, 55_000]) {
    await delay(Math.max(0, graceStarted + elapsed - Date.now()));
    assert(await leaseActive(graceOwner.character.id), `Dropped lease remains held at ${elapsed}ms`);
    await rejectedUpgrade(graceUrl, bob.cookie);
    console.log(JSON.stringify({ event: 'reconnect_grace_observed', elapsedMs: Date.now() - graceStarted, leaseHeld: true }));
  }
  await delay(Math.max(0, graceStarted + 60_500 - Date.now()));
  await until(async () => !await leaseActive(graceOwner.character.id), 'real sixty-second expiry releases lease', 5000);
  await rejectedUpgrade(graceUrl, graceOwner.cookie);
  const graceElapsedMs = Date.now() - graceStarted; assert(graceElapsedMs >= 60_000); assert(graceElapsedMs < 66_000);
  checks.push('real-sixty-second-grace-expires-and-failed-attempts-do-not-extend-deadline');
  const admitted = await join(graceOwner); await enter(admitted); assert.notEqual(admitted.room.sessionId, grace.room.sessionId);
  checks.push('expired-grace-requires-fresh-authenticated-admission');
  drop(admitted);
  await until(() => !peer.world!.nearby.some(avatar => avatar.id === graceOwner.character.id), 'shutdown fixture is within active grace');
  await shutdownRooms(); await backend.stop();
  checks.push('shutdown-cancels-active-reconnect-grace-without-forced-termination');
  await writeFile('reports/reconnect-network.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), checks, graceElapsedMs, backendPids: backend.pids,
    scope: 'Real PostgreSQL, cookie sessions, native SDK WebSocket interruption and real elapsed sixty-second policy. Tokens remain only in process memory.' }, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'reconnect_network_passed', checks, graceElapsedMs }));
} catch (error) {
  await writeFile('reports/reconnect-network-failure.json', `${JSON.stringify({ status: 'failed', verifiedAt: new Date().toISOString(), completedChecks: checks,
    message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, backendLifecycle: backend.lifecycleEvents }, null, 2)}\n`);
  throw error;
} finally {
  try { await shutdownRooms(); await backend.stop(); } catch (error) { cleanupFailure = error; }
  try { await removeAccountFixturesByEmails(database, emails); } finally { await database.close(); }
  if (cleanupFailure) {
    await writeFile('reports/reconnect-cleanup-failure.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), message: cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure), backendLifecycle: backend.lifecycleEvents }, null, 2)}\n`);
    console.error(JSON.stringify({ event: 'reconnect_cleanup_failed', message: cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure) }));
  }
}
if (cleanupFailure) throw cleanupFailure;
