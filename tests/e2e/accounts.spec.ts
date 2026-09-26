import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { accountViewSchema } from '@pokewaterblue/protocol';
import { createGameServer } from '../../apps/server/src/server.js';
import { parseServerEnv } from '../../apps/server/src/env.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';

// Account browser checks always use a fresh loopback server and the explicit test
// database. The ordinary 5173 renderer preview and user accounts are untouched.
let server: Awaited<ReturnType<typeof createGameServer>>;
let origin: string;
let databaseUrl: string;
const ownedEmails: string[] = [];
const results: { title: string; status: string }[] = [];

test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Account browser checks require the built client. Run npm.cmd run build, then npm.cmd run test:e2e.');
  databaseUrl = accountTestDatabaseUrl();
  await migrateAccountTestDatabase(databaseUrl);
  server = await createGameServer(parseServerEnv({ ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', CLIENT_DIST: 'apps/client/dist' }));
  await server.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Account browser test server did not bind a loopback port.');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await server.close();
  if (databaseUrl) {
    const database = createDatabase(databaseUrl);
    try { await removeAccountFixturesByEmails(database, ownedEmails); } finally { await database.close(); }
  }
  await writeFile('reports/accounts-browser.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), runtime: 'Built client served by fresh source backend on random loopback port', database: 'Separate TEST_DATABASE_URL; exact owned fixture emails removed after tests', results, passed: results.length === 3 && results.every(result => result.status === 'passed') }, null, 2)}\n`);
});

test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });

async function openAccount(page: Page) {
  await page.goto(origin);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#account-button').click();
  await expect(page.getByRole('dialog', { name: 'Trainer account' })).toBeVisible();
}

async function signup(page: Page, trainerName: string) {
  const credentials = accountFixture(); ownedEmails.push(credentials.email);
  await openAccount(page);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Create local account', exact: true }).click();
  await expect(page.getByLabel('Trainer name', { exact: true })).toBeVisible();
  await expect(page.locator('#account-email-display')).toHaveText(credentials.email);
  await page.getByLabel('Trainer name', { exact: true }).fill(trainerName);
  await page.getByRole('button', { name: 'Create trainer', exact: true }).click();
  await expect(page.locator('#account-trainer-display')).toHaveText(trainerName.toUpperCase());
  await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '0');
  return credentials;
}

async function account(context: BrowserContext) {
  const response = await context.request.get(`${origin}/api/account`);
  expect(response.status()).toBe(200);
  return accountViewSchema.parse(await response.json());
}

test('real account creation, trainer save and reload preserve profile while map walking remains unsaved', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const credentials = await signup(page, 'red');
  const cookies = await context.cookies(origin);
  const authCookie = cookies.find(cookie => cookie.name === 'pokewaterblue.session_token');
  expect(authCookie?.httpOnly).toBe(true); expect(authCookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('pokewaterblue.session_token');
  await expect(page.locator('#account-dialog')).toContainText('does not save game progress');
  const before = await account(context);
  expect(before.character?.stage).toBe('awaiting-new-game');
  const screen = page.locator('#game');
  const originalY = await screen.getAttribute('data-tile-y');
  await page.keyboard.press('ArrowDown');
  await expect(screen).toHaveAttribute('data-tile-y', originalY!);
  await page.getByRole('button', { name: 'Save trainer', exact: true }).click();
  await expect(page.locator('#account-status')).toContainText('Trainer saved. Map exploration remains unsaved.');
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await expect(screen).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(screen).toHaveAttribute('data-tile-x', '9');
  await page.reload();
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await expect(screen).toHaveAttribute('data-tile-x', '10');
  await page.locator('#account-button').click();
  await expect(page.locator('#account-email-display')).toHaveText(credentials.email);
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  await page.getByRole('button', { name: 'Connect trainer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
  const after = await account(context);
  expect(after.character?.id).toBe(before.character?.id); expect(after.character?.revision).toBe(1);
  expect(after.character?.savedAt).toBeTruthy();
  await page.screenshot({ path: 'reports/accounts-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two real browser accounts are isolated and a second tab replaces the first trainer connection', async ({ browser, page, context }) => {
  await signup(page, 'RED');
  const alice = await account(context);
  const bobContext = await browser.newContext();
  try {
    const bobPage = await bobContext.newPage(); await signup(bobPage, 'BLUE');
    const bob = await account(bobContext);
    expect(bob.user.id).not.toBe(alice.user.id); expect(bob.character?.id).not.toBe(alice.character?.id);
    expect(JSON.stringify(bob)).not.toContain(alice.character!.id);
    const forbidden = await bobContext.request.post(`${origin}/api/characters/${alice.character!.id}/ticket`, { data: {}, headers: { Origin: origin } });
    expect(forbidden.status()).toBe(404);
    const secondTab = await context.newPage();
    await openAccount(secondTab);
    await secondTab.getByRole('button', { name: 'Connect trainer', exact: true }).click();
    await expect(secondTab.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeDisabled();
    await expect(page.locator('#account-status')).toContainText(/replac|disconnect|another/i);
    await secondTab.getByRole('button', { name: 'Save trainer', exact: true }).click();
    await expect(secondTab.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
    expect((await account(bobContext)).character?.revision).toBe(0);
    expect((await account(context)).character?.revision).toBe(1);
    await secondTab.close();
    await page.getByRole('button', { name: 'Reconnect trainer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
    await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  } finally { await bobContext.close(); }
});

test('sign-out revokes the real session and a narrow screen supports sign-in and trainer controls', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const credentials = await signup(page, 'LEAF');
  await page.getByRole('button', { name: 'Save trainer', exact: true }).click();
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  const bounds = await page.locator('#account-dialog').boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#account-auth')).toBeVisible();
  expect((await context.request.get(`${origin}/api/account`)).status()).toBe(401);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill('Wrong-password-1234');
  await page.getByRole('button', { name: 'Sign in to account', exact: true }).click();
  await expect(page.locator('#account-status')).toContainText(/password|invalid|accepted/i);
  await expect(page.locator('#account-auth')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in to account', exact: true }).click();
  await expect(page.locator('#account-trainer-display')).toHaveText('LEAF');
  await expect(page.locator('#account-trainer')).toHaveAttribute('data-revision', '1');
  await page.getByRole('button', { name: 'Connect trainer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save trainer', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'reports/accounts-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-dialog')).not.toBeVisible();
  await expect(page.locator('#game')).toBeFocused();
});
