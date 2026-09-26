import type { Page } from '@playwright/test';

interface SaveProbe {
  mode: 'busy' | 'invalid' | 'stall' | null; frames: number[][]; hello: number[] | null;
  busyErrors: number; invalidErrors: number; suppressIncoming: boolean; stalledMessages: number;
}
type ProbeWindow = Window & { worldSaveProbe: SaveProbe };

/** Exercise actual room backpressure and validation through the unchanged native socket. */
export async function observeSaveRetries(page: Page) {
  await page.addInitScript(() => {
    const state: SaveProbe = { mode: null, frames: [], hello: null, busyErrors: 0, invalidErrors: 0, suppressIncoming: false, stalledMessages: 0 };
    (window as unknown as ProbeWindow).worldSaveProbe = state;
    const native = WebSocket.prototype.send, observed = new WeakSet<WebSocket>();
    const onmessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true, enumerable: onmessage.enumerable, get: onmessage.get,
      set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        if (!handler) { onmessage.set!.call(this, handler); return; }
        onmessage.set!.call(this, (event: MessageEvent) => {
          if (state.suppressIncoming && new URL(this.url).pathname.startsWith('/socket/')) { state.stalledMessages++; return; }
          handler.call(this, event);
        });
      },
    });
    WebSocket.prototype.send = function (data) {
      if (!new URL(this.url).pathname.startsWith('/socket/')) return native.call(this, data);
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener('message', event => {
          if (!(event.data instanceof ArrayBuffer)) return;
          const text = new TextDecoder().decode(event.data);
          if (text.includes('BUSY')) state.busyErrors++;
          if (text.includes('INVALID_MESSAGE')) state.invalidErrors++;
        });
      }
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data)
          : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes) return native.call(this, data);
      const text = new TextDecoder().decode(bytes);
      if (text.includes('hello')) state.hello = Array.from(bytes);
      if (!text.includes('save-profile')) return native.call(this, data);
      const outgoing = bytes.slice();
      if (state.mode === 'stall') {
        // Induced client delivery stall only: the real server remains connected.
        // Hold the outgoing Save and discard incoming SDK delivery until watchdog cleanup.
        state.suppressIncoming = true; state.frames.push(Array.from(outgoing)); return;
      }
      if (state.mode === 'busy') {
        state.mode = null;
        if (!state.hello) throw new Error('A real authenticated hello is required before the Save BUSY probe.');
        // Two ordered commands arrive together. Real hello auth/heartbeat work
        // owns the room while Save arrives, so the server returns its own BUSY.
        native.call(this, new Uint8Array(state.hello));
      } else if (state.mode === 'invalid') {
        // Keep corruption armed across any legitimate BUSY retries. The assertion
        // checks that retries cease after the definitive INVALID_MESSAGE response.
        const target = new TextEncoder().encode('save-profile');
        for (let index = 0; index <= outgoing.length - target.length; index++) {
          if (target.every((byte, offset) => outgoing[index + offset] === byte)) { outgoing[index + target.length - 1] = 'x'.charCodeAt(0); break; }
        }
      }
      state.frames.push(Array.from(outgoing));
      return native.call(this, outgoing);
    };
  });
}

export async function armSaveProbe(page: Page, mode: 'busy' | 'invalid' | 'stall') {
  await page.evaluate(next => {
    const state = (window as unknown as ProbeWindow).worldSaveProbe;
    state.mode = next; state.frames = []; state.busyErrors = 0; state.invalidErrors = 0; state.suppressIncoming = false; state.stalledMessages = 0;
  }, mode);
}
export const saveProbe = (page: Page) => page.evaluate(() => {
  const { frames, busyErrors, invalidErrors, stalledMessages } = (window as unknown as ProbeWindow).worldSaveProbe;
  return { frames, busyErrors, invalidErrors, stalledMessages };
});
