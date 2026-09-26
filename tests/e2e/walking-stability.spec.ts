import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';

interface RenderSample {
  left: number; right: number; top: number; bottom: number;
  worldX: number; worldY: number; cameraX: number; cameraY: number;
  lift: number; frame: string; time: number; moving: boolean; stepSerial: number;
}
type SpriteRenderer = (renderer: Phaser.Renderer.WebGL.WebGLRenderer, sprite: Phaser.GameObjects.Sprite,
  camera: Phaser.Cameras.Scene2D.Camera, parentMatrix: Phaser.GameObjects.Components.TransformMatrix) => void;
type ProbeWindow = Window & { Phaser: typeof Phaser; walkingRenderSamples: RenderSample[] };

async function observePlayerRendering(page: Page) {
  await page.evaluate(() => {
    const runtime = window as unknown as ProbeWindow;
    runtime.walkingRenderSamples = [];
    // Phaser exposes its namespace in the installed browser build. Observe the
    // vertices actually submitted for the player, after container/camera rounding.
    // This test-only wrapper neither moves objects nor changes rendered values.
    const prototype = runtime.Phaser.GameObjects.Sprite.prototype as Phaser.GameObjects.Sprite & { renderWebGL: SpriteRenderer };
    const render = prototype.renderWebGL;
    prototype.renderWebGL = function (renderer, sprite, camera, parentMatrix) {
      if (sprite.texture.key !== 'player') return render.call(this, renderer, sprite, camera, parentMatrix);
      const pipeline = sprite.pipeline;
      const batch = pipeline.batchQuad;
      pipeline.batchQuad = function (...args: Parameters<typeof batch>) {
        if (args[0] === sprite) {
          const xs = [args[1], args[3], args[5], args[7]], ys = [args[2], args[4], args[6], args[8]];
          runtime.walkingRenderSamples.push({
            left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
            worldX: sprite.parentContainer?.x ?? sprite.x, worldY: sprite.parentContainer?.y ?? sprite.y,
            cameraX: camera.scrollX, cameraY: camera.scrollY, lift: sprite.y,
            frame: String(sprite.frame.name), time: performance.now(),
            moving: document.getElementById('game')?.dataset.moving === 'true',
            stepSerial: Number(document.getElementById('game')?.dataset.stepSerial),
          });
        }
        return batch.apply(this, args);
      };
      try { render.call(this, renderer, sprite, camera, parentMatrix); }
      finally { pipeline.batchQuad = batch; }
    };
  });
}

async function step(page: Page, key: string) {
  const screen = page.locator('#game');
  const previous = Number(await screen.getAttribute('data-step-serial'));
  await page.keyboard.press(key);
  await expect.poll(async () => Number(await screen.getAttribute('data-step-serial'))).toBeGreaterThan(previous);
  await expect(screen).toHaveAttribute('data-moving', 'false');
}

function spread(samples: RenderSample[], key: keyof Pick<RenderSample, 'left' | 'right' | 'top' | 'bottom' | 'cameraX' | 'cameraY'>) {
  return Math.max(...samples.map(sample => sample[key])) - Math.min(...samples.map(sample => sample[key]));
}
function stepStarts(samples: RenderSample[]) {
  return samples.filter((sample, index) => index === 0 || sample.stepSerial !== samples[index - 1]!.stepSerial);
}

for (const mode of ['walk', 'run'] as const) test(`the rendered player stays steady in all four directions (${mode})`, async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await observePlayerRendering(page);
  const observations: { direction: string; samples: RenderSample[] }[] = [];

  for (const direction of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await page.getByRole('button', { name: 'Reset position' }).click();
    await expect(screen).toBeFocused();
    // The east side of the spawn is a building; reach the clear southern path
    // through ordinary controls before sampling sustained rightward movement.
    if (direction === 'ArrowRight') { await step(page, 'ArrowDown'); await step(page, 'ArrowDown'); }
    if (mode === 'run') await page.keyboard.down('Shift');
    await page.evaluate(() => { (window as unknown as ProbeWindow).walkingRenderSamples = []; });
    await page.keyboard.down(direction);
    await page.waitForTimeout(1000);
    await page.keyboard.up(direction);
    await expect(screen).toHaveAttribute('data-moving', 'false');
    if (mode === 'run') await page.keyboard.up('Shift');
    const samples = await page.evaluate(() => (window as unknown as ProbeWindow).walkingRenderSamples.filter(sample => sample.moving));
    observations.push({ direction, samples });
  }

  await writeFile(mode === 'walk' ? process.env.WALKING_STABILITY_REPORT ?? 'reports/walking-stability.json' : 'reports/running-stability.json', JSON.stringify({
    checkedAt: new Date().toISOString(),
    mode,
    scope: 'Actual player WebGL quad vertices during focused keyboard movement; test-only passive renderer instrumentation',
    observations: observations.map(({ direction, samples }) => ({
      direction, movingRenderFrames: samples.length,
      renderedBounds: [...new Set(samples.map(({ left, right, top, bottom }) => `${left},${top},${right},${bottom}`))],
      animationFrames: [...new Set(samples.map(sample => sample.frame))],
      firstFramesByStep: stepStarts(samples).map(sample => sample.frame),
      cameraTravel: { x: spread(samples, 'cameraX'), y: spread(samples, 'cameraY') },
      fractionalAnchorSamples: samples.filter(sample => !Number.isInteger(sample.worldX) || !Number.isInteger(sample.worldY)).length,
      sampleIntervalMs: samples.slice(1).reduce((range, sample, index) => {
        const delta = sample.time - samples[index]!.time;
        return { min: Math.min(range.min, delta), max: Math.max(range.max, delta) };
      }, { min: Number.MAX_VALUE, max: 0 }),
    })),
  }, null, 2));

  for (const { direction, samples } of observations) {
    expect(samples.length, `${direction}: enough rendered movement frames`).toBeGreaterThan(20);
    expect(new Set(samples.map(sample => sample.frame)).size, `${direction}: walking animation remains active`).toBeGreaterThan(1);
    if (mode === 'run') expect(samples.some(sample => Number(sample.frame) >= 9), `${direction}: source running frames are rendered`).toBe(true);
    if (mode === 'walk') {
      // Source Go animations alternate the leading leg every16-frame tile.
      // Inspect the first actual rendered frame, where a phase-reset hitch hid
      // despite correct later frames and perfectly stable quad coordinates.
      const legs: Record<string, string[]> = { ArrowUp: ['5', '6'], ArrowDown: ['3', '4'], ArrowLeft: ['7', '8'], ArrowRight: ['7', '8'] };
      const starts = stepStarts(samples).map(sample => sample.frame);
      expect(starts.length, `${direction}: multiple complete stride starts`).toBeGreaterThan(2);
      for (let index = 0; index < starts.length; index++) {
        expect(legs[direction], `${direction}: first rendered frame is a source stride pose`).toContain(starts[index]);
        if (index > 0) expect(starts[index], `${direction}: leading leg alternates at tile boundaries`).not.toBe(starts[index - 1]);
      }
    }
    expect(Math.max(spread(samples, 'cameraX'), spread(samples, 'cameraY')), `${direction}: camera follows sustained movement`).toBeGreaterThan(32);
    expect(spread(samples, 'left'), `${direction}: horizontal player quad wobble`).toBe(0);
    expect(spread(samples, 'right'), `${direction}: horizontal player quad wobble`).toBe(0);
    expect(spread(samples, 'top'), `${direction}: vertical player quad wobble`).toBe(0);
    expect(spread(samples, 'bottom'), `${direction}: vertical player quad wobble`).toBe(0);
    expect(samples.every(sample => sample.right - sample.left === 16 && sample.bottom - sample.top === 32)).toBe(true);
  }
});

test('ledge lift moves the sprite while its camera follows the ground position', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await screen.click();
  // Reach the real Route 1 ledge through normal controls; no test teleport.
  for (const [key, count] of [
    ['ArrowRight', 2], ['ArrowUp', 20], ['ArrowLeft', 6], ['ArrowUp', 2], ['ArrowRight', 6],
  ] as const) for (let index = 0; index < count; index++) await step(page, key);
  await expect(screen).toHaveAttribute('data-map-id', 'MAP_ROUTE1');
  await expect(screen).toHaveAttribute('data-tile-x', '12');
  await expect(screen).toHaveAttribute('data-tile-y', '30');

  await observePlayerRendering(page);
  await step(page, 'ArrowDown');
  const samples = await page.evaluate(() => (window as unknown as ProbeWindow).walkingRenderSamples.filter(sample => sample.moving));
  await writeFile('reports/ledge-camera-stability.json', JSON.stringify({
    checkedAt: new Date().toISOString(), movingRenderFrames: samples.length,
    renderedLeftEdges: [...new Set(samples.map(sample => sample.left))],
    renderedGroundBottoms: [...new Set(samples.map(sample => sample.bottom - sample.lift))],
    spriteLiftPixels: [...new Set(samples.map(sample => sample.lift))],
    cameraTravelY: spread(samples, 'cameraY'),
  }, null, 2));
  expect(samples.length).toBeGreaterThan(10);
  expect(spread(samples, 'left')).toBe(0);
  expect(new Set(samples.map(sample => sample.bottom - sample.lift)).size, 'camera tracks the ground, not the jumping sprite').toBe(1);
  expect(Math.min(...samples.map(sample => sample.lift)), 'source high-jump peak remains visible').toBe(-12);
  expect(spread(samples, 'top'), 'the sprite actually lifts above its walking baseline').toBeGreaterThanOrEqual(10);
  expect(spread(samples, 'cameraY'), 'camera follows the two-tile ground movement').toBeGreaterThan(24);
  await expect(screen).toHaveAttribute('data-tile-y', '32');
});
