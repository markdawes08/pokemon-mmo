import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { Client, type Room } from '@colyseus/sdk';
import { createDatabase } from '@pokewaterblue/database';
import {
  CHARACTER_ROOM, PROTOCOL_VERSION, accountViewSchema, characterViewSchema,
  characterSnapshotSchema, characterTicketSchema, characterErrorSchema, profileSavedSchema,
  type CharacterSnapshot, type SaveProfileCommand,
} from '@pokewaterblue/protocol';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../../../tests/integration/account-fixtures.js';
import { parseServerEnv } from './env.js';
import { createGameServer } from './server.js';

const databaseUrl = accountTestDatabaseUrl();
await migrateAccountTestDatabase(databaseUrl);
const cleanupDatabase = createDatabase(databaseUrl);
const ownedEmails: string[] = [];
const assertions: string[] = [];
const rooms: Room[] = [];
let clockOffset = 0;
const environment = parseServerEnv({ ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
let server = await createGameServer(environment, { now: () => Date.now() + clockOffset });
let origin = '';

async function listen() {
  await server.listen(0);
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
}
async function api(path: string, cookie = '', body?: unknown, requestOrigin = origin) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() as unknown };
}
function sessionCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find(value => value.startsWith('pokewaterblue.session_token='));
  assert(cookie, 'Better Auth must set its real session cookie');
  assert.match(cookie, /httponly/i); assert.match(cookie, /samesite=lax/i);
  return cookie.split(';')[0]!;
}
async function signup() {
  const credentials = accountFixture();
  ownedEmails.push(credentials.email);
  const result = await api('/api/auth/sign-up/email', '', credentials);
  assert.equal(result.response.status, 200, `Real sign-up failed: ${JSON.stringify(result.data)}`);
  assert.deepEqual(result.data, { ok: true }, 'Auth JSON must not return credentials or session tokens');
  const cookie = sessionCookie(result.response);
  const account = await api('/api/account', cookie);
  assert.equal(account.response.status, 200);
  const view = accountViewSchema.parse(account.data);
  assert.equal(view.user.email, credentials.email); assert.equal(view.character, null);
  return { credentials, cookie, id: view.user.id };
}
async function ticket(cookie: string, characterId: string) {
  const result = await api(`/api/characters/${characterId}/ticket`, cookie, {});
  assert.equal(result.response.status, 200);
  return characterTicketSchema.parse(result.data);
}
function sdk(cookie = '', requestOrigin = origin) {
  return new Client(`${origin}/socket`, { headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) } });
}
function message(room: Room, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { remove(); reject(new Error(`Timed out waiting for ${type}`)); }, 5000);
    const remove = room.onMessage(type, (value: unknown) => { clearTimeout(timeout); remove(); resolve(value); });
  });
}
function leaveMessage(room: Room): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for replaced/revoked connection to close')), 5000);
    room.onLeave(code => { clearTimeout(timeout); resolve(code); });
  });
}
async function snapshot(room: Room) {
  const pending = message(room, 'snapshot'); room.send('hello', { protocolVersion: PROTOCOL_VERSION });
  return characterSnapshotSchema.parse(await pending);
}
async function join(cookie: string, characterId: string) {
  const admission = await ticket(cookie, characterId);
  const room = await sdk(cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: admission.ticket });
  rooms.push(room);
  // Register handlers before requesting projections. No private schema state is broadcast.
  room.onMessage('error', () => {}); room.onMessage('snapshot', () => {});
  return { room, snapshot: await snapshot(room) };
}
function saveCommand(state: CharacterSnapshot): SaveProfileCommand {
  return { commandId: randomUUID(), type: 'save-profile', version: 1, activityId: state.character.activityId, expectedRevision: state.character.revision, payload: {} };
}
async function save(room: Room, command: SaveProfileCommand) {
  const pending = message(room, 'saved'); room.send('save', command);
  return profileSavedSchema.parse(await pending);
}
async function error(room: Room, type: string, value: unknown) {
  const pending = message(room, 'error'); room.send(type, value);
  return characterErrorSchema.parse(await pending);
}
async function closeRooms() {
  // SDK 0.18 leave() awaits a new onLeave event even when the socket already
  // closed; replacements and revoked sessions must not make cleanup hang.
  await Promise.allSettled(rooms.filter(room => room.connection?.isOpen).map(room => room.leave()));
  rooms.length = 0;
}
async function rejectedUpgrade(requestOrigin: string) {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${origin}/socket/invalid/invalid?sessionId=invalid`, {
      headers: { Origin: requestOrigin, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    });
    request.setTimeout(3000, () => request.destroy(new Error('WebSocket origin guard timed out')));
    request.once('response', response => { response.resume(); resolve(response.statusCode ?? 0); });
    request.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Untrusted WebSocket origin was accepted')); });
    request.once('error', reject); request.end();
  });
}

try {
  await listen();
  assert.equal((await api('/api/account')).response.status, 401);
  assert.equal((await api('/api/characters', '', { commandId: randomUUID(), name: 'RED' })).response.status, 401);
  assert.equal((await api(`/api/characters/${randomUUID()}/ticket`, '', {})).response.status, 401);
  assert.equal((await api('/api/auth/get-session')).response.status, 404);
  assert.equal((await api('/api/auth/request-password-reset', '', {})).response.status, 404);
  assert.equal((await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await api('/api/auth/sign-up/email', '', { name: 'QA', email: 'oversize@example.test', password: 'x'.repeat(9000) })).response.status, 413);
  assertions.push('anonymous-account-character-ticket-rejected');
  for (const badOrigin of ['https://untrusted.example', 'http://127.0.0.1:1']) {
    assert.equal((await api('/api/auth/sign-in/email', '', { email: 'nobody@example.test', password: 'invalid-password' }, badOrigin)).response.status, 403);
    assert.equal(await rejectedUpgrade(badOrigin), 401);
  }
  assertions.push('exact-http-and-websocket-origin-guards');

  const alice = await signup(); const bob = await signup();
  assert.notEqual(alice.id, bob.id); assert.notEqual(alice.cookie, bob.cookie);
  assertions.push('two-real-better-auth-cookie-sessions');
  for (const name of ['', 'TOOLONGXX', 'RED1', '<RED>', 'É']) {
    assert.equal((await api('/api/characters', alice.cookie, { commandId: randomUUID(), name })).response.status, 400);
  }
  const createId = randomUUID();
  const created = await api('/api/characters', alice.cookie, { commandId: createId, name: 'red' });
  assert.equal(created.response.status, 200);
  const aliceCharacter = characterViewSchema.parse((created.data as { character: unknown }).character);
  assert.equal(aliceCharacter.name, 'RED'); assert.equal(aliceCharacter.revision, 0); assert.equal(aliceCharacter.savedAt, null);
  const retryCreated = await api('/api/characters', alice.cookie, { commandId: createId, name: 'red' });
  assert.deepEqual(retryCreated.data, created.data);
  assert.equal((await api('/api/characters', alice.cookie, { commandId: createId, name: 'LEAF' })).response.status, 409);
  assert.equal((await api('/api/characters', alice.cookie, { commandId: randomUUID(), name: 'LEAF' })).response.status, 409);
  const secondCreated = await api('/api/characters', bob.cookie, { commandId: randomUUID(), name: 'BLUE' });
  assert.equal(secondCreated.response.status, 200);
  const bobCharacter = characterViewSchema.parse((secondCreated.data as { character: unknown }).character);
  const bobAccount = accountViewSchema.parse((await api('/api/account', bob.cookie)).data);
  assert.equal(bobAccount.character?.id, bobCharacter.id);
  assert(!JSON.stringify(bobAccount).includes(aliceCharacter.id));
  assertions.push('server-name-validation-and-one-character-per-account', 'idempotent-creation-and-changed-payload-conflict', 'two-account-profile-isolation');

  assert.equal((await api(`/api/characters/${aliceCharacter.id}/ticket`, bob.cookie, {})).response.status, 404);
  const stolen = await ticket(alice.cookie, aliceCharacter.id);
  for (const wrongCookie of ['', bob.cookie]) {
    await assert.rejects(sdk(wrongCookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: stolen.ticket }), /AUTH_REQUIRED|TICKET_INVALID/);
  }
  const ownerRoom = await sdk(alice.cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: stolen.ticket }); rooms.push(ownerRoom);
  ownerRoom.onMessage('error', () => {}); ownerRoom.onMessage('snapshot', () => {});
  await assert.rejects(sdk(alice.cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: stolen.ticket }), /TICKET_INVALID/);
  const expired = await ticket(bob.cookie, bobCharacter.id);
  await assert.rejects(sdk(bob.cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION + 1, ticket: expired.ticket }), /PROTOCOL_MISMATCH/);
  clockOffset = 60_000;
  await assert.rejects(sdk(bob.cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: expired.ticket }), /TICKET_INVALID/);
  clockOffset = 0;
  assertions.push('wrong-character-ticket-rejected', 'stolen-ticket-cookie-binding', 'ticket-one-use-and-expiry', 'character-protocol-mismatch-rejected');

  const aliceInitial = await snapshot(ownerRoom);
  const bobSession = await join(bob.cookie, bobCharacter.id);
  assert.equal(aliceInitial.character.id, aliceCharacter.id); assert.equal(bobSession.snapshot.character.id, bobCharacter.id);
  for (const state of [aliceInitial, bobSession.snapshot]) {
    assert.equal(state.character.stage, 'awaiting-new-game'); assert.equal(state.character.activity, 'recovering');
    assert(!/password|token|accountId|ownerId|leaseGeneration|rng|inventory|position|mapId/i.test(JSON.stringify(state)));
  }
  assert(!JSON.stringify(bobSession.snapshot).includes(alice.id));
  assert(!JSON.stringify(bobSession.snapshot).includes(aliceCharacter.id));
  assertions.push('strict-private-room-projections-and-compatibility');
  const command = saveCommand(aliceInitial);
  const saved = await save(ownerRoom, command);
  assert.equal(saved.character.revision, 1); assert.equal(saved.replayed, false); assert(saved.character.savedAt);
  const retried = await save(ownerRoom, command);
  assert.equal(retried.character.revision, 1); assert.equal(retried.replayed, true); assert.deepEqual(retried.character, saved.character);
  assert.equal((await error(ownerRoom, 'save', { ...command, expectedRevision: 1 })).code, 'COMMAND_CONFLICT');
  assert.equal((await error(ownerRoom, 'save', { ...command, commandId: randomUUID() })).code, 'STALE_REVISION');
  assert.equal((await error(ownerRoom, 'save', { ...command, commandId: randomUUID(), expectedRevision: 1, payload: { mapId: 'MAP_ROUTE1', x: 99 } })).code, 'INVALID_MESSAGE');
  assert.equal((await error(ownerRoom, 'move', { x: 99, y: 99 })).code, 'UNSUPPORTED_MESSAGE');
  assert.equal((await snapshot(ownerRoom)).character.revision, 1);
  assert.equal((await snapshot(bobSession.room)).character.revision, 0);
  assertions.push('save-once-same-command-retry', 'changed-payload-and-stale-revision-rejected', 'malformed-and-unsupported-gameplay-rejected');

  const replaced = leaveMessage(ownerRoom);
  const replacement = await join(alice.cookie, aliceCharacter.id);
  assert.notEqual(await replaced, 1000);
  assert(replacement.snapshot.connectionGeneration > aliceInitial.connectionGeneration);
  ownerRoom.send('save', { ...command, commandId: randomUUID(), expectedRevision: 1 });
  assert.equal((await snapshot(replacement.room)).character.revision, 1);
  const reconnectedCommand = saveCommand(replacement.snapshot);
  assert.equal((await save(replacement.room, reconnectedCommand)).character.revision, 2);
  await replacement.room.leave();
  const reconnected = await join(alice.cookie, aliceCharacter.id);
  assert.equal(reconnected.snapshot.character.revision, 2);
  assert.equal((await save(reconnected.room, reconnectedCommand)).replayed, true);
  assertions.push('second-tab-replaces-old-generation-and-cannot-mutate', 'reconnect-restores-profile-and-command-receipt');

  // Expire a real database session; no test-only HTTP identity shortcut is used.
  const pendingExpiredSessionTicket = await ticket(bob.cookie, bobCharacter.id);
  await cleanupDatabase.pool.query("UPDATE auth_session SET expires_at = now() - interval '1 second' WHERE user_id = $1", [bob.id]);
  assert.equal((await api('/api/account', bob.cookie)).response.status, 401);
  await assert.rejects(sdk(bob.cookie).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: pendingExpiredSessionTicket.ticket }), /AUTH_REQUIRED/);
  assert.equal((await error(bobSession.room, 'save', saveCommand(bobSession.snapshot))).code, 'AUTH_REQUIRED');
  const revokedCookie = alice.cookie;
  assert.equal((await api('/api/auth/sign-out', alice.cookie, {})).response.status, 200);
  assert.equal((await api('/api/account', revokedCookie)).response.status, 401);
  assert.equal((await error(reconnected.room, 'save', saveCommand(reconnected.snapshot))).code, 'AUTH_REQUIRED');
  assertions.push('expired-and-revoked-http-and-active-socket-sessions-rejected');
  const signin = await api('/api/auth/sign-in/email', '', { email: alice.credentials.email, password: alice.credentials.password });
  assert.equal(signin.response.status, 200); assert.deepEqual(signin.data, { ok: true }); alice.cookie = sessionCookie(signin.response);

  await closeRooms();
  await server.close();
  server = await createGameServer(environment, { now: () => Date.now() });
  await listen();
  const recoveredAccount = accountViewSchema.parse((await api('/api/account', alice.cookie)).data);
  assert.equal(recoveredAccount.character?.id, aliceCharacter.id); assert.equal(recoveredAccount.character.revision, 2);
  const recovered = await join(alice.cookie, aliceCharacter.id);
  assert.equal((await save(recovered.room, reconnectedCommand)).replayed, true);
  assert.equal((await snapshot(recovered.room)).character.revision, 2);
  const persisted = await cleanupDatabase.pool.query('SELECT map_id, position_x, position_y FROM characters WHERE id=$1', [aliceCharacter.id]);
  assert.deepEqual(persisted.rows[0], { map_id: null, position_x: null, position_y: null });
  assertions.push('server-restart-preserves-session-character-and-receipt', 'local-renderer-position-not-persisted');

  let loginStatus = 0;
  for (let attempt = 0; attempt < 11; attempt++) {
    const rejected = await api('/api/auth/sign-in/email', '', { email: alice.credentials.email, password: 'Wrong-password-1234' });
    loginStatus = rejected.response.status;
    if (loginStatus === 429) break;
    assert.equal(loginStatus, 401);
  }
  assert.equal(loginStatus, 429, 'Repeated invalid logins must reach the configured bounded rate limit');
  assertions.push('login-rate-limit-and-bounded-auth-body');

  await server.database.close();
  assert.equal((await api('/api/health')).response.status, 200);
  assert.equal((await api('/api/ready')).response.status, 503);
  assert.equal((await api(`/api/characters/${aliceCharacter.id}/ticket`, alice.cookie, {})).response.status, 503);
  assert.equal((await error(recovered.room, 'save', saveCommand(recovered.snapshot))).code, 'DATABASE_UNAVAILABLE');
  const persistedRevision = await cleanupDatabase.pool.query<{ revision: string }>('SELECT revision FROM characters WHERE id=$1', [aliceCharacter.id]);
  assert.equal(Number(persistedRevision.rows[0]?.revision), 2);
  assertions.push('database-outage-fails-closed-without-profile-mutation');
  await writeFile('reports/accounts-network.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), database: 'isolated loopback test database', server: 'fresh in-process listener; clean server recreation', scope: 'P04 account and staged trainer profile only', assertions, limitations: ['No authoritative overworld, party, inventory, story, or battle persistence.', 'Commit acknowledgement/publication failures are injected in accounts-store-smoke; separate built-process graceful restart is checked by test:recovery. Machine crash and database failover are untested.'] }, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'accounts_network_smoke_passed', assertions }));
} finally {
  await closeRooms();
  await server.close();
  try { await removeAccountFixturesByEmails(cleanupDatabase, ownedEmails); } finally { await cleanupDatabase.close(); }
}
