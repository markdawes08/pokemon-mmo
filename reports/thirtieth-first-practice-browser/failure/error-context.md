# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: practice.spec.ts >> Mirror Move is playable, spends its own PP, and resumes after refresh and a fresh backend
- Location: tests\e2e\practice.spec.ts:191:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

@@ -51,11 +51,11 @@
        "speciesId": 7,
        "status": "healthy",
      },
    ],
    "profileId": "r1-squirtle-v1",
-   "revision": 1,
+   "revision": 3,
    "storage": Object {
      "capacity": 420,
      "used": 0,
    },
    "version": 1,
```

# Test source

```ts
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
  142 |             state.queryBurst = true;
  143 |             native.call(this, Uint8Array.from(state.query)); native.call(this, Uint8Array.from(state.query));
  144 |           }
  145 |         });
  146 |       } });
  147 |   });
  148 |   await openPractice(page); await preset(page, 'Rain and water moves'); await start(page);
  149 |   const initialRevision = Number(await page.locator('#practice-dialog').getAttribute('data-revision'));
  150 |   await page.evaluate(() => { (window as unknown as { practiceProbe: { arm: boolean } }).practiceProbe.arm = true; });
  151 |   await page.getByRole('button', { name: /^Rain Dance, / }).click();
  152 |   await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled({ timeout: 15_000 });
  153 |   await expect.poll(() => page.evaluate(() => (window as unknown as { practiceProbe: { uncorrelatedErrors: number } }).practiceProbe.uncorrelatedErrors)).toBeGreaterThanOrEqual(1);
  154 |   await page.waitForTimeout(350);
  155 |   await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeEnabled();
  156 |   expect(await page.evaluate(() => (window as unknown as { practiceProbe: { frames: number[][] } }).practiceProbe.frames.length)).toBe(1);
  157 |   await ready(page); await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', String(initialRevision + 1));
  158 |   const revision = await page.locator('#practice-dialog').getAttribute('data-revision');
  159 |   await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  160 |   await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toHaveCount(0);
  161 |   expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision);
  162 |   const probe = await page.evaluate(() => (window as unknown as { practiceProbe: { dropped: number; frames: number[][]; id: string; uncorrelatedErrors: number } }).practiceProbe);
  163 |   expect(probe.dropped).toBe(1); expect(probe.frames.length).toBeGreaterThanOrEqual(2);
  164 |   for (const frame of probe.frames) expect(frame).toEqual(probe.frames[0]);
  165 |   const receipts = await database.pool.query('SELECT count(*) AS count FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [character.id, probe.id]); expect(Number(receipts.rows[0].count)).toBe(1);
  166 |   const ownHP = await page.locator('#practice-self-card').getAttribute('data-hp');
  167 |   await page.reload(); await openPractice(page, false); await ready(page);
  168 |   expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision); expect(await page.locator('#practice-self-card').getAttribute('data-hp')).toBe(ownHP);
  169 |   await backend.stop(); await backend.start();
  170 |   let releaseCatalogue!: () => void, catalogueRequested!: () => void;
  171 |   const catalogueGate = new Promise<void>(resolve => { releaseCatalogue = resolve; });
  172 |   const catalogueSeen = new Promise<void>(resolve => { catalogueRequested = resolve; });
  173 |   // Hold the real boot request so Practice is deliberately opened before the
  174 |   // normal cookie account loads. No selected-test preference can mask this race.
  175 |   await page.route('**/api/testing/accounts', async route => {
  176 |     catalogueRequested(); await catalogueGate; await route.continue();
  177 |   });
  178 |   try {
  179 |     await page.reload(); await catalogueSeen; await openPractice(page, false);
  180 |     await expect(page.locator('#practice-dialog')).toHaveAttribute('data-connection-state', 'disconnected');
  181 |     releaseCatalogue(); await ready(page);
  182 |   } finally { releaseCatalogue(); await page.unroute('**/api/testing/accounts'); }
  183 |   expect(await page.locator('#practice-dialog').getAttribute('data-revision')).toBe(revision);
  184 |   expect(await page.locator('#practice-self-card').getAttribute('data-hp')).toBe(ownHP); await expect(page.locator('#practice-weather')).toContainText('Rain');
  185 |   await finish(page);
  186 |   recoveryEvidence = { droppedAcknowledgements: probe.dropped, uncorrelatedErrors: probe.uncorrelatedErrors, identicalCommandFrames: probe.frames.length,
  187 |     commandReceiptCount: Number(receipts.rows[0].count), noAutomaticCommandReplay: true, refreshRecovered: true, freshBackendRecovered: true,
  188 |     practiceOpenedBeforeAccountBootstrap: true };
  189 | });
  190 | 
  191 | test('Mirror Move is playable, spends its own PP, and resumes after refresh and a fresh backend', async ({ page, context }) => {
  192 |   test.setTimeout(60_000);
  193 |   const character = await trainer(context, 'MIRROR');
  194 |   const beforeAssets = await assets(context, character.id);
  195 |   await openPractice(page); await preset(page, 'Mirror Move');
  196 |   await expect(page.getByLabel('Party 1 move 1')).toHaveValue('119');
  197 |   await page.getByLabel('Party 1 level').fill('46'); await page.getByLabel('Party 1 level').press('Tab');
  198 |   await expect(page.getByLabel('Party 1 move 1')).not.toContainText('Mirror Move');
  199 |   await preset(page, 'Mirror Move'); await start(page);
  200 |   await action(page, /^Mirror Move, /);
  201 |   await expect(page.locator('#practice-events')).toContainText('PIDGEY used MIRROR MOVE and copied BUBBLE');
  202 |   await expect(page.getByRole('button', { name: 'Mirror Move, 19 of 20 PP', exact: true })).toBeEnabled();
  203 |   const saved = {
  204 |     revision: await page.locator('#practice-dialog').getAttribute('data-revision'),
  205 |     playerHP: await page.locator('#practice-self-card').getAttribute('data-hp'),
  206 |     opponentHP: await page.locator('#practice-opponent-card').getAttribute('data-hp'),
  207 |   };
  208 |   for (const restart of [false, true]) {
  209 |     if (restart) { await backend.stop(); await backend.start(); }
  210 |     await page.reload(); await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  211 |     await openPractice(page, false); await ready(page);
  212 |     await expect(page.locator('#practice-dialog')).toHaveAttribute('data-revision', saved.revision!);
  213 |     await expect(page.locator('#practice-self-card')).toHaveAttribute('data-hp', saved.playerHP!);
  214 |     await expect(page.locator('#practice-opponent-card')).toHaveAttribute('data-hp', saved.opponentHP!);
  215 |     await expect(page.getByRole('button', { name: 'Mirror Move, 19 of 20 PP', exact: true })).toBeEnabled();
  216 |   }
  217 |   await action(page, /^Mirror Move, /);
  218 |   await expect(page.getByRole('button', { name: 'Mirror Move, 18 of 20 PP', exact: true })).toBeEnabled();
  219 |   await expect(page.locator('#practice-events')).toContainText('PIDGEY used MIRROR MOVE and copied BUBBLE');
  220 |   await page.setViewportSize({ width: 1280, height: 1100 });
  221 |   await page.screenshot({ path: 'reports/mirror-practice.png', fullPage: true });
  222 |   await finish(page);
> 223 |   expect(await assets(context, character.id)).toEqual(beforeAssets);
      |                                               ^ Error: expect(received).toEqual(expected) // deep equality
  224 | });
  225 | 
```