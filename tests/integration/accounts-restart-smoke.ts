import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client, type Room } from '@colyseus/sdk';
import { createDatabase } from '@pokewaterblue/database';
import { CHARACTER_ROOM, PROTOCOL_VERSION, accountViewSchema, characterViewSchema, characterTicketSchema,
  characterSnapshotSchema, profileSavedSchema, type SaveProfileCommand } from '@pokewaterblue/protocol';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from './account-fixtures.js';

const databaseUrl = accountTestDatabaseUrl();
await migrateAccountTestDatabase(databaseUrl);
const port = 2570, origin = `http://127.0.0.1:${port}`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const credentials = accountFixture();
let child: ChildProcess | undefined;
let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
const pids: number[] = [];
async function freePort() {
  await new Promise<void>((resolve, reject) => {
    const listener = createServer(); listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => listener.close(() => resolve()));
  });
}
async function start() {
  await freePort(); exited = undefined;
  child = spawn(process.execPath, ['apps/server/dist/index.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: origin, APP_ORIGIN: origin },
  });
  // Drain output without exposing auth response/cookie material on a test failure.
  child.stdout!.resume(); child.stderr!.resume();
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  child.once('exit', (code, signal) => { exited = { code, signal }; });
  assert(child.pid); pids.push(child.pid);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert(!exited, 'Built backend exited before readiness');
    try { if ((await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(700) })).ok) return; } catch { /* listener not ready yet */ }
    await pause(100);
  }
  throw new Error('Built account server did not become ready.');
}
async function stop() {
  const processToStop = child;
  if (!processToStop) return;
  if (processToStop.connected) processToStop.send({ type: 'shutdown' }, () => {});
  const deadline = Date.now() + 10_000;
  while (!exited && Date.now() < deadline) await pause(50);
  if (!exited) { processToStop.kill(); throw new Error('Built account server did not shut down cleanly.'); }
  child = undefined;
  assert.equal(exited.code, 0, 'Built account shutdown failed');
  await freePort();
}
async function api(path: string, cookie = '', body?: unknown) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(8000),
    headers: { Origin: origin, Cookie: cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() as unknown };
}
function message(room: Room, type: string) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => { remove(); reject(new Error(`No ${type} after backend restart`)); }, 5000);
    const remove = room.onMessage(type, (value: unknown) => { clearTimeout(timeout); remove(); resolve(value); });
  });
}
try {
  await start();
  const signedUp = await api('/api/auth/sign-up/email', '', credentials);
  assert.equal(signedUp.response.status, 200); assert.deepEqual(signedUp.data, { ok: true });
  const cookie = signedUp.response.headers.getSetCookie().find(value => value.startsWith('pokewaterblue.session_token='))?.split(';')[0];
  assert(cookie, 'No account cookie');
  const created = await api('/api/characters', cookie, { commandId: randomUUID(), name: 'RED' });
  assert.equal(created.response.status, 200);
  const character = characterViewSchema.parse((created.data as { character: unknown }).character);
  async function join() {
    const admission = await api(`/api/characters/${character.id}/ticket`, cookie, {});
    assert.equal(admission.response.status, 200);
    const ticket = characterTicketSchema.parse(admission.data);
    const room = await new Client(`${origin}/socket`, { headers: { Origin: origin, Cookie: cookie! } })
      .joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: ticket.ticket });
    room.reconnection.enabled = false;
    room.onMessage('error', () => {}); room.onMessage('saved', () => {}); room.onMessage('snapshot', () => {});
    const waiting = message(room, 'snapshot'); room.send('hello', { protocolVersion: PROTOCOL_VERSION });
    return { room, snapshot: characterSnapshotSchema.parse(await waiting) };
  }
  const first = await join();
  const command: SaveProfileCommand = { commandId: randomUUID(), type: 'save-profile', version: 1,
    activityId: character.activityId, expectedRevision: 0, payload: {} };
  const firstSaved = message(first.room, 'saved'); first.room.send('save', command);
  const saved = profileSavedSchema.parse(await firstSaved); assert.equal(saved.character.revision, 1);
  const unused = characterTicketSchema.parse((await api(`/api/characters/${character.id}/ticket`, cookie, {})).data);
  await stop();
  await start();
  assert.notEqual(pids[0], pids[1]);
  const recovered = accountViewSchema.parse((await api('/api/account', cookie)).data);
  assert.deepEqual(recovered.character, saved.character, 'A fresh process must read the same persisted trainer');
  await assert.rejects(new Client(`${origin}/socket`, { headers: { Origin: origin, Cookie: cookie } })
    .joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: unused.ticket }), /TICKET_INVALID/);
  const second = await join();
  assert(second.snapshot.connectionGeneration > first.snapshot.connectionGeneration);
  const retried = message(second.room, 'saved'); second.room.send('save', command);
  assert.deepEqual(profileSavedSchema.parse(await retried), { ...saved, replayed: true });
  assert.deepEqual(accountViewSchema.parse((await api('/api/account', cookie)).data).character, saved.character);
  await stop();
  await writeFile('reports/accounts-restart.json', JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(),
    backendPids: pids, port, checks: ['two-distinct-built-backend-processes', 'real-cookie-session-survives-restart',
      'trainer-identity-revision-and-save-survive', 'old-memory-ticket-rejected', 'connection-generation-increases',
      'same-command-replay-after-restart-applies-once', 'both-graceful-shutdowns-release-listener'],
    scope: 'Real local PostgreSQL and built backend, explicit test accounts; graceful restart, not machine-crash or database failover.' }, null, 2) + '\n');
  console.log('Account recovery passed across two built backend processes; test listener released.');
} finally {
  await stop();
  const database = createDatabase(databaseUrl);
  try { await removeAccountFixturesByEmails(database, [credentials.email]); } finally { await database.close(); }
}
