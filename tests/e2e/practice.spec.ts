import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { characterViewSchema } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldTestBackend } from '../integration/world-backend.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';

const backend = new WorldTestBackend();
let database: ReturnType<typeof createDatabase>;
const emails: string[] = [], results: { title: string; status: string }[] = [];
let recoveryEvidence: Record<string, number | boolean> | undefined;
test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Practice browser checks require npm.cmd run build and the private practice prerequisites.');
  const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
  database = createDatabase(url); await backend.start();
});
test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await backend.stop(); }
  finally { if (database) { try { await removeAccountFixturesByEmails(database, emails); } finally { await database.close(); } } }
  await writeFile('reports/practice-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: results.length === 4 && results.every(row => row.status === 'passed'),
    results, backendPids: backend.pids, lifecycle: backend.lifecycleEvents,
    screenshots: ['reports/practice-desktop.png', 'reports/practice-mobile.png', 'reports/practice-mobile-controls.png'], recoveryEvidence,
    scope: 'Built browser, independent real backend processes and owned PostgreSQL fixtures. Native acknowledgement loss and explicit same-command retry; no mocked mechanics or main account access.' }, null, 2) + '\n');
});
async function trainer(context: BrowserContext, name: string) {
  const credentials = accountFixture(); emails.push(credentials.email);
  expect((await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } })).status()).toBe(200);
  const response = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } }); expect(response.status()).toBe(200);
  const character = characterViewSchema.parse((await response.json()).character);
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  return character;
}
async function openPractice(page: Page, navigate = true) {
  if (navigate) { await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); }
  await page.locator('#practice-button').click(); await expect(page.locator('#practice-dialog')).toBeVisible();
}
async function ready(page: Page) { await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected'); }
async function preset(page: Page, name: string) { await ready(page); await page.getByRole('button', { name, exact: true }).click(); }
async function start(page: Page) {
  await page.locator('#practice-start').click(); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'choice');
  await expect(page.locator('#practice-actions').getByRole('button', { name: 'End practice', exact: true })).toBeEnabled();
}
async function action(page: Page, name: string | RegExp) {
  const revision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
  await expect.poll(async () => Number(await page.locator('#practice-dialog').getAttribute('data-revision'))).toBe(revision + 1);
  await expect(page.locator('#practice-status')).not.toHaveText('Saving your battle action…');
}
async function finish(page: Page) {
  await action(page, /^(End|Finish) practice$/); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'setup');
}
async function assets(context: BrowserContext, id: string) {
  const response = await context.request.get(`${backend.origin}/api/characters/${id}/assets`); expect(response.status()).toBe(200); return response.json();
}

test('practice explains sign-in, builds legal teams, and leaves shared exploration before a saved battle', async ({ page, context }) => {
  test.setTimeout(45_000); await openPractice(page); await expect(page.locator('#practice-status')).toContainText('Sign in');
  await page.getByRole('button', { name: 'Open Account', exact: true }).click(); await expect(page.locator('#account-dialog')).toBeVisible();
  const character = await trainer(context, 'BUBBLE'); await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const before = await assets(context, character.id);
  await page.locator('#account-button').click(); await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await openPractice(page, false); await page.getByRole('button', { name: 'Leave shared world & practice', exact: true }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview'); await ready(page);
  await preset(page, 'Pursuit interception');
  await expect(page.getByLabel('Party 1 move 1')).not.toContainText('MIRROR');
  await start(page); const position = await page.locator('#game').getAttribute('data-step-serial');
  await page.keyboard.press('ArrowUp'); expect(await page.locator('#game').getAttribute('data-step-serial')).toBe(position);
  await action(page, 'Switch to Pidgeot, party 2');
  await expect(page.locator('#practice-events')).toContainText('Pursuit intercepted');
  await expect(page.locator('#practice-party button[data-party-index="1"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#practice-self-sprite')).toHaveJSProperty('naturalWidth', 64);
  await expect(page.locator('#practice-opponent-sprite')).toHaveJSProperty('naturalWidth', 64);
  await page.setViewportSize({ width: 1280, height: 1100 }); await page.locator('#practice-dialog').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: 'reports/practice-desktop.png', fullPage: true });
  await finish(page); const after = await assets(context, character.id);
  expect(after.party).toEqual(before.party); expect(after.inventory).toEqual(before.inventory); expect(after.money).toBe(before.money);
  await page.getByRole('button', { name: 'Close practice', exact: true }).click(); await expect(page.locator('#game')).toBeFocused();
});

test('source charge locks choices, preserves PP on release, and remains usable on a narrow screen', async ({ page, context }) => {
  await trainer(context, 'SHELL'); await openPractice(page); await preset(page, 'Protect and Skull Bash'); await start(page);
  await action(page, /^Skull Bash, /); await expect(page.getByRole('button', { name: 'Release Skull Bash', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Skull Bash, 14 of 15 PP$/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#practice-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'reports/practice-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Release Skull Bash', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'reports/practice-mobile-controls.png', fullPage: true });
  await action(page, 'Release Skull Bash'); await expect(page.getByRole('button', { name: /^Skull Bash, 14 of 15 PP$/ })).toBeEnabled();
  await finish(page); await preset(page, 'Out of PP'); await start(page);
  await expect(page.getByRole('button', { name: 'Fight · Struggle', exact: true })).toBeEnabled(); await action(page, 'Fight · Struggle');
  await expect(page.locator('#practice-events')).toContainText('STRUGGLE'); await finish(page);
});

test('faint decisions use the selected reserve and running ends practice without rewards', async ({ page, context }) => {
  await trainer(context, 'RESERVE'); await openPractice(page); await preset(page, 'Rain and water moves');
  await page.locator('#practice-add').click(); await page.getByLabel('Party 2 species').selectOption('18'); await page.getByLabel('Party 2 level').fill('100'); await page.getByLabel('Party 2 level').press('Tab');
  await page.locator('#practice-team .practice-member').first().locator('summary').click();
  await page.getByLabel('Party 1 status', { exact: true }).selectOption('8'); await page.getByLabel('Party 1 Starting HP %', { exact: true }).fill('1'); await page.getByLabel('Party 1 Starting HP %', { exact: true }).press('Tab');
  await page.getByLabel('Opponent move 2').selectOption('0'); await start(page);
  await action(page, /^Rain Dance, /); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'post-faint');
  await action(page, 'Use next Pokémon'); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-phase', 'replacement');
  await action(page, 'Send out Pidgeot, party 2'); await expect(page.locator('#practice-party button[data-party-index="1"]')).toHaveAttribute('data-active', 'true');
  await action(page, 'Run'); await expect(page.locator('#practice-result')).toContainText('You got away'); await finish(page);
});

test('refresh and native lost acknowledgement recover one durable practice action with explicit retry', async ({ page, context }) => {
  test.setTimeout(65_000); const character = await trainer(context, 'RETURN');
  await page.addInitScript(() => {
    const native = WebSocket.prototype.send, descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
    const state = { arm: false, id: '', dropped: 0, frames: [] as number[][], query: [] as number[], queryBurst: false, uncorrelatedErrors: 0 };
    (window as unknown as { practiceProbe: typeof state }).practiceProbe = state;
    WebSocket.prototype.send = function (data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      const text = bytes ? new TextDecoder().decode(bytes) : '';
      if (text.includes('practice-query')) state.query = Array.from(bytes!);
      if (text.includes('practice-command')) {
        if (state.arm && !state.id) state.id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';
        if (state.id && text.includes(state.id)) state.frames.push(Array.from(bytes!));
      }
      return native.call(this, data);
    };
    Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, get: descriptor.get,
      set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        if (!handler) { descriptor.set!.call(this, handler); return; }
        descriptor.set!.call(this, (event: MessageEvent) => {
          const text = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
          if (state.arm && state.id && text.includes(state.id) && text.includes('replayed')) {
            state.arm = false; state.dropped++; this.close(4010, 'induced practice acknowledgement loss'); return;
          }
          if (state.dropped && text.includes('BUSY') && !text.includes(state.id)) state.uncorrelatedErrors++;
          handler.call(this, event);
          if (state.dropped && !state.queryBurst && state.query.length && text.includes('catalogue')) {
            // Overlapping real queries make the room emit an unrelated BUSY.
            // No response or combat result is fabricated by this probe.
            state.queryBurst = true;
            native.call(this, Uint8Array.from(state.query)); native.call(this, Uint8Array.from(state.query));
          }
        });
      } });
  });
  await openPractice(page); await preset(page, 'Rain and water moves'); await start(page);
  const initialRevision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  await page.evaluate(() => { (window as unknown as { practiceProbe: { arm: boolean } }).practiceProbe.arm = true; });
  await page.getByRole('button', { name: /^Rain Dance, / }).click();
  await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { practiceProbe: { uncorrelatedErrors: number } }).practiceProbe.uncorrelatedErrors)).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(350);
  await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { practiceProbe: { frames: number[][] } }).practiceProbe.frames.length)).toBe(1);
  await ready(page); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', String(initialRevision + 1));
  const revision = await page.locator('#practice-dialog').getAttribute('data-revision');
  await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toHaveCount(0);
  expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision);
  const probe = await page.evaluate(() => (window as unknown as { practiceProbe: { dropped: number; frames: number[][]; id: string; uncorrelatedErrors: number } }).practiceProbe);
  expect(probe.dropped).toBe(1); expect(probe.frames.length).toBeGreaterThanOrEqual(2);
  for (const frame of probe.frames) expect(frame).toEqual(probe.frames[0]);
  const receipts = await database.pool.query('SELECT count(*) AS count FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [character.id, probe.id]); expect(Number(receipts.rows[0].count)).toBe(1);
  const ownHP = await page.locator('#practice-self-card').getAttribute('data-hp');
  await page.reload(); await openPractice(page, false); await ready(page);
  expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision); expect(await page.locator('#practice-self-card').getAttribute('data-hp')).toBe(ownHP);
  await backend.stop(); await backend.start(); await page.reload(); await openPractice(page, false); await ready(page);
  expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision); await expect(page.locator('#practice-weather')).toContainText('Rain');
  await finish(page);
  recoveryEvidence = { droppedAcknowledgements: probe.dropped, uncorrelatedErrors: probe.uncorrelatedErrors, identicalCommandFrames: probe.frames.length,
    commandReceiptCount: Number(receipts.rows[0].count), noAutomaticCommandReplay: true, refreshRecovered: true, freshBackendRecovered: true };
});
