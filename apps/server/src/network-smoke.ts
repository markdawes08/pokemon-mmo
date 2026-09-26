import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { HANDSHAKE_ROOM, PROTOCOL_VERSION, welcomeSchema, pongSchema, errorSchema } from '@pokewaterblue/protocol';
import { parseServerEnv } from './env.js';
import { createGameServer } from './server.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const testUrl = process.env['TEST_DATABASE_URL'];
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Network smoke requires explicit TEST_DATABASE_URL ending in _test.');
const server = await createGameServer(parseServerEnv({ ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' }));
const rooms: Room[] = [];
function message(room: Room, type: string): Promise<unknown> {
  return new Promise((yes, no) => {
    const timeout = setTimeout(() => { remove(); no(new Error(`Timed out waiting for ${type}`)); }, 3000);
    const remove = room.onMessage(type, (payload: unknown) => { clearTimeout(timeout); remove(); yes(payload); });
  });
}
try {
  await server.listen(0);
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/ready`)).status, 200);
  assert.equal((await fetch(`${origin}/api/health`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const client = new Client(`${origin}/socket`);
  await assert.rejects(client.joinOrCreate(HANDSHAKE_ROOM, { protocolVersion: PROTOCOL_VERSION + 1 }), /PROTOCOL_MISMATCH/);
  const first = await client.joinOrCreate(HANDSHAKE_ROOM, { protocolVersion: PROTOCOL_VERSION }); rooms.push(first);
  const second = await new Client(`${origin}/socket`).joinOrCreate(HANDSHAKE_ROOM, { protocolVersion: PROTOCOL_VERSION }); rooms.push(second);
  assert.notEqual(first.sessionId, second.sessionId);
  for (const room of rooms) {
    const welcome = message(room, 'welcome'); room.send('hello', { protocolVersion: PROTOCOL_VERSION });
    const parsed = welcomeSchema.parse(await welcome);
    assert.equal(parsed.sessionId, room.sessionId);
    const pong = message(room, 'pong'); room.send('ping', { requestId: room.sessionId });
    assert.equal(pongSchema.parse(await pong).requestId, room.sessionId);
  }
  const invalid = message(first, 'error'); first.send('ping', { requestId: 42 });
  assert.equal(errorSchema.parse(await invalid).code, 'INVALID_MESSAGE');
  const unsupported = message(first, 'error'); first.send('move', { x: 999, y: 999 });
  assert.equal(errorSchema.parse(await unsupported).code, 'UNSUPPORTED_MESSAGE');
  // Simulate a lost database pool. Liveness must stay alive while readiness and new admission fail.
  await server.database.close();
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/ready`)).status, 503);
  await assert.rejects(client.joinOrCreate(HANDSHAKE_ROOM, { protocolVersion: PROTOCOL_VERSION }), /NOT_READY/);
  const disconnected = new Promise<number>((yes, no) => {
    const timeout = setTimeout(() => no(new Error('Active room did not close during shutdown')), 3000);
    first.onLeave(code => { clearTimeout(timeout); yes(code); });
  });
  await server.close();
  assert.equal(await disconnected, 4001, 'Server shutdown must close active rooms with SERVER_SHUTDOWN');
  assert.equal(server.httpServer.listening, false);
  rooms.length = 0;
  console.log(JSON.stringify({ event: 'network_smoke_passed', assertions: ['live-ready', 'origin-guard', 'version-rejection', 'two-connections', 'handshake', 'ping-pong', 'malformed-message', 'unsupported-gameplay', 'database-unavailable-admission', 'active-room-graceful-shutdown'] }));
} finally {
  await Promise.allSettled(rooms.map(room => room.leave()));
  await server.close();
}
