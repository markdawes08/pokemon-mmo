import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '@pokewaterblue/database';
import { accountViewSchema, characterViewSchema, localTestAccountsSchema } from '@pokewaterblue/protocol';
import { createGameServer } from '../../apps/server/src/server.js';
import { parseServerEnv } from '../../apps/server/src/env.js';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from './account-fixtures.js';

const databaseUrl = accountTestDatabaseUrl();
await migrateAccountTestDatabase(databaseUrl);
const database = createDatabase(databaseUrl), ownedIds: string[] = [], checks: string[] = [];
const environment = parseServerEnv({ ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
let server = await createGameServer(environment), origin = '';
const emails = ['admin1@pokewaterblue.test', 'admin2@pokewaterblue.test'];
async function listen() {
  await server.listen(0);
  const address = server.httpServer.address(); assert(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
}
async function api(path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() as unknown };
}
function requestWithHost(host: string) {
  // Node 24's fetch replaces a caller-supplied Host with the target authority.
  // A raw HTTP request is required to actually exercise the server host guard.
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(origin + '/api/testing/accounts', { headers: { Host: host, Origin: origin } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode!)); response.once('error', reject);
    });
    request.setTimeout(10_000, () => request.destroy(new Error('Host guard request timed out.')));
    request.once('error', reject); request.end();
  });
}
function cookie(response: Response) {
  const value = response.headers.getSetCookie().find(row => row.startsWith('pokewaterblue.session_token='));
  assert(value); assert.match(value, /httponly/i); assert.match(value, /samesite=lax/i); assert.match(value, /path=\//i);
  return value.split(';')[0]!;
}
async function catalogue() {
  const result = await api('/api/testing/accounts'); assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  return localTestAccountsSchema.parse(result.data);
}
async function signup(email: string, name: string) {
  const result = await api('/api/auth/sign-up/email', '', { email, password: `Testing9-${randomUUID()}!`, name: 'Isolated quick testing QA' });
  assert.equal(result.response.status, 200); assert.deepEqual(result.data, { ok: true });
  const session = cookie(result.response), account = await api('/api/account', session);
  const view = accountViewSchema.parse(account.data); ownedIds.push(view.user.id);
  const made = await api('/api/characters', session, { commandId: randomUUID(), name });
  assert.equal(made.response.status, 200);
  const character = characterViewSchema.parse((made.data as { character: unknown }).character);
  return { session, userId: view.user.id, characterId: character.id };
}
async function connect(accountId: string, previous = '') {
  const result = await api('/api/testing/connect', previous, { accountId });
  assert.equal(result.response.status, 200); assert.deepEqual(result.data, { ok: true }, 'No user records, credentials or session tokens in JSON');
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  return cookie(result.response);
}
async function assets(characterIds: string[]) {
  const result = await database.pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM characters c WHERE id=ANY($1::uuid[])) AS characters,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM creatures c WHERE owner_id=ANY($1::uuid[])) AS creatures,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.creature_id,m.slot_index) FROM creature_moves m JOIN creatures c ON c.id=m.creature_id WHERE c.owner_id=ANY($1::uuid[])) AS moves,
    (SELECT jsonb_agg(to_jsonb(i)) FROM character_inventory i WHERE character_id=ANY($1::uuid[])) AS inventory,
    (SELECT jsonb_agg(to_jsonb(w)) FROM character_wallets w WHERE character_id=ANY($1::uuid[])) AS wallets,
    (SELECT jsonb_agg(to_jsonb(p)) FROM character_practice_state p WHERE character_id=ANY($1::uuid[])) AS practice,
    (SELECT jsonb_agg(to_jsonb(p)) FROM practice_command_receipts p WHERE character_id=ANY($1::uuid[])) AS practice_receipts`, [characterIds]);
  return result.rows[0];
}
try {
  const existing = await database.pool.query('SELECT id FROM auth_user WHERE email=ANY($1::text[])', [emails]);
  assert.equal(existing.rowCount, 0, 'The isolated test database already contains reserved testing emails; refusing to touch them.');
  await listen();
  assert.deepEqual(await catalogue(), { enabled: true, accounts: [] });
  assert.equal((await api('/api/testing/connect', '', { accountId: 'admin1' })).response.status, 404);
  checks.push('missing-fixtures-are-never-created-or-seeded-by-quick-access');

  for (const body of [{ accountId: 'ordinary' }, { accountId: emails[0] }, { accountId: 'admin1', userId: 'arbitrary' }, {}, null]) {
    assert.equal((await api('/api/testing/connect', '', body)).response.status, 400);
  }
  const malformed = await fetch(origin + '/api/testing/connect', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); await malformed.text();
  checks.push('strict-public-id-only-body-and-malformed-json-rejection');

  assert.equal((await api('/api/testing/connect', '', { accountId: 'admin1' }, { Origin: 'https://example.test' })).response.status, 403);
  assert.equal((await api('/api/testing/accounts', '', undefined, { Origin: 'null' })).response.status, 403);
  assert.equal(await requestWithHost('evil.example'), 403);
  const noOrigin = await fetch(origin + '/api/testing/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"accountId":"admin1"}' });
  assert.equal(noOrigin.status, 403); await noOrigin.text();
  assert.equal((await api('/api/auth/local-testing-connect', '', { accountId: 'admin1' })).response.status, 404);
  checks.push('cross-origin-null-origin-missing-origin-nonlocal-host-and-direct-auth-path-rejection');

  const a = await signup(emails[0]!, 'ADMINA'), b = await signup(emails[1]!, 'ORDINAR');
  assert.deepEqual((await catalogue()).accounts, []);
  assert.equal((await api('/api/testing/connect', '', { accountId: 'admin1' })).response.status, 404);
  await server.assetService.seedDevelopmentFixture({ characterId: a.characterId, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  await new AssetService(database).seedDevelopmentFixture({ characterId: b.characterId, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  assert.deepEqual((await catalogue()).accounts, [{ id: 'admin1', name: 'ADMINA' }]);
  assert.equal((await api('/api/testing/connect', '', { accountId: 'admin2' })).response.status, 404);
  // Change only this test's owned character to the expected fixture name.
  await database.pool.query('UPDATE characters SET name=$1 WHERE id=$2 AND account_id=$3', ['ADMINB', b.characterId, b.userId]);
  assert.deepEqual(await catalogue(), { enabled: true, accounts: [{ id: 'admin1', name: 'ADMINA' }, { id: 'admin2', name: 'ADMINB' }] });
  checks.push('only-fixed-email-name-and-development-stage-matches-are-selectable');

  const before = await assets([a.characterId, b.characterId]);
  const one = await connect('admin1'), other = await connect('admin1'); assert.notEqual(one, other);
  const first = accountViewSchema.parse((await api('/api/account', one)).data); assert.equal(first.user.id, a.userId);
  const count = await database.pool.query('SELECT count(*)::int AS count FROM auth_session WHERE user_id=$1', [a.userId]);
  const reused = await connect('admin1', one); assert.equal(reused, one);
  assert.deepEqual((await database.pool.query('SELECT count(*)::int AS count FROM auth_session WHERE user_id=$1', [a.userId])).rows, count.rows);
  checks.push('real-httponly-cookie-authenticates-normal-account-api-and-same-account-reuses-session');

  const switched = await connect('admin2', one);
  assert.equal(accountViewSchema.parse((await api('/api/account', switched)).data).user.id, b.userId);
  assert.equal((await api('/api/account', one)).response.status, 401);
  assert.equal((await api('/api/account', other)).response.status, 200);
  assert.equal((await api('/api/account', a.session)).response.status, 200);
  assert.equal((await api('/api/account', b.session)).response.status, 200);
  assert.deepEqual(await assets([a.characterId, b.characterId]), before);
  checks.push('switch-revokes-only-current-browser-session-preserving-other-sessions-and-all-saved-game-state');

  const signedOut = await api('/api/auth/sign-out', switched, {}); assert.equal(signedOut.response.status, 200);
  assert.equal((await api('/api/account', switched)).response.status, 401);
  assert.equal((await api('/api/account', other)).response.status, 200);
  checks.push('ordinary-signout-revokes-quick-session-without-affecting-another-browser');

  await server.close(); server = await createGameServer({ ...environment, NODE_ENV: 'production' }); await listen();
  assert.deepEqual(await catalogue(), { enabled: false, accounts: [] });
  assert.equal((await api('/api/testing/connect', '', { accountId: 'admin1' })).response.status, 404);
  assert.equal((await api('/api/auth/local-testing-connect', '', { accountId: 'admin1' })).response.status, 404);
  checks.push('production-disables-catalogue-and-session-creation-despite-existing-fixtures');

  await writeFile('reports/local-testing-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks,
    scope: 'Real loopback HTTP, Better Auth and PostgreSQL on explicitly separate _test database; only two new isolated fixtures, no existing user trainer or password access.' }, null, 2) + '\n');
  console.log(`Local testing API passed: ${checks.length} groups.`);
} finally {
  await server.close(); await removeAccountFixtures(database, ownedIds); await database.close();
}
