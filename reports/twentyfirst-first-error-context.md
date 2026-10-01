# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: world.spec.ts >> Route 1 ledges, focus and menus stop input, and a fresh backend recovers the saved position
- Location: tests\e2e\world.spec.ts:151:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { randomUUID } from 'node:crypto';
  2   | import { existsSync } from 'node:fs';
  3   | import { writeFile } from 'node:fs/promises';
  4   | import { test, expect, type BrowserContext, type Page } from '@playwright/test';
  5   | import { createDatabase } from '@pokewaterblue/database';
  6   | import { characterViewSchema, type WorldLocation } from '@pokewaterblue/protocol';
  7   | import { AssetService } from '../../apps/server/src/asset-service.js';
  8   | import { WorldContent } from '../../apps/server/src/world-content.js';
  9   | import { WorldTestBackend } from '../integration/world-backend.js';
  10  | import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';
  11  | import { delayWorldFrames, observeWorldRendering, worldRenderSamples } from './world-render-probe.js';
  12  | import { armSaveProbe, observeSaveRetries, saveProbe } from './world-save-probe.js';
  13  | 
  14  | const backend = new WorldTestBackend();
  15  | let database: ReturnType<typeof createDatabase>;
  16  | const ownedEmails: string[] = [], results: { title: string; status: string }[] = [];
  17  | const PALLET = 'MAP_PALLET_TOWN', HOUSE = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', ROUTE = 'MAP_ROUTE1';
  18  | test.beforeAll(async () => {
  19  |   if (!existsSync('apps/client/dist/index.html')) throw new Error('World browser checks require npm.cmd run build.');
  20  |   const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test';
  21  |   await migrateAccountTestDatabase(url); database = createDatabase(url); await backend.start();
  22  | });
  23  | test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
  24  | test.afterAll(async () => {
  25  |   try { await backend.stop(); }
  26  |   finally { if (database) { try { await removeAccountFixturesByEmails(database, ownedEmails); } finally { await database.close(); } } }
  27  |   await writeFile('reports/world-browser.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), backendPids: backend.pids, workerPid: process.pid, gracefulShutdown: true,
  28  |     runtime: 'Built client and isolated source backend processes with explicit test PostgreSQL fixtures', results, passed: results.length === 4 && results.every(result => result.status === 'passed') }, null, 2)}\n`);
  29  | });
  30  | async function trainer(context: BrowserContext, name: string, seeded = true, location?: WorldLocation) {
  31  |   const credentials = accountFixture(); ownedEmails.push(credentials.email);
  32  |   const signup = await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } }); expect(signup.status()).toBe(200);
  33  |   const created = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } }); expect(created.status()).toBe(200);
  34  |   const character = characterViewSchema.parse((await created.json()).character);
  35  |   if (seeded) await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  36  |   if (location) {
  37  |     (await WorldContent.load()).validateLocation(location);
  38  |     // Explicit offline fixture setup at a source-valid anchor, not a browser teleport.
  39  |     await database.pool.query("UPDATE characters SET map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing='south' WHERE id=$1", [character.id, location.mapId, location.x, location.y, location.elevation]);
  40  |   }
  41  |   return character;
  42  | }
  43  | async function openAccount(page: Page, navigate = true) {
  44  |   if (navigate) { await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); }
  45  |   await page.locator('#account-button').click(); await expect(page.locator('#account-dialog')).toBeVisible();
  46  | }
  47  | async function enter(page: Page) {
  48  |   await openAccount(page);
  49  |   await page.locator('#account-world-enter').click();
  50  |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  51  |   await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'true');
  52  |   await expect(page.locator('#account-dialog')).not.toBeVisible(); await expect(page.locator('#game')).toBeFocused();
  53  | }
  54  | async function position(page: Page, map: string, x: number, y: number) {
  55  |   const screen = page.locator('#game');
  56  |   await expect(screen).toHaveAttribute('data-map-id', map); await expect(screen).toHaveAttribute('data-tile-x', String(x)); await expect(screen).toHaveAttribute('data-tile-y', String(y));
  57  |   await expect(screen).toHaveAttribute('data-server-map-id', map); await expect(screen).toHaveAttribute('data-server-tile-x', String(x)); await expect(screen).toHaveAttribute('data-server-tile-y', String(y));
  58  |   await expect(screen).toHaveAttribute('data-moving', 'false'); await expect(screen).toHaveAttribute('data-transitioning', 'false');
  59  | }
  60  | async function step(page: Page, key: string, run = false) {
  61  |   const screen = page.locator('#game'), before = Number(await screen.getAttribute('data-step-serial'));
  62  |   if (run) await page.keyboard.down('Shift');
  63  |   await page.keyboard.press(key);
> 64  |   await expect.poll(async () => Number(await screen.getAttribute('data-step-serial'))).toBeGreaterThan(before);
      |                                                                                        ^ Error: expect(received).toBeGreaterThan(expected)
  65  |   await expect(screen).toHaveAttribute('data-moving', 'false'); await expect(screen).toHaveAttribute('data-transitioning', 'false');
  66  |   if (run) await page.keyboard.up('Shift');
  67  | }
  68  | async function walk(page: Page, key: string, count: number, run = false) { for (let index = 0; index < count; index++) await step(page, key, run); }
  69  | async function savedPosition(characterId: string) { return (await database.pool.query('SELECT map_id,position_x,position_y FROM characters WHERE id=$1', [characterId])).rows[0]; }
  70  | 
  71  | test('ordinary trainers retain anonymous preview and cannot enter the seeded shared-world policy', async ({ page, context }) => {
  72  |   await trainer(context, 'BLUE', false);
  73  |   await openAccount(page);
  74  |   await expect(page.locator('#account-world-enter')).not.toBeVisible();
  75  |   await page.locator('#account-connect').click();
  76  |   await expect(page.locator('#account-world-enter')).not.toBeVisible();
  77  |   await page.getByRole('button', { name: 'Close account', exact: true }).click();
  78  |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  79  |   await step(page, 'ArrowLeft');
  80  |   await expect(page.locator('#game')).toHaveAttribute('data-tile-x', '9');
  81  | });
  82  | 
  83  | test('two real accounts see nonblocking avatars, source house transfers, and durable shared checkpoints', async ({ page, context, browser }) => {
  84  |   test.setTimeout(90_000);
  85  |   const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  86  |   await delayWorldFrames(page);
  87  |   const alice = await trainer(context, 'LEAF');
  88  |   const bobContext = await browser.newContext();
  89  |   try {
  90  |     const bob = await trainer(bobContext, 'RED'); const second = await bobContext.newPage();
  91  |     await enter(page); await enter(second);
  92  |     await expect(page.locator(`#nearby-players [data-avatar-id="${bob.id}"]`)).toHaveAttribute('data-tile-x', '10');
  93  |     await expect(second.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveAttribute('data-tile-x', '10');
  94  |     await position(page, PALLET, 10, 12); await position(second, PALLET, 10, 12);
  95  |     await page.locator('#game').click(); await step(page, 'ArrowLeft'); await position(page, PALLET, 9, 12);
  96  |     await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '16');
  97  |     await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2100); await page.keyboard.up('ArrowUp');
  98  |     await position(page, PALLET, 9, 12); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  99  |     await second.locator('#game').click(); await step(second, 'ArrowLeft'); await position(second, PALLET, 9, 12);
  100 |     await page.locator('#game').click(); await step(page, 'ArrowRight', true); await position(page, PALLET, 10, 12);
  101 |     await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '8');
  102 |     await page.screenshot({ path: 'reports/world-two-players.png', fullPage: true });
  103 |     await observeWorldRendering(page); await walk(page, 'ArrowUp', 4);
  104 |     const rendered = await worldRenderSamples(page);
  105 |     expect(rendered.length).toBeGreaterThan(20);
  106 |     expect(rendered.every(sample => Number.isInteger(sample.x) && Number.isInteger(sample.y))).toBe(true);
  107 |     expect(rendered[0]!.y - rendered.at(-1)!.y).toBe(64);
  108 |     for (let index = 1; index < rendered.length; index++) expect(rendered[index]!.y).toBeLessThanOrEqual(rendered[index - 1]!.y);
  109 |     await writeFile('reports/world-rendering.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Passive Phaser local-player container sampling; unmodified ordered WebSocket frames delayed 0,15,70,25ms', frames: rendered.length, travelPixels: 64, monotonic: true }, null, 2)}\n`);
  110 |     await walk(page, 'ArrowLeft', 4); await position(page, PALLET, 6, 8);
  111 |     await step(page, 'ArrowUp'); await position(page, HOUSE, 4, 8);
  112 |     await expect(second.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveCount(0);
  113 |     await expect(page.locator('#game')).toHaveAttribute('data-nearby-count', '0');
  114 |     await step(page, 'ArrowUp', true); await position(page, HOUSE, 4, 7);
  115 |     await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '16');
  116 |     await openAccount(page, false); await page.locator('#account-save').click();
  117 |     await expect(page.locator('#account-status')).toContainText('Shared world location checkpointed.');
  118 |     expect(await savedPosition(alice.id)).toEqual({ map_id: HOUSE, position_x: 4, position_y: 7 });
  119 |     await page.locator('#account-world-leave').click();
  120 |     await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  121 |     await page.locator('#account-world-enter').click(); await position(page, HOUSE, 4, 7);
  122 |     await page.screenshot({ path: 'reports/world-house.png', fullPage: true });
  123 |     await page.setViewportSize({ width: 390, height: 844 });
  124 |     await page.screenshot({ path: 'reports/world-mobile.png', fullPage: true });
  125 |     await page.setViewportSize({ width: 1280, height: 900 });
  126 |     const tab = await context.newPage(); await enter(tab); await position(tab, HOUSE, 4, 7);
  127 |     await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  128 |     await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350);
  129 |     await position(tab, HOUSE, 4, 7);
  130 |     await tab.close(); expect(errors).toEqual([]);
  131 |   } finally { await bobContext.close(); }
  132 | });
  133 | 
  134 | test('modified map bytes refuse shared entry and leave the scene frozen', async ({ page, context }) => {
  135 |   await trainer(context, 'BROCK');
  136 |   await page.route('**/content/maps/PalletTown.json', async route => {
  137 |     const response = await route.fetch();
  138 |     await route.fulfill({ response, body: `${await response.text()}\n ` });
  139 |   });
  140 |   await openAccount(page);
  141 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  142 |   await page.locator('#account-world-enter').click();
  143 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  144 |   await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'false');
  145 |   await expect(page.locator('#account-status')).toContainText('World content differs');
  146 |   const frozen = await page.locator('#game').getAttribute('data-tile-y');
  147 |   await page.waitForTimeout(1200); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', frozen!);
  148 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  149 | });
  150 | 
  151 | test('Route 1 ledges, focus and menus stop input, and a fresh backend recovers the saved position', async ({ page, context }) => {
  152 |   test.setTimeout(90_000);
  153 |   await observeSaveRetries(page);
  154 |   const character = await trainer(context, 'MISTY', true, { mapId: PALLET, x: 12, y: 0, elevation: 3 });
  155 |   await enter(page); await position(page, PALLET, 12, 0);
  156 |   await openAccount(page, false);
  157 |   const receipts = async () => Number((await database.pool.query('SELECT count(*) AS count FROM character_command_receipts WHERE character_id=$1', [character.id])).rows[0].count);
  158 |   const beforeSaveReceipts = await receipts();
  159 |   await armSaveProbe(page, 'invalid'); await page.locator('#account-save').click();
  160 |   await expect(page.locator('#account-status')).toContainText('Invalid profile save command.');
  161 |   const rejectedSave = await saveProbe(page);
  162 |   expect(rejectedSave.invalidErrors).toBe(1); expect(rejectedSave.frames.length).toBeGreaterThanOrEqual(1);
  163 |   await page.waitForTimeout(450);
  164 |   const invalidSave = await saveProbe(page);
```