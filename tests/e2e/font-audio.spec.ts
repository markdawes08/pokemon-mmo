import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

interface GlyphDraw { image: string; coordinates: number[] }
interface DialogueFont {
  image: string;
  glyphs: Record<string, { code: number; x: number; y: number; width: number; height: number; advance: number }>;
}
type FontProbeWindow = Window & { glyphDraws: GlyphDraw[] };
interface ObservedSound {
  node: AudioScheduledSourceNode;
  started: boolean;
  ended: boolean;
  stopAt: number | null;
}
interface SoundProbe {
  contexts: AudioContext[]; sources: ObservedSound[]; gains: GainNode[]; analysers: AnalyserNode[];
  focusEvents: { type: string; trusted: boolean }[];
}
type SoundProbeWindow = Window & { AudioContext: typeof AudioContext; soundProbe: SoundProbe };

async function observeNativeAudio(page: Page) {
  await page.addInitScript(() => {
    const runtime = window as unknown as SoundProbeWindow;
    const probe: SoundProbe = { contexts: [], sources: [], gains: [], analysers: [], focusEvents: [] };
    runtime.soundProbe = probe;
    for (const type of ['focus', 'blur']) window.addEventListener(type, event => {
      probe.focusEvents.push({ type: event.type, trusted: event.isTrusted });
    });
    const NativeContext = runtime.AudioContext;
    runtime.AudioContext = new Proxy(NativeContext, {
      construct(target, args) {
        const context = Reflect.construct(target, args) as AudioContext;
        probe.contexts.push(context);
        return context;
      },
    });
    function observe<T extends AudioScheduledSourceNode>(node: T): T {
      const observed: ObservedSound = { node, started: false, ended: false, stopAt: null };
      probe.sources.push(observed);
      const start = node.start, stop = node.stop;
      node.start = ((...args: number[]) => { Reflect.apply(start, node, args); observed.started = true; }) as typeof start;
      node.stop = ((...args: number[]) => {
        Reflect.apply(stop, node, args);
        observed.stopAt = args[0] ?? node.context.currentTime;
      }) as typeof stop;
      node.addEventListener('ended', () => { observed.ended = true; });
      return node;
    }
    const createBuffer = NativeContext.prototype.createBufferSource;
    NativeContext.prototype.createBufferSource = function () { return observe(createBuffer.call(this)); };
    const createOscillator = NativeContext.prototype.createOscillator;
    NativeContext.prototype.createOscillator = function () { return observe(createOscillator.call(this)); };
    const createGain = NativeContext.prototype.createGain;
    NativeContext.prototype.createGain = function () {
      const gain = createGain.call(this); probe.gains.push(gain); return gain;
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: (AudioNode | AudioParam | number)[]) {
      const result = Reflect.apply(connect, this, args);
      if (args[0] === this.context.destination) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        Reflect.apply(connect, this, [analyser]); probe.analysers.push(analyser);
      }
      return result;
    } as typeof connect;
  });
}

async function measureOutput(page: Page, milliseconds = 500) {
  return page.evaluate(async ({ duration, timeout }) => {
    const probe = (window as unknown as SoundProbeWindow).soundProbe;
    let maxRms = 0, peak = 0, nonFinite = 0, observations = 0;
    const clocks = probe.contexts.map(context => ({ context, started: context.currentTime }));
    const started = performance.now();
    let audioElapsed = 0;
    // Source.start() records a scheduled attack; it does not establish that the
    // native graph has rendered it yet. Observe the same uninterrupted playback
    // until real audio-clock progress AND signal are present, with a hard bound.
    // Keep every sample's non-finite/clipping evidence throughout that interval.
    while (performance.now() - started < timeout) {
      for (const analyser of probe.analysers) {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        let squareSum = 0;
        for (const sample of samples) {
          if (!Number.isFinite(sample)) { nonFinite++; continue; }
          squareSum += sample * sample; peak = Math.max(peak, Math.abs(sample));
        }
        maxRms = Math.max(maxRms, Math.sqrt(squareSum / samples.length)); observations++;
      }
      audioElapsed = clocks.length ? Math.min(...clocks.map(({ context, started }) => context.currentTime - started)) : 0;
      if (performance.now() - started >= duration && audioElapsed * 1000 >= duration && maxRms > 0.00001) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return {
      maxRms, peak, nonFinite, observations, audioElapsed, wallElapsed: (performance.now() - started) / 1000,
      contexts: clocks.map(({ context, started }) => ({ started, ended: context.currentTime, state: context.state })),
    };
  }, { duration: milliseconds, timeout: 10_000 });
}

async function audioState(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as SoundProbeWindow).soundProbe;
    return {
      contexts: probe.contexts.map(context => context.state),
      started: probe.sources.filter(source => source.started).length,
      pending: probe.sources.filter(source => source.started && !source.ended &&
        (source.stopAt === null || source.stopAt > source.node.context.currentTime + 0.01)).length,
      gains: probe.gains.map(gain => gain.gain.value),
      focusEvents: probe.focusEvents,
    };
  });
}

async function step(page: Page, key: string, count = 1) {
  for (let index = 0; index < count; index++) {
    const screen = page.locator('#game');
    const serial = Number(await screen.getAttribute('data-step-serial'));
    await page.keyboard.press(key);
    await expect.poll(async () => Number(await screen.getAttribute('data-step-serial'))).toBeGreaterThan(serial);
    await expect(screen).toHaveAttribute('data-moving', 'false');
    await expect(screen).toHaveAttribute('data-transitioning', 'false');
  }
}

test('dialogue draws source atlas pixels including the accented POKéMON glyph', async ({ page }) => {
  await page.addInitScript(() => {
    const runtime = window as unknown as FontProbeWindow;
    runtime.glyphDraws = [];
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...coordinates: number[]) {
      if (this.canvas.id === 'dialogue-bitmap' && image instanceof HTMLImageElement) {
        runtime.glyphDraws.push({ image: image.src, coordinates });
      }
      Reflect.apply(drawImage, this, [image, ...coordinates]);
    } as typeof drawImage;
  });
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#game').click();
  await step(page, 'ArrowDown', 2);
  await step(page, 'ArrowRight', 2);
  await step(page, 'ArrowDown', 3);
  await step(page, 'ArrowRight');
  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toHaveText('Technology is incredible!');
  await page.evaluate(() => { (window as unknown as FontProbeWindow).glyphDraws = []; });
  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toContainText('POKéMON');
  await expect(page.locator('#dialogue-bitmap')).toBeVisible();

  const rendered = await page.evaluate(async () => {
    const runtime = window as unknown as FontProbeWindow;
    const font = await fetch('/content/fonts/dialogue.json').then(response => response.json()) as DialogueFont;
    const actual = document.querySelector<HTMLCanvasElement>('#dialogue-bitmap')!;
    const expected = document.createElement('canvas'); expected.width = actual.width; expected.height = actual.height;
    const expectedContext = expected.getContext('2d')!;
    const atlas = new Image(); atlas.src = font.image; await atlas.decode();
    for (const { coordinates } of runtime.glyphDraws) Reflect.apply(expectedContext.drawImage, expectedContext, [atlas, ...coordinates]);
    const actualPixels = actual.getContext('2d')!.getImageData(0, 0, actual.width, actual.height).data;
    const expectedPixels = expectedContext.getImageData(0, 0, expected.width, expected.height).data;
    let inkPixels = 0, mismatchedPixels = 0;
    for (let offset = 0; offset < expectedPixels.length; offset += 4) {
      if (expectedPixels[offset + 3] === 0) continue;
      inkPixels++;
      if ([0, 1, 2, 3].some(channel => expectedPixels[offset + channel] !== actualPixels[offset + channel])) mismatchedPixels++;
    }
    const accented = font.glyphs['é']!;
    const accentDraws = runtime.glyphDraws.filter(draw => draw.coordinates[0] === accented.x && draw.coordinates[1] === accented.y);
    return {
      width: actual.width, height: actual.height, inkPixels, mismatchedPixels,
      imageRendering: getComputedStyle(actual).imageRendering,
      atlasPaths: [...new Set(runtime.glyphDraws.map(draw => new URL(draw.image).pathname))],
      glyphDraws: runtime.glyphDraws.length, accentDraws: accentDraws.length, accented,
    };
  });
  expect(rendered.atlasPaths).toEqual(['/content/fonts/dialogue.png']);
  expect(rendered.glyphDraws).toBeGreaterThan(40);
  expect(rendered.accentDraws).toBeGreaterThan(0);
  expect(rendered.accented).toMatchObject({ code: 27, x: 176, y: 16, width: 6, height: 14, advance: 6 });
  expect(rendered.inkPixels).toBeGreaterThan(100);
  expect(rendered.mismatchedPixels).toBe(0);
  expect(rendered.imageRendering).toBe('pixelated');
  await page.screenshot({ path: 'reports/dialogue-font-browser.png', fullPage: true });
  const layouts = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 650, height: 720 }]) {
    await page.setViewportSize(viewport);
    // Viewport acknowledgement can precede the application's resize event.
    // Wait for both game surfaces, then take one coherent layout snapshot.
    await expect.poll(() => page.evaluate(() => {
      const game = document.getElementById('game')!;
      const scale = Number(getComputedStyle(game).getPropertyValue('--pixel-scale'));
      const screen = game.getBoundingClientRect();
      const canvas = game.querySelector(':scope > canvas')!.getBoundingClientRect();
      return Number.isInteger(scale) && scale > 0 && screen.width === 240 * scale &&
        screen.height === 160 * scale && canvas.width === 240 * scale && canvas.height === 160 * scale;
    })).toBe(true);
    const { screen, panel, bitmap, canvas, cssScale } = await page.evaluate(() => {
      const rect = (selector: string) => {
        const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        screen: rect('#game'), panel: rect('#dialogue'), bitmap: rect('#dialogue-bitmap'), canvas: rect('#game > canvas'),
        cssScale: Number(getComputedStyle(document.getElementById('game')!).getPropertyValue('--pixel-scale')),
      };
    });
    expect(bitmap.x).toBeGreaterThanOrEqual(screen.x);
    expect(bitmap.x + bitmap.width).toBeLessThanOrEqual(screen.x + screen.width);
    expect(panel.y).toBeGreaterThanOrEqual(screen.y);
    expect(panel.y + panel.height).toBeLessThanOrEqual(screen.y + screen.height);
    expect(Number.isInteger(bitmap.width / rendered.width)).toBe(true);
    expect(bitmap.width / rendered.width).toBeGreaterThan(0);
    expect(bitmap.width / rendered.width).toBe(screen.width / 240);
    expect(canvas.width).toBe(screen.width);
    expect(bitmap.width / rendered.width).toBe(cssScale);
    layouts.push({ viewport, screen, panel, bitmap, canvas, scale: bitmap.width / rendered.width });
  }
  await page.screenshot({ path: 'reports/dialogue-font-browser-small.png', fullPage: true });
  await writeFile('reports/dialogue-font-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), ...rendered, layouts }, null, 2));
});

for (const asset of ['dialogue.json', 'dialogue.png']) {
  test(`a missing source font ${asset} gives an actionable rebuild error`, async ({ page }) => {
    await page.route(`**/content/fonts/${asset}`, route => route.fulfill({ status: 404, body: 'Missing' }));
    await page.goto('/');
    await expect(page.locator('#game')).toContainText(/font|glyph/i);
    await expect(page.locator('#game')).toContainText(/content:build|rebuild/i);
    await expect(page.locator('#game')).not.toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#game > canvas')).toHaveCount(0);
  });
}

test('sound is opt-in, adjusts volume, and pauses for mute, visibility and window focus', async ({ page }) => {
  await observeNativeAudio(page);
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const sound = page.locator('#sound');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  expect((await audioState(page)).contexts).toEqual([]);
  expect((await audioState(page)).started).toBe(0);

  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(0);
  const enabled = await audioState(page);
  expect(enabled.contexts).toEqual(['running']);
  const musicOutput = await measureOutput(page);
  expect(musicOutput.observations).toBeGreaterThan(0);
  expect(musicOutput.audioElapsed).toBeGreaterThanOrEqual(0.5);
  expect(musicOutput.nonFinite).toBe(0);
  expect(musicOutput.maxRms).toBeGreaterThan(0.00001);
  expect(musicOutput.peak).toBeLessThanOrEqual(1.05);
  const volume = page.locator('#volume');
  await volume.focus(); await volume.press('Home');
  await expect(volume).toHaveValue('0');
  await expect.poll(async () => Math.abs((await audioState(page)).gains[0]!)).toBeLessThan(0.0001);
  await volume.press('End');
  await expect(volume).toHaveValue('100');
  await expect.poll(async () => (await audioState(page)).gains[0]!).toBeGreaterThan(0);

  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  const muted = await audioState(page);
  await page.waitForTimeout(250);
  expect((await audioState(page)).started).toBe(muted.started);
  await sound.click();
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(muted.started);

  // Inject the browser visibility event, but inspect the real native audio
  // nodes/context; this neither substitutes an audio engine nor simulates sound.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  const hidden = await audioState(page);
  await page.waitForTimeout(250);
  expect((await audioState(page)).started).toBe(hidden.started);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden'); Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(hidden.started);
  expect((await audioState(page)).contexts).toEqual(['running']);

  // Headless Chromium keeps these test tabs focused even after disabling focus
  // emulation. Exercise the window handlers explicitly and inspect real audio
  // suspension; OS/browser tab focus delivery remains outside this fixture.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  await expect.poll(async () => (await audioState(page)).contexts).toEqual(['suspended']);
  const blurred = await audioState(page);
  expect(blurred.focusEvents).toContainEqual({ type: 'blur', trusted: false });
  await page.waitForTimeout(250);
  expect((await audioState(page)).started).toBe(blurred.started);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(blurred.started);
  expect((await audioState(page)).contexts).toEqual(['running']);
  expect((await audioState(page)).focusEvents).toContainEqual({ type: 'focus', trusted: false });

  // Repeated off/on cycles must stop every previously scheduled voice and reuse
  // the same unlocked context, rather than leave old scores running underneath.
  for (let repeat = 0; repeat < 2; repeat++) {
    await sound.click();
    await expect.poll(async () => (await audioState(page)).pending).toBe(0);
    const stopped = (await audioState(page)).started;
    await sound.click();
    await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(stopped);
    expect((await audioState(page)).contexts).toEqual(['running']);
  }
  await sound.click();
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  await writeFile('reports/audio-lifecycle-browser.json', JSON.stringify({
    checkedAt: new Date().toISOString(),
    scope: 'Passive native AudioContext/source observation; synthetic visibilitychange and window blur/focus events. OS/tab event delivery is not verified.',
    enabled, muted, hidden, blurred, musicOutput, final: await audioState(page),
  }, null, 2));
});

test('Route 1 stops unsupported music and dialogue plays exactly one source SELECT effect', async ({ page }) => {
  test.setTimeout(45_000);
  await observeNativeAudio(page);
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#sound').click();
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(0);
  await page.locator('#game').click();
  await page.keyboard.down('Shift');
  await step(page, 'ArrowRight', 2);
  await step(page, 'ArrowUp', 13);
  await expect(page.locator('#game')).toHaveAttribute('data-map-id', 'MAP_ROUTE1');
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  await step(page, 'ArrowUp', 7);
  await step(page, 'ArrowLeft', 3);
  await step(page, 'ArrowUp'); // Face the sign at (9,31).
  await page.keyboard.up('Shift');
  await expect(page.locator('#game')).toHaveAttribute('data-tile-x', '9');
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', '32');
  const before = (await audioState(page)).started;
  const effectOutputPromise = measureOutput(page);
  await page.keyboard.down('e');
  await expect(page.locator('#dialogue-text')).toContainText('ROUTE 1');
  await expect.poll(async () => (await audioState(page)).started).toBe(before + 5);
  await page.keyboard.down('e'); // Repeated held interaction must not replay SELECT.
  await page.keyboard.up('e');
  await page.waitForTimeout(250);
  expect((await audioState(page)).started).toBe(before + 5);
  const effectOutput = await effectOutputPromise;
  expect(effectOutput.observations).toBeGreaterThan(0);
  expect(effectOutput.audioElapsed).toBeGreaterThanOrEqual(0.5);
  expect(effectOutput.nonFinite).toBe(0);
  expect(effectOutput.maxRms).toBeGreaterThan(0.00001);
  expect(effectOutput.peak).toBeLessThanOrEqual(1.05);
  await expect.poll(async () => (await audioState(page)).pending).toBe(0);
  await page.keyboard.press('Escape');
  await page.locator('#sound').click();
  await page.locator('#game').click();
  await page.keyboard.press('e');
  await expect(page.locator('#dialogue-text')).toContainText('ROUTE 1');
  expect((await audioState(page)).started).toBe(before + 5);
  await writeFile('reports/audio-select-browser.json', JSON.stringify({
    checkedAt: new Date().toISOString(), sourceSoundEffect: 'SE_SELECT',
    expectedNotesPerEffect: 5, startedBySign: (await audioState(page)).started - before,
    repeatedKeyAddedNotes: 0, mutedInteractionAddedNotes: 0, effectOutput,
  }, null, 2));
});

test('missing optional audio reports a recoverable error without disabling movement', async ({ page }) => {
  await observeNativeAudio(page);
  await page.route('**/content/audio/preview.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#sound').click();
  await expect(page.locator('#sound')).toHaveText('Retry sound');
  await expect(page.locator('#message')).toContainText(/audio|sound/i);
  await expect(page.locator('#message')).toContainText(/rebuild|retry|content:build/i);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#game').click();
  await step(page, 'ArrowDown');
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', '13');
  await page.unroute('**/content/audio/preview.json');
  await page.locator('#sound').click();
  await expect.poll(async () => (await audioState(page)).started).toBeGreaterThan(0);
  await expect(page.locator('#sound')).toHaveText('Sound on');
});
