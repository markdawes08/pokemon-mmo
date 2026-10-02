import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@pokewaterblue/database';
import { characterViewSchema } from '@pokewaterblue/protocol';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { loadEncounterCore } from '../../tools/encounter-core/encounter.js';
import { WorldTestBackend } from '../integration/world-backend.js';
import { accountFixture, accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixturesByEmails } from '../integration/account-fixtures.js';
import { observeWorldCadence } from './world-cadence-probe.js';

const backend = new WorldTestBackend();
let database: ReturnType<typeof createDatabase>;
const emails: string[] = [], results: { title: string; status: string }[] = [];
let closeRecoveryEvidence: Record<string, number | boolean> | undefined;
const cadenceEvidence: Record<string, unknown>[] = [], heldInputEvidence: Record<string, unknown>[] = [];
test.beforeAll(async () => {
  if (!existsSync('apps/client/dist/index.html')) throw new Error('Wild encounter browser checks require a current build.');
  const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
  database = createDatabase(url); await backend.start();
});
test.afterEach(async ({ page: _page }, info) => { results.push({ title: info.title, status: info.status ?? 'unknown' }); });
test.afterAll(async () => {
  try { await backend.stop(); }
  finally { if (database) { try { await removeAccountFixturesByEmails(database, emails); } finally { await database.close(); } } }
  await writeFile('reports/wild-testing-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: results.length === 5 && results.every(row => row.status === 'passed'),
    results, backendPids: backend.pids, lifecycle: backend.lifecycleEvents, closeRecoveryEvidence, cadenceEvidence, heldInputEvidence,
    screenshots: ['reports/wild-testing-desktop.png', 'reports/wild-testing-mobile.png'],
    scope: 'Real built browser, owned backend and unique isolated PostgreSQL fixtures. Offline source-valid Route 1 anchor and deterministic source field checkpoints; every encounter starts from actual server-completed grass movement. Held-input cases deliver one unchanged late movement packet. No browser seed, encounter forcing, response mocking, main account access or credential file access.' }, null, 2) + '\n');
});
async function trainer(context: BrowserContext, name: string, options: { y?: number; grassSteps?: number } = {}) {
  const credentials = accountFixture(); emails.push(credentials.email);
  expect((await context.request.post(`${backend.origin}/api/auth/sign-up/email`, { data: credentials, headers: { Origin: backend.origin } })).status()).toBe(200);
  const created = await context.request.post(`${backend.origin}/api/characters`, { data: { commandId: randomUUID(), name }, headers: { Origin: backend.origin } });
  expect(created.status()).toBe(200); const character = characterViewSchema.parse((await created.json()).character);
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  const location = { mapId: 'MAP_ROUTE1' as const, x: 12, y: options.y ?? 39, elevation: 3 }; (await WorldContent.load()).validateLocation(location);
  await database.pool.query("UPDATE characters SET map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing='north' WHERE id=$1", [character.id, location.mapId, location.x, location.y, location.elevation]);
  const factory = (await loadEncounterCore()).create({ mainSeed: 0, wildSeed: 17185, trainerId: 1 });
  for (let index = 0; index < (options.grassSteps ?? 0); index++) expect(factory.step({ behavior: 'grass', movement: 'walk' }).kind).toBe('none');
  const checkpoint = factory.snapshot();
  await database.pool.query('INSERT INTO character_wild_test_state(character_id,checkpoint) VALUES($1,$2)', [character.id, JSON.stringify(checkpoint)]);
  return character;
}
async function connect(page: Page) {
  await page.goto(backend.origin); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#account-button').click(); await page.locator('#account-connect').click();
  await expect(page.locator('#account-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await expect(page.locator('#wild-testing-toggle')).toBeEnabled();
}
async function step(page: Page, key: 'ArrowUp' | 'ArrowDown') {
  const game = page.locator('#game'), serial = Number(await game.getAttribute('data-step-serial'));
  await page.keyboard.press(key);
  await expect.poll(async () => await game.getAttribute('data-world-mode') === 'battle' || Number(await game.getAttribute('data-step-serial')) > serial).toBe(true);
  await expect(game).toHaveAttribute('data-moving', 'false');
}
async function naturalEncounter(page: Page) {
  await page.locator('#game').click();
  for (let index = 0; index < 9; index++) {
    await step(page, index % 2 === 0 ? 'ArrowUp' : 'ArrowDown');
    if (index < 8) { await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await expect(page.locator('#practice-dialog')).not.toBeVisible(); }
  }
  await expect(page.locator('#practice-dialog')).toBeVisible();
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'route1-wild-test');
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await expect(page.locator('#practice-title')).toHaveText('Wild encounter');
  await expect(page.locator('#practice-opponent-card')).toContainText('Rattata'); await expect(page.locator('#practice-opponent-card')).toContainText('Lv. 3');
  await expect(page.locator('#practice-self-card')).toContainText('Squirtle');
  await expect(page.locator('#practice-setup')).not.toBeVisible();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'battle');
}
async function turn(page: Page, label: string | RegExp) {
  const revision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  await page.getByRole('button', { name: label, exact: typeof label === 'string' }).click();
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', String(revision + 1));
}
async function assets(context: BrowserContext, id: string) {
  const response = await context.request.get(`${backend.origin}/api/characters/${id}/assets`); expect(response.status()).toBe(200); return response.json();
}

test('opt-in grass steps start a real wild battle and return to the same tile without owned rewards', async ({ page, context }) => {
  test.setTimeout(60_000); const character = await trainer(context, 'GRASS'); await connect(page);
  const before = await assets(context, character.id);
  await expect(page.locator('#wild-testing')).toHaveAttribute('data-enabled', 'false');
  await page.locator('#account-button').click(); await page.locator('#account-world-enter').click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await page.locator('#game').click();
  for (let index = 0; index < 10; index++) await step(page, index % 2 === 0 ? 'ArrowUp' : 'ArrowDown');
  await expect(page.locator('#practice-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
  await expect(page.locator('#wild-testing')).toHaveAttribute('data-enabled', 'true'); await naturalEncounter(page);
  const tile = await page.locator('#game').getAttribute('data-server-tile-y');
  expect(tile).toBe('38'); await page.keyboard.press('ArrowUp'); await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', tile!);
  await expect(page.locator('#practice-self-sprite')).toHaveJSProperty('naturalWidth', 64);
  await expect(page.locator('#practice-opponent-sprite')).toHaveJSProperty('naturalWidth', 64);
  await turn(page, /^Tackle, /); await expect(page.locator('#practice-events')).toContainText('TACKLE');
  await page.screenshot({ path: 'reports/wild-testing-desktop.png', fullPage: true });
  for (let attempt = 0; attempt < 5 && await page.locator('#practice-dialog').getAttribute('data-phase') !== 'ended'; attempt++) await turn(page, 'Run');
  await expect(page.locator('#practice-result')).toContainText('You got away');
  await page.getByRole('button', { name: 'Return to Route 1', exact: true }).click();
  await expect(page.locator('#practice-dialog')).not.toBeVisible(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await expect(page.locator('#game')).toHaveAttribute('data-server-map-id', 'MAP_ROUTE1'); await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', tile!);
  const after = await assets(context, character.id);
  for (const key of ['party', 'inventory', 'money']) expect(after[key]).toEqual(before[key]);
  await page.getByRole('button', { name: 'Disable wild encounters', exact: true }).click();
  await expect(page.locator('#wild-testing')).toHaveAttribute('data-enabled', 'false');
  await page.locator('#game').click(); await step(page, 'ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
});

test('wild battle hides safely and recovers the same battle after refresh and a fresh backend', async ({ page, context }) => {
  test.setTimeout(60_000); const character = await trainer(context, 'FIELD');
  await page.addInitScript(() => {
    const native = WebSocket.prototype.send, descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
    const state = { arm: false, id: '', dropped: 0, frames: [] as number[][] };
    (window as unknown as { wildCloseProbe: typeof state }).wildCloseProbe = state;
    WebSocket.prototype.send = function (data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      const text = bytes ? new TextDecoder().decode(bytes) : '';
      if (text.includes('practice-command')) {
        if (state.arm && !state.id && text.includes('close')) state.id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';
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
            state.arm = false; state.dropped++; this.close(4010, 'induced wild close acknowledgement loss'); return;
          }
          handler.call(this, event);
        });
      } });
  });
  await connect(page);
  await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
  await expect(page.locator('#wild-testing')).toHaveAttribute('data-enabled', 'true'); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await naturalEncounter(page); await turn(page, /^Tackle, /);
  const revision = await page.locator('#practice-dialog').getAttribute('data-revision'), hp = await page.locator('#practice-self-card').getAttribute('data-hp');
  await page.getByRole('button', { name: 'Hide battle', exact: true }).click(); await page.locator('#game').click(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'battle'); await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
  await page.locator('#practice-button').click(); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', revision!);
  for (const restart of [false, true]) {
    if (restart) { await backend.stop(); await backend.start(); }
    await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true'); await page.locator('#practice-button').click();
    await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
    await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'route1-wild-test');
    await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', revision!); await expect(page.locator('#practice-self-card')).toHaveAttribute('data-hp', hp!);
    await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'battle'); await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#practice-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'reports/wild-testing-mobile.png', fullPage: true });
  await page.evaluate(() => { (window as unknown as { wildCloseProbe: { arm: boolean } }).wildCloseProbe.arm = true; });
  await page.getByRole('button', { name: 'End encounter test', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  await expect(page.locator('#practice-dialog')).not.toBeVisible(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
  const probe = await page.evaluate(() => (window as unknown as { wildCloseProbe: { id: string; dropped: number; frames: number[][] } }).wildCloseProbe);
  expect(probe.dropped).toBe(1); expect(probe.frames.length).toBeGreaterThanOrEqual(2);
  for (const frame of probe.frames) expect(frame).toEqual(probe.frames[0]);
  const receipts = Number((await database.pool.query('SELECT count(*) AS count FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [character.id, probe.id])).rows[0].count);
  expect(receipts).toBe(1);
  closeRecoveryEvidence = { droppedAcknowledgements: probe.dropped, identicalCloseFrames: probe.frames.length, closeReceipts: receipts, retryAfterSharedReturn: true };
  await page.locator('#practice-button').click();
  await expect(page.getByRole('button', { name: 'Leave shared world & practice', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Leave shared world & practice', exact: true }).click();
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'practice');
  await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
  await expect(page.locator('#practice-start')).toBeEnabled();
});

for (const run of [false, true]) test(`held ${run ? 'Shift-run' : 'walk'} keeps Run and End encounter usable after a late movement frame`, async ({ page, context }) => {
  test.setTimeout(40_000);
  await trainer(context, run ? 'RUNNER' : 'WALKER', { grassSteps: 8 });
  const wire = observeWorldCadence(page);
  await page.addInitScript(() => {
    const native = WebSocket.prototype.send, descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
    let lastInput: ArrayBuffer | undefined, delivered = false;
    const probe = { lateInputs: 0 }; (window as unknown as { heldWildProbe: typeof probe }).heldWildProbe = probe;
    WebSocket.prototype.send = function (data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (bytes && new TextDecoder().decode(bytes).includes('world-input')) lastInput = Uint8Array.from(bytes).buffer;
      return native.call(this, data);
    };
    Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, get: descriptor.get,
      set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        if (!handler) { descriptor.set!.call(this, handler); return; }
        descriptor.set!.call(this, (event: MessageEvent) => {
          const text = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
          if (!delivered && lastInput && text.includes('route1-wild-test')) {
            delivered = true; const input = lastInput;
            // A real, unchanged movement packet arrives after admission. This
            // deterministic transport duplicate complements holding the key.
            setTimeout(() => { if (this.readyState === WebSocket.OPEN) { probe.lateInputs++; native.call(this, input); } }, 80);
          }
          handler.call(this, event);
        });
      } });
  });
  await connect(page); await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await page.locator('#game').click();
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowUp');
  try {
    await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'route1-wild-test');
    await expect.poll(() => page.evaluate(() => (window as unknown as { heldWildProbe: { lateInputs: number } }).heldWildProbe.lateInputs)).toBe(1);
    await page.waitForTimeout(350);
    await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'End encounter test', exact: true })).toBeEnabled();
  } finally { await page.keyboard.up('ArrowUp'); if (run) await page.keyboard.up('Shift'); }
  expect(wire.errors).not.toContain('RECONNECT_REQUIRED');
  heldInputEvidence.push({ movement: run ? 'run' : 'walk', lateInputs: 1, errors: wire.errors, controlsEnabled: true });
  if (!run) {
    for (let attempt = 0; attempt < 5 && await page.locator('#practice-dialog').getAttribute('data-phase') !== 'ended'; attempt++) await turn(page, 'Run');
    await expect(page.locator('#practice-result')).toContainText('You got away');
    await page.getByRole('button', { name: 'Return to Route 1', exact: true }).click();
  } else await page.getByRole('button', { name: 'End encounter test', exact: true }).click();
  await expect(page.locator('#practice-dialog')).not.toBeVisible();
  await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
});

test('held walking and running keep the same cadence with wild testing off and on', async ({ browser }) => {
  test.setTimeout(90_000);
  // Four independent signup fixtures get a fresh owned backend, preserving the
  // real signup rate limit rather than bypassing it in application settings.
  await backend.stop(); await backend.start();
  for (const run of [false, true]) for (const enabled of [false, true]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); await trainer(context, 'CADENCE', { y: 27 });
      const wire = observeWorldCadence(page); await connect(page);
      if (enabled) await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
      else { await page.locator('#account-button').click(); await page.locator('#account-world-enter').click(); }
      await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await page.locator('#game').click();
      if (run) await page.keyboard.down('Shift');
      await page.keyboard.down('ArrowRight');
      try { await expect.poll(() => wire.motions.length, { intervals: [10], timeout: 10_000 }).toBeGreaterThanOrEqual(5); }
      finally { await page.keyboard.up('ArrowRight'); if (run) await page.keyboard.up('Shift'); }
      await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
      await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
      const motions = wire.motions.slice(0, 5);
      const gaps = motions.slice(1).map((motion, index) => motion.startedAt - motions[index]!.startedAt - motions[index]!.durationMs);
      const earlyInputMs = wire.inputs.filter(input => input.previousMotionEnd !== null).map(input => input.estimatedServerTime - input.previousMotionEnd!);
      cadenceEvidence.push({ movement: run ? 'run' : 'walk', enabled, motions: motions.length, durations: motions.map(motion => motion.durationMs), gaps, errors: wire.errors, busyMessages: wire.busyMessages, earlyInputMs });
      await writeFile('reports/wild-cadence-observation.json', JSON.stringify(cadenceEvidence, null, 2) + '\n');
      expect(motions.length).toBe(5);
      expect(motions.every(motion => Math.round(motion.durationMs * 60 / 1000) === (run ? 8 : 16))).toBe(true);
      expect(wire.errors.filter(code => code !== 'BUSY')).toEqual([]);
      expect.soft(Math.max(...gaps)).toBeLessThan(100);
    } finally { await context.close(); }
  }
  for (const movement of ['walk', 'run']) {
    const rows = cadenceEvidence.filter(row => row.movement === movement);
    const averages = rows.map(row => (row.gaps as number[]).reduce((sum, gap) => sum + gap, 0) / 4);
    expect(Math.abs(averages[1]! - averages[0]!)).toBeLessThan(50);
  }
});
