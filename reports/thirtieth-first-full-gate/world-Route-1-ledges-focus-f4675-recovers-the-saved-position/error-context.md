# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: world.spec.ts >> Route 1 ledges, focus and menus stop input, and a fresh backend recovers the saved position
- Location: tests\e2e\world.spec.ts:151:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#account-status')
Expected substring: "checkpointed"
Received string:    "The trainer profile changed. Refresh its current snapshot."
Timeout: 10000ms

Call log:
  - Expect "toContainText" locator('#account-status') with timeout 10000ms
  - waiting for locator('#account-status')
    24 × locator resolved to <p role="status" aria-live="polite" id="account-status" class="account-status account-error">The trainer profile changed. Refresh its current …</p>
       - unexpected value "The trainer profile changed. Refresh its current snapshot."

```

```yaml
- status: The trainer profile changed. Refresh its current snapshot.
```

# Test source

```ts
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
  165 |   expect(invalidSave.invalidErrors).toBe(1); expect(invalidSave.frames).toHaveLength(rejectedSave.frames.length); expect(await receipts()).toBe(beforeSaveReceipts);
  166 |   await armSaveProbe(page, 'busy'); await page.locator('#account-save').click();
  167 |   await expect(page.locator('#account-status')).toContainText('checkpointed');
  168 |   const retriedSave = await saveProbe(page);
  169 |   expect(retriedSave.busyErrors).toBeGreaterThanOrEqual(1); expect(retriedSave.frames.length).toBeGreaterThanOrEqual(2);
  170 |   expect(retriedSave.frames.length).toBeLessThanOrEqual(6);
  171 |   for (const frame of retriedSave.frames) expect(frame).toEqual(retriedSave.frames[0]);
  172 |   expect(await receipts()).toBe(beforeSaveReceipts + 1);
  173 |   await writeFile('reports/world-save-retry.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Real authenticated hello immediately precedes Save, producing actual server BUSY; malformed Save gets real INVALID_MESSAGE', busyResponses: retriedSave.busyErrors, identicalSaveAttempts: retriedSave.frames.length, receiptsWritten: 1, invalidSaveAttempts: invalidSave.frames.length, attemptsAfterInvalidResponse: 0, invalidSaveReceipts: 0 }, null, 2)}\n`);
  174 |   await page.getByRole('button', { name: 'Close account', exact: true }).click();
  175 |   await expect(page.locator('#game')).toBeFocused();
  176 |   await step(page, 'ArrowUp'); await position(page, ROUTE, 12, 39);
  177 |   await page.keyboard.down('Shift'); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2600);
  178 |   await page.keyboard.up('ArrowUp'); await page.keyboard.up('Shift'); await position(page, ROUTE, 12, 32);
  179 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  180 |   await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400); await position(page, ROUTE, 12, 32);
  181 |   await walk(page, 'ArrowLeft', 6, true); await walk(page, 'ArrowUp', 2, true); await walk(page, 'ArrowRight', 6, true); await position(page, ROUTE, 12, 30);
  182 |   await step(page, 'ArrowDown'); await position(page, ROUTE, 12, 32);
  183 |   await expect(page.locator('#game')).toHaveAttribute('data-step-duration-frames', '32');
  184 |   await page.screenshot({ path: 'reports/world-route-ledge.png', fullPage: true });
  185 |   await page.keyboard.down('ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  186 |   await page.getByRole('button', { name: 'Field guide', exact: true }).click();
  187 |   await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  188 |   const menuY = await page.locator('#game').getAttribute('data-tile-y');
  189 |   await page.waitForTimeout(550); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', menuY!);
  190 |   await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  191 |   await expect(page.locator('#game')).toHaveAttribute('data-tile-y', menuY!); await page.keyboard.up('ArrowDown');
  192 |   await page.locator('#game').click(); await page.keyboard.down('ArrowDown');
  193 |   await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  194 |   await page.getByRole('button', { name: 'Collision overlay', exact: true }).click(); await page.keyboard.up('ArrowDown');
  195 |   await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  196 |   const focusY = await page.locator('#game').getAttribute('data-tile-y');
  197 |   await page.waitForTimeout(450); await expect(page.locator('#game')).toHaveAttribute('data-tile-y', focusY!);
  198 |   await openAccount(page, false); await page.locator('#account-save').click();
> 199 |   await expect(page.locator('#account-status')).toContainText('checkpointed');
      |                                                 ^ Error: expect(locator).toContainText(expected) failed
  200 |   const committed = await savedPosition(character.id);
  201 |   await page.getByRole('button', { name: 'Close account', exact: true }).click();
  202 |   await expect(page.locator('#game')).toBeFocused();
  203 |   await page.keyboard.down('ArrowDown'); await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  204 |   await backend.stop();
  205 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'disconnected');
  206 |   const frozen = await page.locator('#game').getAttribute('data-tile-y'); await page.waitForTimeout(550);
  207 |   await expect(page.locator('#game')).toHaveAttribute('data-tile-y', frozen!); await page.keyboard.up('ArrowDown');
  208 |   await backend.start(); expect(backend.pids[0]).not.toBe(backend.pids[1]);
  209 |   await openAccount(page, false); await page.locator('#account-connect').click();
  210 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  211 |   await page.getByRole('button', { name: 'Close account', exact: true }).click();
  212 |   const restored = await savedPosition(character.id);
  213 |   expect(restored.map_id).toBe(ROUTE); expect(restored.position_y).toBeGreaterThanOrEqual(committed.position_y);
  214 |   await position(page, ROUTE, restored.position_x, restored.position_y);
  215 |   const stoppedY = await page.locator('#game').getAttribute('data-tile-y'); await page.waitForTimeout(400);
  216 |   await expect(page.locator('#game')).toHaveAttribute('data-tile-y', stoppedY!);
  217 |   await openAccount(page, false); await armSaveProbe(page, 'stall');
  218 |   const stalledSaveStarted = Date.now(); await page.locator('#account-save').click();
  219 |   await expect(page.locator('#account-status')).toContainText('Saving trainer');
  220 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'reconnecting', { timeout: 10_000 });
  221 |   await expect(page.locator('#account-connect')).toBeDisabled();
  222 |   await expect(page.locator('#account-world-leave')).toBeEnabled();
  223 |   await page.locator('#account-world-leave').click();
  224 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'preview');
  225 |   await expect(page.locator('#account-connect')).toBeEnabled();
  226 |   await expect(page.locator('#account-status')).toHaveText('Shared world left. Anonymous exploration is unsaved.');
  227 |   // Pass the original eight-second Save deadline. Cancelled timers must not
  228 |   // replace the loss message or strand the controls after this induced client stall.
  229 |   await page.waitForTimeout(Math.max(0, stalledSaveStarted + 8500 - Date.now()));
  230 |   await expect(page.locator('#account-status')).toHaveText('Shared world left. Anonymous exploration is unsaved.');
  231 |   await expect(page.locator('#account-connect')).toBeEnabled();
  232 |   const stalledSave = await saveProbe(page);
  233 |   expect(stalledSave.frames).toHaveLength(1); expect(stalledSave.stalledMessages).toBeGreaterThan(0);
  234 |   await writeFile('reports/world-save-watchdog.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), scope: 'Induced client delivery stall with real native socket; this is not server failure evidence', pendingSaveAttempts: 1, discardedSdkMessages: stalledSave.stalledMessages, explicitLeaveEnabled: true, graceCancelled: true, originalSaveDeadlineCancelled: true }, null, 2)}\n`);
  235 | });
  236 | 
```