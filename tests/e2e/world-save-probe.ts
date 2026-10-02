import type { Page } from '@playwright/test';
import { Protocol } from '@colyseus/sdk';
import { decode } from '@colyseus/schema';
import { unpack } from 'msgpackr';
import { saveProfileCommandSchema } from '@pokewaterblue/protocol';

interface SaveProbe {
  mode: 'busy' | 'invalid' | 'stall' | 'stale' | null; frames: number[][]; hello: number[] | null;
  busyErrors: number; invalidErrors: number; staleErrors: number; suppressIncoming: boolean; stalledMessages: number;
  releaseHeldSave: (() => void) | null;
  holdMovement: boolean; releaseHeldMovement: (() => void) | null;
}
type ProbeWindow = Window & { worldSaveProbe: SaveProbe };

/** Exercise actual room backpressure and validation through the unchanged native socket. */
export async function observeSaveRetries(page: Page) {
  await page.addInitScript(() => {
    const state: SaveProbe = { mode: null, frames: [], hello: null, busyErrors: 0, invalidErrors: 0, staleErrors: 0,
      suppressIncoming: false, stalledMessages: 0, releaseHeldSave: null, holdMovement: false, releaseHeldMovement: null };
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
          if (text.includes('STALE_REVISION')) state.staleErrors++;
        });
      }
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data)
          : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes) return native.call(this, data);
      const text = new TextDecoder().decode(bytes);
      if (text.includes('hello')) state.hello = Array.from(bytes);
      if (state.holdMovement && text.includes('world-input')) {
        state.holdMovement = false;
        const input = bytes.slice(); state.releaseHeldMovement = () => native.call(this, input); return;
      }
      if (!text.includes('save-profile')) return native.call(this, data);
      const outgoing = bytes.slice();
      if (state.mode === 'stale') {
        // Hold the actual command while a real periodic world checkpoint
        // commits. Releasing the unchanged bytes must receive a real STALE.
        state.mode = null; state.frames.push(Array.from(outgoing));
        state.releaseHeldSave = () => native.call(this, outgoing); return;
      }
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

export async function armSaveProbe(page: Page, mode: 'busy' | 'invalid' | 'stall' | 'stale') {
  await page.evaluate(next => {
    const state = (window as unknown as ProbeWindow).worldSaveProbe;
    state.mode = next; state.frames = []; state.busyErrors = 0; state.invalidErrors = 0; state.staleErrors = 0;
    state.suppressIncoming = false; state.stalledMessages = 0; state.releaseHeldSave = null;
  }, mode);
}
export const saveProbe = (page: Page) => page.evaluate(() => {
  const { frames, busyErrors, invalidErrors, staleErrors, stalledMessages } = (window as unknown as ProbeWindow).worldSaveProbe;
  return { frames, busyErrors, invalidErrors, staleErrors, stalledMessages };
});

export async function releaseHeldSave(page: Page) {
  await page.evaluate(() => {
    const state = (window as unknown as ProbeWindow).worldSaveProbe, release = state.releaseHeldSave;
    if (!release) throw new Error('No Save is held.');
    state.releaseHeldSave = null; release();
  });
}

export async function holdNextMovement(page: Page) {
  await page.evaluate(() => { (window as unknown as ProbeWindow).worldSaveProbe.holdMovement = true; });
}
export async function releaseHeldMovement(page: Page) {
  await page.evaluate(() => {
    const state = (window as unknown as ProbeWindow).worldSaveProbe, release = state.releaseHeldMovement;
    if (!release) throw new Error('No movement is held.');
    state.releaseHeldMovement = null; release();
  });
}

export function decodeSave(frame: number[]) {
  const bytes = Buffer.from(frame), iterator = { offset: 1 };
  if (bytes[0] !== Protocol.ROOM_DATA || !decode.stringCheck(bytes, iterator) || decode.string(bytes, iterator) !== 'save')
    throw new Error('Expected a real Save room command.');
  return saveProfileCommandSchema.parse(unpack(bytes, { start: iterator.offset }));
}
