import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { characterViewSchema, type WorldLocation } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { WorldTestBackend } from '../integration/world-backend.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';
import { delayWorldFrames, observeWorldRendering, worldRenderSamples } from './world-render-probe.js';
import { armSaveProbe, observeSaveRetries, saveProbe } from './world-save-probe.js';

const backend = new WorldTestBackend();
let database: ReturnType<typeof createDatabase>;
const ownedEmails: string[] = [], results: { title: string; status: string }[] = [];
const PALLET = 'MAP_PALLET_TOWN', HOUSE = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', ROUTE = 'MAP_ROUTE1';
test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('World browser checks require npm.cmd run build.');
  const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test';
  await migrateAccountTestDatabase(url); database = createDatabase(url); await backend.start();
});
test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await backend.stop(); }
  finally { if (database) { try { await removeAccountFixturesByEmails(database, ownedEmails); } finally { await database.close(); } } }
  await writeFile('reports/world-browser.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), backendPids: backend.pids, workerPid: process.pid, gracefulShutdown: true,
    runtime: 'Built client and isolated source backend processes with explicit test PostgreSQL fixtures', results, passed: results.length === 4 && results.every(result => result.status === 'passed') }, null, 2)}\n`);
});
async function trainer(context: BrowserContext, name: string, seeded = true, location?: WorldLocation) {
  const credentials = accountFixture(); ownedEmails.push(credentials.email);
  const signup = await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } }); expect(signup.status()).toBe(200);
  const created = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } }); expect(created.status()).toBe(200);
  const character = characterViewSchema.parse((await created.json()).character);
  if (seeded) await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  if (location) {
    (await WorldContent.load()).validateLocation(location);
    // Explicit offline fixture setup at a source-valid anchor, not a browser teleport.
    await database.pool.query("UPDATE characters SET map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing='south' WHERE id=$1", [character.id, location.mapId, location.x, location.y, location.elevation]);
  }
  return character;
}
async function openAccount(page: Page, navigate = true) {
  if (navigate) { await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); }
  await page.locator('#account-button').click(); await expect(page.locator('#account-dialog')).toBeVisible();
}
async function enter(page: Page) {
  await openAccount(page);
  await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'true');
  await expect(page.locator('#account-dialog')).not.toBeVisible(); await expect(page.locator('#game')).toBeFocused();
}
async function position(page: Page, map: string, x: number, y: number) {
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-map-id', map); await expect(screen).toHaveAttribute('data-tile-x', String(x)); await expect(screen).toHaveAttribute('data-tile-y', String(y));
  await expect(screen).toHaveAttribute('data-server-map-id', map); await expect(screen).toHaveAttribute('data-server-tile-x', String(x)); await expect(screen).toHaveAttribute('data-server-tile-y', String(y));
  await expect(screen).toHaveAttribute('data-moving', 'false'); await expect(screen).toHaveAttribute('data-transitioning', 'false');
}
async function step(page: Page, key: string, run = false) {
  const screen = page.locator('#game'), before = Number(await screen.getAttribute('data-step-serial'));
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.press(key);
  await expect.poll(async () => Number(await screen.getAttribute('data-step-serial'))).toBeGreaterThan(before);
  await expect(screen).toHaveAttribute('data-moving', 'false'); await expect(screen).toHaveAttribute('data-transitioning', 'false');
  if (run) await page.keyboard.up('Shift');
}
async function walk(page: Page, key: string, count: number, run = false) { for (let index = 0; index < count; index++) await step(page, key, run); }
async function savedPosition(characterId: string) { return (await database.pool.query('SELECT map_id,position_x,position_y FROM characters WHERE id=$1', [characterId])).rows[0]; }

test('ordinary trainers retain anonymous preview and cannot enter the seeded shared-world policy', async ({ page, context }) => {
  await trainer(context, 'BLUE', false);
  await openAccount(page);
  await expect(page.locator('#account-world-enter')).not.toBeVisible();
  await page.locator('#account-connect').click();
  await expect(page.locator('#account-world-enter')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  await step(page, 'ArrowLeft');
  await expect(page.locator('#game')).toHaveAttribute('data-tile-x', '9');
});

test('two real accounts see nonblocking avatars, source house transfers, and durable shared checkpoints', async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await delayWorldFrames(page);
  const alice = await trainer(context, 'LEAF');
  const bobContext = await browser.newContext();
  try {
    const bob = await trainer(bobContext, 'RED'); const second = await bobContext.newPage();
    await enter(page); await enter(second);
    await expect(page.locator(`#nearby-players [data-avatar-id="${bob.id}"]`)).toHaveAttribute('data-tile-x', '10');
    await expect(second.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveAttribute('data-tile-x', '10');
    await position(page, PALLET, 10, 12); await position(second, PALLET, 10, 12);
    await page.locator('#game').click(); await step(page, 'ArrowLeft'); await position(page, PALLET, 9, 12);
    await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '16');
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2100); await page.keyboard.up('ArrowUp');
    await position(page, PALLET, 9, 12); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
    await second.locator('#game').click(); await step(second, 'ArrowLeft'); await position(second, PALLET, 9, 12);
    await page.locator('#game').click(); await step(page, 'ArrowRight', true); await position(page, PALLET, 10, 12);
    await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '8');
    await page.screenshot({ path: 'reports/world-two-players.png', fullPage: true });
    await observeWorldRendering(page); await walk(page, 'ArrowUp', 4);
    const rendered = await worldRenderSamples(page);
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered.every(sample => Number.isInteger(sample.x) && Number.isInteger(sample.y))).toBe(true);
    expect(rendered[0]!.y - rendered.at(-1)!.y).toBe(64);
    for (let index = 1; index < rendered.length; index++) expect(rendered[index]!.y).toBeLessThanOrEqual(rendered[index - 1]!.y);
    await writeFile('reports/world-rendering.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Passive Phaser local-player container sampling; unmodified ordered WebSocket frames delayed 0,15,70,25ms', frames: rendered.length, travelPixels: 64, monotonic: true }, null, 2)}\n`);
    await walk(page, 'ArrowLeft', 4); await position(page, PALLET, 6, 8);
    await step(page, 'ArrowUp'); await position(page, HOUSE, 4, 8);
    await expect(second.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveCount(0);
    await expect(page.locator('#game')).toHaveAttribute('data-nearby-count', '0');
    await step(page, 'ArrowUp', true); await position(page, HOUSE, 4, 7);
    await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '16');
    await openAccount(page, false); await page.locator('#account-save').click();
    await expect(page.locator('#account-status')).toContainText('Shared world location checkpointed.');
    expect(await savedPosition(alice.id)).toEqual({ map_id: HOUSE, position_x: 4, position_y: 7 });
    await page.locator('#account-world-leave').click();
    await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
    await page.locator('#account-world-enter').click(); await position(page, HOUSE, 4, 7);
    await page.screenshot({ path: 'reports/world-house.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'reports/world-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const tab = await context.newPage(); await enter(tab); await position(tab, HOUSE, 4, 7);
    await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350);
    await position(tab, HOUSE, 4, 7);
    await tab.close(); expect(errors).toEqual([]);
  } finally { await bobContext.close(); }
});

test('modified map bytes refuse shared entry and leave the scene frozen', async ({ page, context }) => {
  await trainer(context, 'BROCK');
  await page.route('**/content/maps/PalletTown.json', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n ` });
  });
  await openAccount(page);
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'false');
  await expect(page.locator('#account-status')).toContainText('World content differs');
  const frozen = await page.locator('#game').getAttribute('data-tile-y');
  await page.waitForTimeout(1200); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', frozen!);
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
});

test('Route 1 ledges, focus and menus stop input, and a fresh backend recovers the saved position', async ({ page, context }) => {
  test.setTimeout(90_000);
  await observeSaveRetries(page);
  const character = await trainer(context, 'MISTY', true, { mapId: PALLET, x: 12, y: 0, elevation: 3 });
  await enter(page); await position(page, PALLET, 12, 0);
  await openAccount(page, false);
  const receipts = async () => Number((await database.pool.query('SELECT count(*) AS count FROM character_command_receipts WHERE character_id=$1', [character.id])).rows[0].count);
  const beforeSaveReceipts = await receipts();
  await armSaveProbe(page, 'invalid'); await page.locator('#account-save').click();
  await expect(page.locator('#account-status')).toContainText('Invalid profile save command.');
  const rejectedSave = await saveProbe(page);
  expect(rejectedSave.invalidErrors).toBe(1); expect(rejectedSave.frames.length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(450);
  const invalidSave = await saveProbe(page);
  expect(invalidSave.invalidErrors).toBe(1); expect(invalidSave.frames).toHaveLength(rejectedSave.frames.length); expect(await receipts()).toBe(beforeSaveReceipts);
  await armSaveProbe(page, 'busy'); await page.locator('#account-save').click();
  await expect(page.locator('#account-status')).toContainText('checkpointed');
  const retriedSave = await saveProbe(page);
  expect(retriedSave.busyErrors).toBeGreaterThanOrEqual(1); expect(retriedSave.frames.length).toBeGreaterThanOrEqual(2);
  expect(retriedSave.frames.length).toBeLessThanOrEqual(6);
  for (const frame of retriedSave.frames) expect(frame).toEqual(retriedSave.frames[0]);
  expect(await receipts()).toBe(beforeSaveReceipts + 1);
  await writeFile('reports/world-save-retry.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Real authenticated hello immediately precedes Save, producing actual server BUSY; malformed Save gets real INVALID_MESSAGE', busyResponses: retriedSave.busyErrors, identicalSaveAttempts: retriedSave.frames.length, receiptsWritten: 1, invalidSaveAttempts: invalidSave.frames.length, attemptsAfterInvalidResponse: 0, invalidSaveReceipts: 0 }, null, 2)}\n`);
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await step(page, 'ArrowUp'); await position(page, ROUTE, 12, 39);
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2600);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('Shift'); await position(page, ROUTE, 12, 32);
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400); await position(page, ROUTE, 12, 32);
  await walk(page, 'ArrowLeft', 6, true); await walk(page, 'ArrowUp', 2, true); await walk(page, 'ArrowRight', 6, true); await position(page, ROUTE, 12, 30);
  await step(page, 'ArrowDown'); await position(page, ROUTE, 12, 32);
  await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '32');
  await page.screenshot({ path: 'reports/world-route-ledge.png', fullPage: true });
  await page.keyboard.down('ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Field guide', exact: true }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  const menuY = await page.locator('#game').getAttribute('data-tile-y');
  await page.waitForTimeout(550); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', menuY!);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', menuY!); await page.keyboard.up('ArrowDown');
  await page.locator('#game').click(); await page.keyboard.down('ArrowDown');
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Collision overlay', exact: true }).click(); await page.keyboard.up('ArrowDown');
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  const focusY = await page.locator('#game').getAttribute('data-tile-y');
  await page.waitForTimeout(450); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', focusY!);
  await openAccount(page, false); await page.locator('#account-save').click();
  await expect(page.locator('#account-status')).toContainText('checkpointed');
  const committed = await savedPosition(character.id);
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await page.keyboard.down('ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  await backend.stop();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  const frozen = await page.locator('#game').getAttribute('data-tile-y'); await page.waitForTimeout(550);
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', frozen!); await page.keyboard.up('ArrowDown');
  await backend.start(); expect(backend.pids[0]).not.toBe(backend.pids[1]);
  await openAccount(page, false); await page.locator('#account-connect').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  const restored = await savedPosition(character.id);
  expect(restored.map_id).toBe(ROUTE); expect(restored.position_y).toBeGreaterThanOrEqual(committed.position_y);
  await position(page, ROUTE, restored.position_x, restored.position_y);
  const stoppedY = await page.locator('#game').getAttribute('data-tile-y'); await page.waitForTimeout(400);
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', stoppedY!);
  await openAccount(page, false); await armSaveProbe(page, 'stall');
  const stalledSaveStarted = Date.now(); await page.locator('#account-save').click();
  await expect(page.locator('#account-status')).toContainText('Saving trainer');
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected', { timeout: 10_000 });
  await expect(page.locator('#account-connect')).toBeEnabled();
  await expect(page.locator('#account-connect')).toHaveText('Reconnect trainer');
  await expect(page.locator('#account-status')).toHaveText('Shared world connection lost. Reconnect to continue.');
  // Pass the original eight-second Save deadline. Cancelled timers must not
  // replace the loss message or strand the controls after this induced client stall.
  await page.waitForTimeout(Math.max(0, stalledSaveStarted + 8500 - Date.now()));
  await expect(page.locator('#account-status')).toHaveText('Shared world connection lost. Reconnect to continue.');
  await expect(page.locator('#account-connect')).toBeEnabled();
  const stalledSave = await saveProbe(page);
  expect(stalledSave.frames).toHaveLength(1); expect(stalledSave.stalledMessages).toBeGreaterThan(0);
  await writeFile('reports/world-save-watchdog.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Induced client delivery stall with real native socket; this is not server failure evidence', pendingSaveAttempts: 1, discardedSdkMessages: stalledSave.stalledMessages, reconnectEnabled: true, originalSaveDeadlineCancelled: true }, null, 2)}\n`);
});
