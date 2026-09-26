import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { characterViewSchema, trainerAssetsSchema } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';

let backend: ChildProcess | undefined;
let backendExit: Promise<number | null> | undefined;
let backendPid: number | undefined;
let seedDatabase: ReturnType<typeof createDatabase> | undefined;
let origin: string;
let databaseUrl: string;
const ownedEmails: string[] = [];
const results: { title: string; status: string }[] = [];

async function startBackend() {
  backend = spawn(process.execPath, ['--import', 'tsx', 'tests/integration/assets-browser-server.ts'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_ENV: 'test' },
  });
  backend.stdout!.resume(); backend.stderr!.resume();
  const child = backend;
  backendPid = child.pid;
  expect(backendPid).toBeDefined(); expect(backendPid).not.toBe(process.pid);
  backendExit = new Promise(resolve => { child.once('exit', code => resolve(code)); child.once('error', () => resolve(null)); });
  origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { detach(); reject(new Error('Asset browser child did not become ready within 15 seconds.')); }, 15_000);
    const failed = () => { detach(); reject(new Error('Asset browser child exited before readiness.')); };
    const ready = (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'assets-browser-ready' || !('origin' in message) || typeof message.origin !== 'string') return;
      const address = new URL(message.origin);
      if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port) { failed(); return; }
      detach(); resolve(address.origin);
    };
    function detach() { clearTimeout(timeout); child.off('message', ready); child.off('error', failed); child.off('exit', failed); }
    child.on('message', ready); child.once('error', failed); child.once('exit', failed);
  });
}

async function stopBackend() {
  const child = backend;
  if (!child) return;
  if (child.connected) child.send({ type: 'shutdown' }, () => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let exited = false, forced = false;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      void backendExit!.then(value => { exited = true; resolve(value); });
      timeout = setTimeout(() => {
        forced = true; child.kill();
        // Reap the owned child before fixture cleanup, including a forced stop.
        timeout = setTimeout(() => reject(new Error(`Owned asset browser backend PID ${child.pid} did not exit after termination.`)), 2000);
      }, 10_000);
    });
    if (origin) await new Promise<void>((resolve, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(Number(new URL(origin).port), '127.0.0.1', () => probe.close(() => resolve()));
    });
    expect(forced, 'Asset browser backend must shut down gracefully').toBe(false);
    expect(code).toBe(0);
  } finally { clearTimeout(timeout); if (exited) backend = undefined; }
}

test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Asset browser checks require npm.cmd run build before npm.cmd run test:e2e.');
  databaseUrl = accountTestDatabaseUrl();
  process.env['NODE_ENV'] = 'test';
  await migrateAccountTestDatabase(databaseUrl);
  seedDatabase = createDatabase(databaseUrl);
  await startBackend();
});
test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await stopBackend(); }
  finally {
    if (seedDatabase) await seedDatabase.close();
    if (databaseUrl) {
      const database = createDatabase(databaseUrl);
      try { await removeAccountFixturesByEmails(database, ownedEmails); } finally { await database.close(); }
    }
  }
  await writeFile('reports/assets-browser.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), runtime: 'Built client, source backend in a distinct owned OS process and explicit separate test database', backendPid, workerPid: process.pid, gracefulShutdown: true, listenerReleased: true, results, passed: results.length === 3 && results.every(result => result.status === 'passed') }, null, 2)}\n`);
});

async function trainer(context: BrowserContext, seeded = false) {
  const credentials = accountFixture(); ownedEmails.push(credentials.email);
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: origin } });
  expect(signup.status()).toBe(200);
  const created = await context.request.post(`${origin}/api/characters`, { data: { commandId: randomUUID(), name: seeded ? 'LEAF' : 'RED' }, headers: { Origin: origin } });
  expect(created.status()).toBe(200);
  const character = characterViewSchema.parse((await created.json()).character);
  if (seeded) {
    if (!seedDatabase) throw new Error('Asset fixture database was not initialized.');
    await new AssetService(seedDatabase).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  }
  return character;
}
async function openAssets(page: Page) {
  await page.goto(origin);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#account-button').click();
  await expect(page.getByRole('dialog', { name: 'Trainer account' })).toBeVisible();
  await page.locator('#account-assets-details summary').click();
  await expect(page.getByRole('region', { name: 'Saved party and bag' })).toBeVisible();
}
async function assets(context: BrowserContext, characterId: string) {
  const response = await context.request.get(`${origin}/api/characters/${characterId}/assets`);
  expect(response.status()).toBe(200);
  return trainerAssetsSchema.parse(await response.json());
}

test('ordinary staged trainers have empty party and bag without a development grant', async ({ page, context }) => {
  const character = await trainer(context);
  await openAssets(page);
  const panel = page.locator('#account-assets');
  await expect(panel).toContainText('Your party is empty.');
  await expect(panel).toContainText('No items yet.');
  await expect(panel).toContainText('Money 0');
  await expect(panel).not.toContainText('Development fixture');
  const stored = await assets(context, character.id);
  expect(stored.profileId).toBeNull(); expect(stored.party).toEqual([]); expect(stored.inventory).toEqual([]);
  expect(stored.money).toBe(0); expect(stored.location).toBeNull(); expect(stored.developmentFlags).toEqual([]);
  expect(stored.storage).toEqual({ used: 0, capacity: 420 });
  await page.getByRole('button', { name: 'Connect trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Save trainer', exact: true }).click();
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  expect((await assets(context, character.id)).party).toEqual([]);
});

test('the explicit development trainer displays its saved source-backed party and bag on desktop and mobile', async ({ page, context, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const character = await trainer(context, true);
  await openAssets(page);
  const panel = page.locator('#account-assets');
  await expect(panel).toContainText('Development fixture');
  await expect(panel).toContainText('Enter shared exploration through Account. Battles remain unavailable.');
  await expect(panel).toContainText('Party · 1/6');
  await expect(panel).toContainText('SQUIRTLE');
  await expect(panel).toContainText('Lv. 5');
  await expect(panel).toContainText('HP 20/20');
  await expect(panel).toContainText('TACKLE'); await expect(panel).toContainText('35/35 PP');
  await expect(panel).toContainText('TAIL WHIP'); await expect(panel).toContainText('30/30 PP');
  await expect(panel).toContainText('POTION'); await expect(panel).toContainText('POKé BALL');
  await expect(panel).toContainText('Money 3,000');
  const before = await assets(context, character.id);
  expect(before.party).toHaveLength(1); expect(before.inventory.map(item => [item.itemId, item.quantity]).sort((a, b) => a[0] - b[0])).toEqual([[4, 5], [13, 5]]);
  const other = await browser.newContext();
  try {
    expect((await other.request.get(`${origin}/api/characters/${character.id}/assets`)).status()).toBe(401);
    const ordinary = await trainer(other);
    const denied = await other.request.get(`${origin}/api/characters/${character.id}/assets`);
    expect(denied.status()).toBe(404); expect(await denied.text()).not.toContain(before.party[0].id);
    expect((await assets(other, ordinary.id)).party).toEqual([]);
  } finally { await other.close(); }
  await page.getByRole('button', { name: 'Connect trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Save trainer', exact: true }).click();
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', String(before.revision + 1));
  const saved = await assets(context, character.id);
  expect(saved.party).toEqual(before.party); expect(saved.inventory).toEqual(before.inventory);
  expect(saved.location).toEqual(before.location);
  await page.screenshot({ path: 'reports/assets-desktop.png', fullPage: true });
  await panel.screenshot({ path: 'reports/assets-party-bag.png' });
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#account-button').click();
  await page.locator('#account-assets-details summary').click();
  await expect(panel).toContainText('HP 20/20');
  await page.getByRole('button', { name: 'Connect trainer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('#account-dialog').boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'reports/assets-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('unavailable asset storage is shown as a failure and does not invent an empty saved party', async ({ page, context }) => {
  await trainer(context, true);
  await page.route('**/api/characters/*/assets', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Saved assets are unavailable. Try again shortly.' } }) }));
  await page.goto(origin);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#account-button').click();
  await expect(page.locator('#account-status')).toContainText('Saved assets are unavailable.');
  await page.locator('#account-assets-details summary').click();
  await expect(page.locator('#account-assets')).toContainText('have not been loaded');
  await expect(page.locator('#account-assets')).not.toContainText('Your party is empty.');
  await page.unroute('**/api/characters/*/assets');
  await page.getByRole('button', { name: 'Check account again', exact: true }).click();
  await expect(page.locator('#account-assets')).toContainText('HP 20/20');
});
