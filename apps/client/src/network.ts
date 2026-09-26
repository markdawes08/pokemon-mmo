import { Client } from '@colyseus/sdk';
import { HANDSHAKE_ROOM, PROTOCOL_VERSION, welcomeSchema, pongSchema } from '@pokewaterblue/protocol';

export async function connectPreview(onStatus: (text: string, ok: boolean) => void): Promise<() => void> {
  const endpoint = `${window.location.origin}/socket`;
  const client = new Client(endpoint);
  const room = await client.joinOrCreate(HANDSHAKE_ROOM, { protocolVersion: PROTOCOL_VERSION });
  let welcomed = false;
  const welcomeTimeout = window.setTimeout(() => {
    if (!welcomed) { onStatus('Connection timed out', false); void room.leave(); }
  }, 8000);
  room.onMessage('welcome', message => {
    welcomeSchema.parse(message);
    welcomed = true;
    window.clearTimeout(welcomeTimeout);
    document.documentElement.dataset.sessionId = room.sessionId;
    room.send('ping', { requestId: 'browser-smoke' });
  });
  room.onMessage('pong', message => {
    pongSchema.parse(message);
    onStatus('Server connected', true);
    document.documentElement.dataset.protocol = String(PROTOCOL_VERSION);
  });
  room.onMessage('error', () => onStatus('Server rejected a message', false));
  room.onLeave(() => { window.clearTimeout(welcomeTimeout); onStatus('Server disconnected', false); });
  room.onError(() => onStatus('Connection error', false));
  room.send('hello', { protocolVersion: PROTOCOL_VERSION });
  return () => { window.clearTimeout(welcomeTimeout); void room.leave(); };
}
