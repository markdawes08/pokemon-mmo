import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';

interface NpcPose { x: number; y: number; frame: string; flipX: boolean }
interface MeasuredStep { milliseconds: number; mode: string; frames: number }
type ProbeWindow = Window & {
  Phaser: typeof Phaser; npcPoses: Record<string, NpcPose>; measuredSteps: MeasuredStep[];
};
type SpriteRenderer = (renderer: Phaser.Renderer.WebGL.WebGLRenderer, sprite: Phaser.GameObjects.Sprite,
  camera: Phaser.Cameras.Scene2D.Camera, parentMatrix: Phaser.GameObjects.Components.TransformMatrix) => void;

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#game').click();
}
async function position(page: Page, x: number, y: number) {
  await expect(page.locator('#game')).toHaveAttribute('data-tile-x', String(x));
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', String(y));
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
}
async function step(page: Page, key: string, count = 1) {
  for (let index = 0; index < count; index++) {
    const before = Number(await page.locator('#game').getAttribute('data-step-serial'));
    await page.keyboard.press(key);
    await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-step-serial'))).toBeGreaterThan(before);
    await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
    await expect(page.locator('#game')).toHaveAttribute('data-transitioning', 'false');
  }
}
async function observeNpcs(page: Page) {
  await page.evaluate(() => {
    const runtime = window as unknown as ProbeWindow;
    runtime.npcPoses = {};
    const prototype = runtime.Phaser.GameObjects.Sprite.prototype as Phaser.GameObjects.Sprite & { renderWebGL: SpriteRenderer };
    const render = prototype.renderWebGL;
    prototype.renderWebGL = function (renderer, sprite, camera, parentMatrix) {
      if (sprite.texture.key.startsWith('npc:')) {
        const transform = sprite.getWorldTransformMatrix();
        runtime.npcPoses[sprite.name] = { x: transform.tx, y: transform.ty, frame: String(sprite.frame.name), flipX: sprite.flipX };
      }
      render.call(this, renderer, sprite, camera, parentMatrix);
    };
  });
}

test('source-default NPCs render and the town sign respects facing and dialogue focus', async ({ page }) => {
  await start(page);
  await observeNpcs(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).npcPoses['MAP_PALLET_TOWN:1']))
    .toEqual({ x: 88, y: 256, frame: '1', flipX: false }); // On-entry lady pose, not raw JSON(3,10).
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).npcPoses['MAP_PALLET_TOWN:2']))
    .toEqual({ x: 216, y: 288, frame: '0', flipX: false });
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).npcPoses['MAP_PALLET_TOWN:3'])).toBeUndefined();

  await step(page, 'ArrowLeft');
  await page.keyboard.press('e'); // Facing empty floor; adjacent sign is north.
  await expect(page.getByRole('dialog')).toBeHidden();
  await step(page, 'ArrowUp'); // Sign collision changes facing without moving.
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#dialogue-text')).toContainText('PALLET TOWN');
  await expect(page.locator('#dialogue-text')).toContainText('Shades of your journey await!');
  await expect(page.locator('#game')).toBeFocused();
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(350);
  await position(page, 9, 12);
  await page.keyboard.up('ArrowLeft');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#game')).toBeFocused();
  await page.waitForTimeout(250);
  await position(page, 9, 12);
});

test('a source NPC blocks its tile, faces the player, and pages dialogue without leaking movement', async ({ page }) => {
  await start(page);
  await observeNpcs(page);
  await step(page, 'ArrowDown', 2);
  await step(page, 'ArrowRight', 2);
  await step(page, 'ArrowDown', 3);
  await step(page, 'ArrowRight'); // Fat man occupies(13,17).
  await position(page, 12, 17);
  await page.keyboard.down('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#dialogue-text')).toHaveText('Technology is incredible!');
  await page.keyboard.down('Enter'); // Browser repeat must not skip a page.
  await expect(page.locator('#dialogue-text')).toHaveText('Technology is incredible!');
  await page.keyboard.up('Enter');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).npcPoses['MAP_PALLET_TOWN:2']?.frame)).toBe('2');
  await page.screenshot({ path: 'reports/npc-dialogue-browser.png', fullPage: true });
  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toContainText('You can now store and recall items');
  await expect(page.locator('#dialogue-text')).toContainText('POK\u00e9MON');
  await expect(page.locator('#dialogue-text')).toContainText('as data via PC.');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.waitForTimeout(400);
  await position(page, 12, 17); // A key held while closing must require release.
  await page.keyboard.up('ArrowLeft');
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).npcPoses['MAP_PALLET_TOWN:2']?.frame)).toBe('0');

  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toHaveText('Technology is incredible!');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Reset position' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await position(page, 10, 12);
  await expect(page.locator('#game')).toBeFocused();
});

test('stateful NPC interactions explain their missing behavior without pretending to execute it', async ({ page }) => {
  await start(page);
  await step(page, 'ArrowLeft', 4);
  await step(page, 'ArrowDown', 3);
  await step(page, 'ArrowLeft');
  await position(page, 6, 15);
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#dialogue-text')).toContainText(/script|story/i);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset position' }).click();

  await step(page, 'ArrowUp', 4);
  await step(page, 'ArrowLeft', 4);
  await step(page, 'ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-map-id', 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F');
  await step(page, 'ArrowUp', 2);
  await step(page, 'ArrowRight', 4);
  await step(page, 'ArrowUp', 2); // Second action faces Mom's occupied tile.
  await position(page, 8, 5);
  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toContainText(/heal|story|script/i);
  await expect(page.locator('#dialogue-text')).not.toContainText('looking great');
  await page.screenshot({ path: 'reports/mom-preview-browser.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await position(page, 8, 5);
});

test('walking is the default, Shift runs outdoors, and the house enforces walking', async ({ page }) => {
  test.setTimeout(45_000);
  await start(page);
  await page.evaluate(() => {
    const runtime = window as unknown as ProbeWindow;
    runtime.measuredSteps = [];
    const screen = document.getElementById('game')!;
    let active: { started: number; mode: string; frames: number } | undefined;
    new MutationObserver(() => {
      if (screen.dataset.moving === 'true' && !active) active = {
        started: performance.now(), mode: screen.dataset.movementMode ?? '', frames: Number(screen.dataset.stepDurationFrames),
      };
      else if (screen.dataset.moving === 'false' && active) {
        runtime.measuredSteps.push({ milliseconds: performance.now() - active.started, mode: active.mode, frames: active.frames });
        active = undefined;
      }
    }).observe(screen, { attributes: true, attributeFilter: ['data-moving'] });
  });
  await step(page, 'ArrowUp', 3);
  const walk = await page.evaluate(() => (window as unknown as ProbeWindow).measuredSteps);
  await page.getByRole('button', { name: 'Reset position' }).click();
  await page.evaluate(() => { (window as unknown as ProbeWindow).measuredSteps = []; });
  await page.keyboard.down('Shift');
  await step(page, 'ArrowUp', 3);
  await page.keyboard.up('Shift');
  const run = await page.evaluate(() => (window as unknown as ProbeWindow).measuredSteps);
  await page.evaluate(() => { (window as unknown as ProbeWindow).measuredSteps = []; });
  await step(page, 'ArrowUp', 3);
  const released = await page.evaluate(() => (window as unknown as ProbeWindow).measuredSteps);

  await page.getByRole('button', { name: 'Reset position' }).click();
  await step(page, 'ArrowUp', 4);
  await step(page, 'ArrowLeft', 4);
  await step(page, 'ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-map-id', 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F');
  await page.evaluate(() => { (window as unknown as ProbeWindow).measuredSteps = []; });
  await page.keyboard.down('Shift');
  await step(page, 'ArrowUp', 3);
  await page.keyboard.up('Shift');
  const indoor = await page.evaluate(() => (window as unknown as ProbeWindow).measuredSteps);
  const median = (samples: MeasuredStep[]) => samples.map(sample => sample.milliseconds).sort((a, b) => a - b)[1]!;
  await writeFile('reports/preview-movement-speeds.json', JSON.stringify({ checkedAt: new Date().toISOString(), run, walk, released, indoor }, null, 2));
  expect(run).toHaveLength(3); expect(walk).toHaveLength(3); expect(released).toHaveLength(3); expect(indoor).toHaveLength(3);
  expect(run.every(sample => sample.mode === 'run' && sample.frames === 8)).toBe(true);
  expect([...walk, ...released, ...indoor].every(sample => sample.mode === 'walk' && sample.frames === 16)).toBe(true);
  expect(median(walk)).toBeGreaterThan(median(run) * 1.5);
  expect(median(walk)).toBeLessThan(median(run) * 2.6);
  expect(median(indoor)).toBeGreaterThan(median(walk) * 0.7);
  expect(median(indoor)).toBeLessThan(median(walk) * 1.4);
});
