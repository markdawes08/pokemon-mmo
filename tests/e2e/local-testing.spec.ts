import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, request, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { accountViewSchema, characterViewSchema } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldTestBackend } from '../integration/world-backend.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from '../integration/account-fixtures.js';

const backend = new WorldTestBackend();
const slots = [{ id: 'admin1', name: 'ADMINA', email: 'admin1@pokewaterblue.test' }, { id: 'admin2', name: 'ADMINB', email: 'admin2@pokewaterblue.test' }] as const;
let database: ReturnType<typeof createDatabase>;
const ownedAccountIds: string[] = [], characterIds: string[] = [], results: { title: string; status: string }[] = [];

test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Local testing browser checks require npm.cmd run build.');
  // This rejects the main database before any fixed email is read or written.
  const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test';
  await migrateAccountTestDatabase(url); database = createDatabase(url);
  const existing = await database.pool.query('SELECT 1 FROM auth_user WHERE email=ANY($1::text[])', [slots.map(slot => slot.email)]);
  if (existing.rowCount) throw new Error('Refusing to reuse, reset or remove a preexisting fixed-slot account in the isolated test database.');
  await backend.start();
  for (const slot of slots) {
    const setup = await request.newContext();
    try {
      const credentials = { ...accountFixture(), email: slot.email };
      const signup = await setup.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } });
      expect(signup.status()).toBe(200);
      const identity = await setup.get(`${backend.origin}/api/account`); expect(identity.status()).toBe(200);
      const signed = accountViewSchema.parse(await identity.json());
      expect(signed.user.email).toBe(slot.email); expect(signed.user.id).toBeTruthy(); ownedAccountIds.push(signed.user.id);
      const created = await setup.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name: slot.name }, headers: { Origin: backend.origin } });
      expect(created.status()).toBe(200);
      const character = characterViewSchema.parse((await created.json()).character); characterIds.push(character.id);
      await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
      expect((await setup.post(`${backend.origin}/api/auth/sign-out`, { data: {}, headers: { Origin: backend.origin } })).status()).toBe(200);
    } finally { await setup.dispose(); }
  }
});

test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await backend.stop(); }
  finally { if (database) { try { await removeAccountFixtures(database, ownedAccountIds); } finally { await database.close(); } } }
  await writeFile('reports/local-testing-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: results.length === 2 && results.every(result => result.status === 'passed'),
    results, backendPids: backend.pids, lifecycle: backend.lifecycleEvents,
    screenshots: ['reports/local-testing-desktop.png', 'reports/local-testing-mobile.png'],
    scope: 'Built browser and separate real backend/PostgreSQL test database. Fixed slots are created only when both emails are absent; cleanup uses only auth IDs returned by this run. No main account access, credential file access, password form entry, auth mocking or fixture reset.' }, null, 2) + '\n');
});

async function play(page: Page, name: 'ADMINA' | 'ADMINB') {
  await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#local-testing').getByRole('button', { name: `Play as ${name}`, exact: true }).click();
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await expect(page.locator('#account-button')).toContainText(name);
}
async function account(context: BrowserContext) {
  const response = await context.request.get(`${backend.origin}/api/account`); expect(response.status()).toBe(200); return accountViewSchema.parse(await response.json());
}
async function assets(context: BrowserContext, characterId: string) {
  const response = await context.request.get(`${backend.origin}/api/characters/${characterId}/assets`); expect(response.status()).toBe(200); return response.json();
}
async function enter(page: Page) {
  await page.locator('#account-button').click(); await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'true');
}
async function openPractice(page: Page) {
  await page.locator('#practice-button').click(); await expect(page.locator('#practice-dialog')).toBeVisible();
}
async function startPractice(page: Page) {
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await page.getByRole('button', { name: 'Rain and water moves', exact: true }).click(); await page.locator('#practice-start').click();
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'choice');
}
async function turn(page: Page, label: string | RegExp) {
  const revision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  await page.getByRole('button', { name: label, exact: typeof label === 'string' }).click();
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', String(revision + 1));
}
async function finishPractice(page: Page) {
  await turn(page, /^(End|Finish) practice$/); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'setup');
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
}

test('one click connects both premade testers for shared exploration and isolated practice', async ({ page, context, browser }) => {
  test.setTimeout(60_000);
  expect((await context.request.get(`${backend.origin}/api/account`)).status()).toBe(401);
  const errors: string[] = [], credentialRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/api\/auth\/(sign-in|sign-up)\//.test(request.url())) credentialRequests.push(request.url()); });
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    await play(page, 'ADMINA'); await play(second, 'ADMINB');
    const alice = await account(context), bob = await account(secondContext);
    expect(alice.character?.id).toBe(characterIds[0]); expect(bob.character?.id).toBe(characterIds[1]);
    expect(alice.user.id).not.toBe(bob.user.id);
    const before = await assets(context, alice.character!.id), bobBefore = await assets(secondContext, bob.character!.id);
    await enter(page); await enter(second);
    await expect(page.locator(`#nearby-players [data-avatar-id="${bob.character!.id}"]`)).toBeVisible();
    await expect(second.locator(`#nearby-players [data-avatar-id="${alice.character!.id}"]`)).toBeVisible();
    await page.screenshot({ path: 'reports/local-testing-desktop.png', fullPage: true });
    await openPractice(page); await page.getByRole('button', { name: 'Leave shared world & practice', exact: true }).click();
    await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview'); await startPractice(page);
    await turn(page, /^Rain Dance, /); await expect(page.locator('#practice-weather')).toContainText('Rain');
    await expect(second.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
    await expect(second.locator(`#nearby-players [data-avatar-id="${alice.character!.id}"]`)).toHaveCount(0);
    await finishPractice(page);
    const after = await assets(context, alice.character!.id), bobAfter = await assets(secondContext, bob.character!.id);
    for (const key of ['party', 'inventory', 'money']) { expect(after[key]).toEqual(before[key]); expect(bobAfter[key]).toEqual(bobBefore[key]); }
    expect(credentialRequests).toEqual([]); expect(errors).toEqual([]);
  } finally { await secondContext.close(); }
});

test('remembered tester recovers practice, stays signed out, and safely switches from active exploration', async ({ page, context }) => {
  test.setTimeout(45_000); await page.setViewportSize({ width: 390, height: 844 });
  await play(page, 'ADMINA'); const alice = await account(context);
  await openPractice(page); await startPractice(page); await turn(page, /^Rain Dance, /);
  const revision = await page.locator('#practice-dialog').getAttribute('data-revision');
  const hp = await page.locator('#practice-self-card').getAttribute('data-hp');
  await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await expect(page.locator('#account-button')).toContainText('ADMINA');
  expect((await account(context)).character?.id).toBe(alice.character?.id);
  await openPractice(page); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'choice');
  expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision);
  expect(await page.locator('#practice-self-card').getAttribute('data-hp')).toBe(hp);
  await expect(page.locator('#practice-weather')).toContainText('Rain'); await finishPractice(page);
  const oldCookies = await context.cookies(backend.origin);
  const oldCookieHeader = oldCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  await page.locator('#account-button').click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#account-auth')).toBeVisible(); expect((await context.request.get(`${backend.origin}/api/account`)).status()).toBe(401);
  const oldSession = await request.newContext();
  try { expect((await oldSession.get(`${backend.origin}/api/account`, { headers: { Cookie: oldCookieHeader } })).status()).toBe(401); }
  finally { await oldSession.dispose(); }
  await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'disconnected');
  expect((await context.request.get(`${backend.origin}/api/account`)).status()).toBe(401);
  await expect(page.locator('#local-testing').getByRole('button', { name: 'Play as ADMINA', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'reports/local-testing-mobile.png', fullPage: true });
  await page.locator('#local-testing').getByRole('button', { name: 'Play as ADMINB', exact: true }).click();
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected');
  expect((await account(context)).character?.id).toBe(characterIds[1]);
  await enter(page);
  const game = page.locator('#game'), step = Number(await game.getAttribute('data-step-serial'));
  await game.click(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Number(await game.getAttribute('data-step-serial'))).toBeGreaterThan(step);
  await expect(game).toHaveAttribute('data-moving', 'false');
  const bobLocation = { map_id: await game.getAttribute('data-server-map-id'),
    position_x: Number(await game.getAttribute('data-server-tile-x')), position_y: Number(await game.getAttribute('data-server-tile-y')) };
  const bobCookies = (await context.cookies(backend.origin)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  await page.locator('#local-testing').getByRole('button', { name: 'Play as ADMINA', exact: true }).click();
  await expect(page.locator('#account-button')).toContainText('ADMINA');
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await expect(game).toHaveAttribute('data-world-mode', 'preview');
  expect((await account(context)).character?.id).toBe(alice.character?.id);
  const departed = await database.pool.query('SELECT activity,map_id,position_x,position_y FROM characters WHERE id=$1', [characterIds[1]]);
  expect(departed.rows[0]).toEqual({ activity: 'recovering', ...bobLocation });
  const replacedSession = await request.newContext();
  try { expect((await replacedSession.get(`${backend.origin}/api/account`, { headers: { Cookie: bobCookies } })).status()).toBe(401); }
  finally { await replacedSession.dispose(); }
});
