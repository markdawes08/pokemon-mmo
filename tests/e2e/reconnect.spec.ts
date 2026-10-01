import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { characterViewSchema } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldTestBackend } from '../integration/world-backend.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';
import { interruptCharacter, loseNextSaveAcknowledgement, observeReconnect, reconnectProbe } from './reconnect-probe.js';

const backend = new WorldTestBackend();
let database: ReturnType<typeof createDatabase>;
const emails: string[] = [], results: { title: string; status: string }[] = [];
test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Reconnect browser checks require npm.cmd run build.');
  const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
  database = createDatabase(url); await backend.start();
});
test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await backend.stop(); }
  finally { if (database) { try { await removeAccountFixturesByEmails(database, emails); } finally { await database.close(); } } }
  await writeFile('reports/reconnect-browser.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), passed: results.length === 4 && results.every(result => result.status === 'passed'), results, backendPids: backend.pids,
    scope: 'Built client, isolated native backend processes, test PostgreSQL accounts only. Native transport interruption and bounded test-only constructor failure preserve real cookie/Origin admission.' }, null, 2)}\n`);
});
async function trainer(context: BrowserContext, name: string) {
  const credentials = accountFixture(); emails.push(credentials.email);
  const signup = await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } }); expect(signup.status()).toBe(200);
  const created = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } }); expect(created.status()).toBe(200);
  const character = characterViewSchema.parse((await created.json()).character);
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  return character;
}
async function account(page: Page) { await page.locator('#account-button').click(); await expect(page.locator('#account-dialog')).toBeVisible(); }
async function enter(page: Page, navigate = true) {
  if (navigate) { await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); }
  await account(page); await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'true');
  await expect(page.locator('#account-dialog')).not.toBeVisible();
}
async function position(page: Page) {
  return page.locator('#game').evaluate(element => ({ map: (element as HTMLElement).dataset.serverMapId, x: (element as HTMLElement).dataset.serverTileX, y: (element as HTMLElement).dataset.serverTileY }));
}
async function resume(page: Page) {
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared', { timeout: 12_000 });
  await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'true');
}

test('native transport resumes the same session with a fresh snapshot and no held-input replay', async ({ page, context, browser }) => {
  test.setTimeout(40_000); await observeReconnect(page);
  const alice = await trainer(context, 'LEAF'), other = await browser.newContext();
  try {
    const bob = await trainer(other, 'RED'), peer = await other.newPage(); await enter(page); await enter(peer);
    await expect(peer.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveCount(1);
    await expect(page.locator(`#nearby-players [data-avatar-id="${bob.id}"]`)).toHaveCount(1);
    const generation = Number(await page.locator('#account-trainer').getAttribute('data-connection-generation'));
    await page.locator('#game').click(); await page.keyboard.down('ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
    await interruptCharacter(page, 1500);
    await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'reconnecting');
    await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'false');
    await expect(peer.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveCount(0);
    await resume(page);
    await expect.poll(async () => Number(await page.locator('#account-trainer').getAttribute('data-connection-generation'))).toBeGreaterThan(generation);
    await expect(peer.locator(`#nearby-players [data-avatar-id="${alice.id}"]`)).toHaveCount(1);
    const restored = await position(page), received = await reconnectProbe(page);
    expect(new Set(received.sessionIds).size).toBe(1); expect(received.resumedSockets).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(650); expect(await position(page)).toEqual(restored);
    expect((await reconnectProbe(page)).movementFrames).toBe(received.movementFrames);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.press('ArrowDown'); await expect.poll(async () => (await position(page)).y).not.toBe(restored.y);
    await page.screenshot({ path: 'reports/reconnect-resumed.png', fullPage: true });
  } finally { await other.close(); }
});

test('lost Save acknowledgement is resolved only by explicit identical receipt retry after resume', async ({ page, context }) => {
  test.setTimeout(35_000); await observeReconnect(page); const character = await trainer(context, 'BLUE'); await enter(page);
  await account(page); await loseNextSaveAcknowledgement(page);
  const receipts = async () => Number((await database.pool.query('SELECT count(*) AS count FROM character_command_receipts WHERE character_id=$1', [character.id])).rows[0].count);
  const before = await receipts(); await page.locator('#account-save').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'reconnecting'); await resume(page);
  await expect(page.locator('#account-save')).toHaveText('Retry save'); await expect(page.locator('#account-save')).toBeEnabled();
  const received = await reconnectProbe(page); expect(received.droppedSavedAcks).toBe(1); expect(await receipts()).toBe(before + 1);
  await page.waitForTimeout(450); expect((await reconnectProbe(page)).saveFrames).toHaveLength(received.saveFrames.length);
  await page.locator('#account-save').click(); await expect(page.locator('#account-status')).toContainText('checkpointed');
  const retried = await reconnectProbe(page); expect(retried.saveFrames.length).toBeGreaterThan(received.saveFrames.length);
  for (const frame of retried.saveFrames) expect(frame).toEqual(retried.saveFrames[0]);
  expect(await receipts()).toBe(before + 1);
});

test('explicit Leave cancels scheduled resume and Sign out never reconnects', async ({ page, context }) => {
  await observeReconnect(page); await trainer(context, 'MISTY'); await enter(page);
  await interruptCharacter(page, 1800); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'reconnecting');
  await page.locator('#leave-world').click(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  const cancelled = await reconnectProbe(page); await page.waitForTimeout(2300);
  expect((await reconnectProbe(page)).resumedSockets).toBe(cancelled.resumedSockets);
  expect((await reconnectProbe(page)).blockedAttempts).toBe(cancelled.blockedAttempts);
  // Persisted activity can still say overworld after a dropped visit. A fresh
  // profile-only connection must resume only that profile, without implicit Enter.
  await account(page); await page.locator('#account-connect').click();
  await expect(page.locator('#account-connect')).toHaveText('Trainer connected');
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  const profileOnly = await reconnectProbe(page); await interruptCharacter(page);
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'reconnecting');
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected', { timeout: 12_000 });
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  expect((await reconnectProbe(page)).entryFrames).toBe(profileOnly.entryFrames);
  await enter(page, false); await account(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  await expect(page.locator('#game')).toHaveAttribute('data-world-ready', 'false');
  await expect(page.locator('#account-auth-form')).toBeVisible();
  const signedOut = await reconnectProbe(page), frozen = await position(page);
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1300); expect(await position(page)).toEqual(frozen);
  expect((await reconnectProbe(page)).resumedSockets).toBe(signedOut.resumedSockets);
  await page.locator('#leave-world').click(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
});

test('a lost backend freezes recovery and explicit cancellation permits fresh process admission', async ({ page, context }) => {
  test.setTimeout(40_000); await observeReconnect(page); const character = await trainer(context, 'BROCK'); await enter(page);
  await account(page); await page.locator('#account-save').click(); await expect(page.locator('#account-status')).toContainText('checkpointed');
  await page.getByRole('button', { name: 'Close account', exact: true }).click(); const checkpoint = await position(page);
  await backend.crash(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'reconnecting');
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(2200); expect(await position(page)).toEqual(checkpoint);
  await page.locator('#leave-world').click(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  await backend.start();
  // Process loss cannot release its PostgreSQL lease. Respect its real expiry
  // before authenticating a fresh owner in the new process.
  await expect.poll(async () => (await database.pool.query('SELECT expires_at>clock_timestamp() AS active FROM character_leases WHERE character_id=$1', [character.id])).rows[0]?.active, { timeout: 18_000 }).toBe(false);
  await enter(page, false); expect(await position(page)).toEqual(checkpoint);
  expect(backend.pids[0]).not.toBe(backend.pids[1]);
});
