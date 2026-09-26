import type { Page } from '@playwright/test';
import type Phaser from 'phaser';

export interface WorldRenderSample { x: number; y: number; time: number }
type SpriteRenderer = (renderer: Phaser.Renderer.WebGL.WebGLRenderer, sprite: Phaser.GameObjects.Sprite,
  camera: Phaser.Cameras.Scene2D.Camera, parentMatrix: Phaser.GameObjects.Components.TransformMatrix) => void;
type ProbeWindow = Window & { Phaser: typeof Phaser; worldRenderSamples: WorldRenderSample[] };

/** Preserve frame ordering and content while applying modest variable delivery latency. */
export async function delayWorldFrames(page: Page) {
  await page.addInitScript(() => {
    // Keep the native socket and its browser Origin/cookie handshake. Only defer
    // delivery to the installed SDK's onmessage handler after the real network read.
    const native = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true, enumerable: native.enumerable, get: native.get,
      set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        let ordinal = 0, delivery = 0;
        if (!handler || !new URL(this.url).pathname.startsWith('/socket/')) { native.set!.call(this, handler); return; }
        native.set!.call(this, (event: MessageEvent) => {
          delivery = Math.max(delivery + 1, performance.now() + [0, 15, 70, 25][ordinal++ % 4]!);
          setTimeout(() => { if (this.readyState === WebSocket.OPEN) handler.call(this, event); }, Math.max(0, delivery - performance.now()));
        });
      },
    });
  });
}

export async function observeWorldRendering(page: Page) {
  await page.evaluate(() => {
    const runtime = window as unknown as ProbeWindow; runtime.worldRenderSamples = [];
    const prototype = runtime.Phaser.GameObjects.Sprite.prototype as Phaser.GameObjects.Sprite & { renderWebGL: SpriteRenderer };
    const render = prototype.renderWebGL;
    prototype.renderWebGL = function (renderer, sprite, camera, parentMatrix) {
      // Only the local player has the camera-follow container. Never alter sprite or camera values.
      if (sprite.texture.key === 'player' && sprite.parentContainer) {
        runtime.worldRenderSamples.push({ x: sprite.parentContainer.x, y: sprite.parentContainer.y, time: performance.now() });
      }
      render.call(this, renderer, sprite, camera, parentMatrix);
    };
  });
}

export const worldRenderSamples = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).worldRenderSamples);
