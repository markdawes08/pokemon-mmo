# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: practice.spec.ts >> refresh and native lost acknowledgement recover one durable practice action with explicit retry
- Location: tests\e2e\practice.spec.ts:113:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('#practice-dialog')
Expected: "connected"
Received: "disconnected"
Timeout:  10000ms

Call log:
  - Expect "toHaveAttribute" locator('#practice-dialog') with timeout 10000ms
  - waiting for locator('#practice-dialog')
    23 × locator resolved to <dialog open="" data-revision="0" data-phase="setup" id="practice-dialog" class="practice-dialog" aria-labelledby="practice-title" data-connection-state="disconnected">…</dialog>
       - unexpected value "disconnected"

```

```yaml
- dialog "Practice battle":
  - paragraph: Battle studio / Local development
  - heading "Practice battle" [level=2]
  - button "Close practice"
  - paragraph: Build a team, choose an opponent, and try the battle mechanics. Your practice session is saved after each action so you can return later.
  - text: Practice · no rewards
  - status: Connect your trainer to load your saved practice session.
  - button "Connect practice"
```

# Test source

```ts
  1   | import { randomUUID } from 'node:crypto';
  2   | import { existsSync } from 'node:fs';
  3   | import { writeFile } from 'node:fs/promises';
  4   | import { test, expect, type BrowserContext, type Page } from '@playwright/test';
  5   | import { createDatabase } from '@pokewaterblue/database';
  6   | import { characterViewSchema } from '@pokewaterblue/protocol';
  7   | import { AssetService } from '../../apps/server/src/asset-service.js';
  8   | import { WorldTestBackend } from '../integration/world-backend.js';
  9   | import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';
  10  | 
  11  | const backend = new WorldTestBackend();
  12  | let database: ReturnType<typeof createDatabase>;
  13  | const emails: string[] = [], results: { title: string; status: string }[] = [];
  14  | let recoveryEvidence: Record<string, number | boolean> | undefined;
  15  | test.beforeAll(async () => {
  16  |   if (!existsSync('apps/client/dist/index.html')) throw new Error('Practice browser checks require npm.cmd run build and the private practice prerequisites.');
  17  |   const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
  18  |   database = createDatabase(url); await backend.start();
  19  | });
  20  | test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
  21  | test.afterAll(async () => {
  22  |   try { await backend.stop(); }
  23  |   finally { if (database) { try { await removeAccountFixturesByEmails(database, emails); } finally { await database.close(); } } }
  24  |   await writeFile('reports/practice-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: results.length === 4 && results.every(row => row.status === 'passed'),
  25  |     results, backendPids: backend.pids, lifecycle: backend.lifecycleEvents,
  26  |     screenshots: ['reports/practice-desktop.png', 'reports/practice-mobile.png', 'reports/practice-mobile-controls.png'], recoveryEvidence,
  27  |     scope: 'Built browser, independent real backend processes and owned PostgreSQL fixtures. Native acknowledgement loss and explicit same-command retry; no mocked mechanics or main account access.' }, null, 2) + '\n');
  28  | });
  29  | async function trainer(context: BrowserContext, name: string) {
  30  |   const credentials = accountFixture(); emails.push(credentials.email);
  31  |   expect((await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } })).status()).toBe(200);
  32  |   const response = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } }); expect(response.status()).toBe(200);
  33  |   const character = characterViewSchema.parse((await response.json()).character);
  34  |   await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  35  |   return character;
  36  | }
  37  | async function openPractice(page: Page, navigate = true) {
  38  |   if (navigate) { await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); }
  39  |   await page.locator('#practice-button').click(); await expect(page.locator('#practice-dialog')).toBeVisible();
  40  | }
> 41  | async function ready(page: Page) { await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected'); }
      |                                                                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
  42  | async function preset(page: Page, name: string) { await ready(page); await page.getByRole('button', { name, exact: true }).click(); }
  43  | async function start(page: Page) {
  44  |   await page.locator('#practice-start').click(); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'choice');
  45  |   await expect(page.locator('#practice-actions').getByRole('button', { name: 'End practice', exact: true })).toBeEnabled();
  46  | }
  47  | async function action(page: Page, name: string | RegExp) {
  48  |   const revision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  49  |   await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
  50  |   await expect.poll(async () => Number(await page.locator('#practice-dialog').getAttribute('data-revision'))).toBe(revision + 1);
  51  |   await expect(page.locator('#practice-status')).not.toHaveText('Saving your battle action…');
  52  | }
  53  | async function finish(page: Page) {
  54  |   await action(page, /^(End|Finish) practice$/); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'setup');
  55  | }
  56  | async function assets(context: BrowserContext, id: string) {
  57  |   const response = await context.request.get(`${backend.origin}/api/characters/${id}/assets`); expect(response.status()).toBe(200); return response.json();
  58  | }
  59  | 
  60  | test('practice explains sign-in, builds legal teams, and leaves shared exploration before a saved battle', async ({ page, context }) => {
  61  |   test.setTimeout(45_000); await openPractice(page); await expect(page.locator('#practice-status')).toContainText('Sign in');
  62  |   await page.getByRole('button', { name: 'Open Account', exact: true }).click(); await expect(page.locator('#account-dialog')).toBeVisible();
  63  |   const character = await trainer(context, 'BUBBLE'); await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  64  |   const before = await assets(context, character.id);
  65  |   await page.locator('#account-button').click(); await page.locator('#account-world-enter').click();
  66  |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  67  |   await openPractice(page, false); await page.getByRole('button', { name: 'Leave shared world & practice', exact: true }).click();
  68  |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview'); await ready(page);
  69  |   await preset(page, 'Pursuit interception');
  70  |   await expect(page.getByLabel('Party 1 move 1')).not.toContainText('MIRROR');
  71  |   await start(page); const position = await page.locator('#game').getAttribute('data-step-serial');
  72  |   await page.keyboard.press('ArrowUp'); expect(await page.locator('#game').getAttribute('data-step-serial')).toBe(position);
  73  |   await action(page, 'Switch to Pidgeot, party 2');
  74  |   await expect(page.locator('#practice-events')).toContainText('Pursuit intercepted');
  75  |   await expect(page.locator('#practice-party button[data-party-index="1"]')).toHaveAttribute('data-active', 'true');
  76  |   await expect(page.locator('#practice-self-sprite')).toHaveJSProperty('naturalWidth', 64);
  77  |   await expect(page.locator('#practice-opponent-sprite')).toHaveJSProperty('naturalWidth', 64);
  78  |   await page.setViewportSize({ width: 1280, height: 1100 }); await page.locator('#practice-dialog').evaluate(node => { node.scrollTop = 0; });
  79  |   await page.screenshot({ path: 'reports/practice-desktop.png', fullPage: true });
  80  |   await finish(page); const after = await assets(context, character.id);
  81  |   expect(after.party).toEqual(before.party); expect(after.inventory).toEqual(before.inventory); expect(after.money).toBe(before.money);
  82  |   await page.getByRole('button', { name: 'Close practice', exact: true }).click(); await expect(page.locator('#game')).toBeFocused();
  83  | });
  84  | 
  85  | test('source charge locks choices, preserves PP on release, and remains usable on a narrow screen', async ({ page, context }) => {
  86  |   await trainer(context, 'SHELL'); await openPractice(page); await preset(page, 'Protect and Skull Bash'); await start(page);
  87  |   await action(page, /^Skull Bash, /); await expect(page.getByRole('button', { name: 'Release Skull Bash', exact: true })).toBeEnabled();
  88  |   await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
  89  |   await expect(page.getByRole('button', { name: /^Skull Bash, 14 of 15 PP$/ })).toBeDisabled();
  90  |   await page.setViewportSize({ width: 390, height: 844 });
  91  |   await expect.poll(() => page.locator('#practice-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  92  |   await page.screenshot({ path: 'reports/practice-mobile.png', fullPage: true });
  93  |   await page.getByRole('button', { name: 'Release Skull Bash', exact: true }).scrollIntoViewIfNeeded();
  94  |   await page.screenshot({ path: 'reports/practice-mobile-controls.png', fullPage: true });
  95  |   await action(page, 'Release Skull Bash'); await expect(page.getByRole('button', { name: /^Skull Bash, 14 of 15 PP$/ })).toBeEnabled();
  96  |   await finish(page); await preset(page, 'Out of PP'); await start(page);
  97  |   await expect(page.getByRole('button', { name: 'Fight · Struggle', exact: true })).toBeEnabled(); await action(page, 'Fight · Struggle');
  98  |   await expect(page.locator('#practice-events')).toContainText('STRUGGLE'); await finish(page);
  99  | });
  100 | 
  101 | test('faint decisions use the selected reserve and running ends practice without rewards', async ({ page, context }) => {
  102 |   await trainer(context, 'RESERVE'); await openPractice(page); await preset(page, 'Rain and water moves');
  103 |   await page.locator('#practice-add').click(); await page.getByLabel('Party 2 species').selectOption('18'); await page.getByLabel('Party 2 level').fill('100'); await page.getByLabel('Party 2 level').press('Tab');
  104 |   await page.locator('#practice-team .practice-member').first().locator('summary').click();
  105 |   await page.getByLabel('Party 1 status', { exact: true }).selectOption('8'); await page.getByLabel('Party 1 Starting HP %', { exact: true }).fill('1'); await page.getByLabel('Party 1 Starting HP %', { exact: true }).press('Tab');
  106 |   await page.getByLabel('Opponent move 2').selectOption('0'); await start(page);
  107 |   await action(page, /^Rain Dance, /); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'post-faint');
  108 |   await action(page, 'Use next Pokémon'); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'replacement');
  109 |   await action(page, 'Send out Pidgeot, party 2'); await expect(page.locator('#practice-party button[data-party-index="1"]')).toHaveAttribute('data-active', 'true');
  110 |   await action(page, 'Run'); await expect(page.locator('#practice-result')).toContainText('You got away'); await finish(page);
  111 | });
  112 | 
  113 | test('refresh and native lost acknowledgement recover one durable practice action with explicit retry', async ({ page, context }) => {
  114 |   test.setTimeout(65_000); const character = await trainer(context, 'RETURN');
  115 |   await page.addInitScript(() => {
  116 |     const native = WebSocket.prototype.send, descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
  117 |     const state = { arm: false, id: '', dropped: 0, frames: [] as number[][], query: [] as number[], queryBurst: false, uncorrelatedErrors: 0 };
  118 |     (window as unknown as { practiceProbe: typeof state }).practiceProbe = state;
  119 |     WebSocket.prototype.send = function (data) {
  120 |       const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  121 |       const text = bytes ? new TextDecoder().decode(bytes) : '';
  122 |       if (text.includes('practice-query')) state.query = Array.from(bytes!);
  123 |       if (text.includes('practice-command')) {
  124 |         if (state.arm && !state.id) state.id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';
  125 |         if (state.id && text.includes(state.id)) state.frames.push(Array.from(bytes!));
  126 |       }
  127 |       return native.call(this, data);
  128 |     };
  129 |     Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, get: descriptor.get,
  130 |       set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
  131 |         if (!handler) { descriptor.set!.call(this, handler); return; }
  132 |         descriptor.set!.call(this, (event: MessageEvent) => {
  133 |           const text = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
  134 |           if (state.arm && state.id && text.includes(state.id) && text.includes('replayed')) {
  135 |             state.arm = false; state.dropped++; this.close(4010, 'induced practice acknowledgement loss'); return;
  136 |           }
  137 |           if (state.dropped && text.includes('BUSY') && !text.includes(state.id)) state.uncorrelatedErrors++;
  138 |           handler.call(this, event);
  139 |           if (state.dropped && !state.queryBurst && state.query.length && text.includes('catalogue')) {
  140 |             // Overlapping real queries make the room emit an unrelated BUSY.
  141 |             // No response or combat result is fabricated by this probe.
```