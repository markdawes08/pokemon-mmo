import type { Page } from '@playwright/test';

interface ReconnectProbe {
  socket: WebSocket | null; path: string; blockedUntil: number; resumedSockets: number; sessionIds: string[];
  saveFrames: number[][]; movementFrames: number; entryFrames: number; dropSavedAck: boolean; droppedSavedAcks: number; blockedAttempts: number;
}
type ProbeWindow = Window & { reconnectProbe: ReconnectProbe };

/** Native sockets retain their actual browser cookie/Origin handshake. No server hooks or mock responses. */
export async function observeReconnect(page: Page) {
  await page.addInitScript(() => {
    const state: ReconnectProbe = { socket: null, path: '', blockedUntil: 0, resumedSockets: 0, sessionIds: [], saveFrames: [], movementFrames: 0, entryFrames: 0, dropSavedAck: false, droppedSavedAcks: 0, blockedAttempts: 0 };
    (window as unknown as ProbeWindow).reconnectProbe = state;
    const NativeWebSocket = window.WebSocket;
    const send = NativeWebSocket.prototype.send;
    const onmessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage')!;
    const bytesOf = (data: Parameters<WebSocket['send']>[0]) => typeof data === 'string' ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer ? new Uint8Array(data)
        : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const url = new URL(String(args[0]));
        if (url.searchParams.has('reconnectionToken') && performance.now() < state.blockedUntil) {
          state.blockedAttempts++; throw new Error('Induced temporary client transport unavailability');
        }
        const socket = Reflect.construct(target, args) as WebSocket;
        if (url.searchParams.has('reconnectionToken') && url.pathname === state.path) {
          state.socket = socket; state.resumedSockets++; state.sessionIds.push(url.searchParams.get('sessionId') ?? '');
        }
        return socket;
      },
    });
    NativeWebSocket.prototype.send = function (data) {
      const bytes = bytesOf(data), text = bytes && new TextDecoder().decode(bytes), url = new URL(this.url);
      if (text?.includes('world-enter')) {
        state.socket = this; state.path = url.pathname; state.entryFrames++;
        if (!state.sessionIds.length) state.sessionIds.push(url.searchParams.get('sessionId') ?? '');
      }
      if (url.pathname === state.path && text?.includes('hello')) state.socket = this;
      if (url.pathname === state.path && text?.includes('world-input')) state.movementFrames++;
      if (url.pathname === state.path && text?.includes('save-profile')) state.saveFrames.push(Array.from(bytes!));
      return send.call(this, data);
    };
    Object.defineProperty(NativeWebSocket.prototype, 'onmessage', {
      configurable: true, enumerable: onmessage.enumerable, get: onmessage.get,
      set(this: WebSocket, handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) {
        if (!handler) { onmessage.set!.call(this, handler); return; }
        onmessage.set!.call(this, (event: MessageEvent) => {
          const text = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
          if (state.dropSavedAck && new URL(this.url).pathname === state.path && text.includes('commandId') && text.includes('replayed')) {
            // The real server already committed before sending this acknowledgement.
            state.dropSavedAck = false; state.droppedSavedAcks++; state.blockedUntil = performance.now() + 1000;
            this.close(4010, 'induced acknowledgement loss'); return;
          }
          handler.call(this, event);
        });
      },
    });
  });
}

export async function interruptCharacter(page: Page, holdMs = 1200) {
  await page.evaluate(duration => {
    const state = (window as unknown as ProbeWindow).reconnectProbe;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) throw new Error('No live character socket to interrupt.');
    state.blockedUntil = performance.now() + duration; state.socket.close(4010, 'induced native transport drop');
  }, holdMs);
}
export const loseNextSaveAcknowledgement = (page: Page) => page.evaluate(() => { (window as unknown as ProbeWindow).reconnectProbe.dropSavedAck = true; });
export const reconnectProbe = (page: Page) => page.evaluate(() => {
  const { resumedSockets, sessionIds, saveFrames, movementFrames, entryFrames, droppedSavedAcks, blockedAttempts } = (window as unknown as ProbeWindow).reconnectProbe;
  return { resumedSockets, sessionIds, saveFrames, movementFrames, entryFrames, droppedSavedAcks, blockedAttempts };
});
