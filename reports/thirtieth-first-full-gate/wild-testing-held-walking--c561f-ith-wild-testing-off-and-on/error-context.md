# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wild-testing.spec.ts >> held walking and running keep the same cadence with wild testing off and on
- Location: tests\e2e\wild-testing.spec.ts:231:1

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 100
Received:   182.66666666666666
```

# Test source

```ts
  158 |   await page.evaluate(() => { (window as unknown as { wildCloseProbe: { arm: boolean } }).wildCloseProbe.arm = true; });
  159 |   await page.getByRole('button', { name: 'End encounter test', exact: true }).click();
  160 |   await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled({ timeout: 15_000 });
  161 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  162 |   await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  163 |   await expect(page.locator('#practice-dialog')).not.toBeVisible(); await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  164 |   await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
  165 |   const probe = await page.evaluate(() => (window as unknown as { wildCloseProbe: { id: string; dropped: number; frames: number[][] } }).wildCloseProbe);
  166 |   expect(probe.dropped).toBe(1); expect(probe.frames.length).toBeGreaterThanOrEqual(2);
  167 |   for (const frame of probe.frames) expect(frame).toEqual(probe.frames[0]);
  168 |   const receipts = Number((await database.pool.query('SELECT count(*) AS count FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [character.id, probe.id])).rows[0].count);
  169 |   expect(receipts).toBe(1);
  170 |   closeRecoveryEvidence = { droppedAcknowledgements: probe.dropped, identicalCloseFrames: probe.frames.length, closeReceipts: receipts, retryAfterSharedReturn: true };
  171 |   await page.locator('#practice-button').click();
  172 |   await expect(page.getByRole('button', { name: 'Leave shared world & practice', exact: true })).toBeEnabled();
  173 |   await page.getByRole('button', { name: 'Leave shared world & practice', exact: true }).click();
  174 |   await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'practice');
  175 |   await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
  176 |   await expect(page.locator('#practice-start')).toBeEnabled();
  177 | });
  178 | 
  179 | for (const run of [false, true]) test(`held ${run ? 'Shift-run' : 'walk'} keeps Run and End encounter usable after a late movement frame`, async ({ page, context }) => {
  180 |   test.setTimeout(40_000);
  181 |   await trainer(context, run ? 'RUNNER' : 'WALKER', { grassSteps: 8 });
  182 |   const wire = observeWorldCadence(page);
  183 |   await page.addInitScript(() => {
  184 |     const native = WebSocket.prototype.send, descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
  185 |     let lastInput: ArrayBuffer | undefined, delivered = false;
  186 |     const probe = { lateInputs: 0 }; (window as unknown as { heldWildProbe: typeof probe }).heldWildProbe = probe;
  187 |     WebSocket.prototype.send = function (data) {
  188 |       const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  189 |       if (bytes && new TextDecoder().decode(bytes).includes('world-input')) lastInput = Uint8Array.from(bytes).buffer;
  190 |       return native.call(this, data);
  191 |     };
  192 |     Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, get: descriptor.get,
  193 |       set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
  194 |         if (!handler) { descriptor.set!.call(this, handler); return; }
  195 |         descriptor.set!.call(this, (event: MessageEvent) => {
  196 |           const text = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
  197 |           if (!delivered && lastInput && text.includes('route1-wild-test')) {
  198 |             delivered = true; const input = lastInput;
  199 |             // A real, unchanged movement packet arrives after admission. This
  200 |             // deterministic transport duplicate complements holding the key.
  201 |             setTimeout(() => { if (this.readyState === WebSocket.OPEN) { probe.lateInputs++; native.call(this, input); } }, 80);
  202 |           }
  203 |           handler.call(this, event);
  204 |         });
  205 |       } });
  206 |   });
  207 |   await connect(page); await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
  208 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await page.locator('#game').click();
  209 |   if (run) await page.keyboard.down('Shift');
  210 |   await page.keyboard.down('ArrowUp');
  211 |   try {
  212 |     await expect(page.locator('#practice-dialog')).toHaveAttribute('data-origin', 'route1-wild-test');
  213 |     await expect.poll(() => page.evaluate(() => (window as unknown as { heldWildProbe: { lateInputs: number } }).heldWildProbe.lateInputs)).toBe(1);
  214 |     await page.waitForTimeout(350);
  215 |     await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'connected');
  216 |     await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  217 |     await expect(page.getByRole('button', { name: 'End encounter test', exact: true })).toBeEnabled();
  218 |   } finally { await page.keyboard.up('ArrowUp'); if (run) await page.keyboard.up('Shift'); }
  219 |   expect(wire.errors).not.toContain('RECONNECT_REQUIRED');
  220 |   heldInputEvidence.push({ movement: run ? 'run' : 'walk', lateInputs: 1, errors: wire.errors, controlsEnabled: true });
  221 |   if (!run) {
  222 |     for (let attempt = 0; attempt < 5 && await page.locator('#practice-dialog').getAttribute('data-phase') !== 'ended'; attempt++) await turn(page, 'Run');
  223 |     await expect(page.locator('#practice-result')).toContainText('You got away');
  224 |     await page.getByRole('button', { name: 'Return to Route 1', exact: true }).click();
  225 |   } else await page.getByRole('button', { name: 'End encounter test', exact: true }).click();
  226 |   await expect(page.locator('#practice-dialog')).not.toBeVisible();
  227 |   await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  228 |   await expect(page.locator('#game')).toHaveAttribute('data-server-tile-y', '38');
  229 | });
  230 | 
  231 | test('held walking and running keep the same cadence with wild testing off and on', async ({ browser }) => {
  232 |   test.setTimeout(90_000);
  233 |   // Four independent signup fixtures get a fresh owned backend, preserving the
  234 |   // real signup rate limit rather than bypassing it in application settings.
  235 |   await backend.stop(); await backend.start();
  236 |   for (const run of [false, true]) for (const enabled of [false, true]) {
  237 |     const context = await browser.newContext();
  238 |     try {
  239 |       const page = await context.newPage(); await trainer(context, 'CADENCE', { y: 27 });
  240 |       const wire = observeWorldCadence(page); await connect(page);
  241 |       if (enabled) await page.getByRole('button', { name: 'Enable wild encounters', exact: true }).click();
  242 |       else { await page.locator('#account-button').click(); await page.locator('#account-world-enter').click(); }
  243 |       await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared'); await page.locator('#game').click();
  244 |       if (run) await page.keyboard.down('Shift');
  245 |       await page.keyboard.down('ArrowRight');
  246 |       try { await expect.poll(() => wire.motions.length, { intervals: [10], timeout: 10_000 }).toBeGreaterThanOrEqual(5); }
  247 |       finally { await page.keyboard.up('ArrowRight'); if (run) await page.keyboard.up('Shift'); }
  248 |       await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  249 |       await expect(page.locator('#game')).toHaveAttribute('data-world-mode', 'shared');
  250 |       const motions = wire.motions.slice(0, 5);
  251 |       const gaps = motions.slice(1).map((motion, index) => motion.startedAt - motions[index]!.startedAt - motions[index]!.durationMs);
  252 |       const earlyInputMs = wire.inputs.filter(input => input.previousMotionEnd !== null).map(input => input.estimatedServerTime - input.previousMotionEnd!);
  253 |       cadenceEvidence.push({ movement: run ? 'run' : 'walk', enabled, motions: motions.length, durations: motions.map(motion => motion.durationMs), gaps, errors: wire.errors, busyMessages: wire.busyMessages, earlyInputMs });
  254 |       await writeFile('reports/wild-cadence-observation.json', JSON.stringify(cadenceEvidence, null, 2) + '\n');
  255 |       expect(motions.length).toBe(5);
  256 |       expect(motions.every(motion => Math.round(motion.durationMs * 60 / 1000) === (run ? 8 : 16))).toBe(true);
  257 |       expect(wire.errors.filter(code => code !== 'BUSY')).toEqual([]);
> 258 |       expect.soft(Math.max(...gaps)).toBeLessThan(100);
      |                                      ^ Error: expect(received).toBeLessThan(expected)
  259 |     } finally { await context.close(); }
  260 |   }
  261 |   for (const movement of ['walk', 'run']) {
  262 |     const rows = cadenceEvidence.filter(row => row.movement === movement);
  263 |     const averages = rows.map(row => (row.gaps as number[]).reduce((sum, gap) => sum + gap, 0) / 4);
  264 |     expect(Math.abs(averages[1]! - averages[0]!)).toBeLessThan(50);
  265 |   }
  266 | });
  267 | 
```