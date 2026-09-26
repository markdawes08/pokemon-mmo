import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { PROTOCOL_VERSION, SERVER_VERSION, handshakeSchema, pingSchema, type Welcome, type Pong, type ProtocolError } from '@pokewaterblue/protocol';
import { log } from './logger.js';

type PreviewClient = Client<{ messages: { welcome: Welcome; pong: Pong; error: ProtocolError } }>;
export const isLoopback = (ip: string | undefined) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
export function createHandshakeRoom(checkReady: () => Promise<void>) {
  return class HandshakeRoom extends Room<{ client: PreviewClient }> {
    override maxClients = 8;
    override maxMessagesPerSecond = 20;

    onCreate() {
      this.onMessage('hello', (client: PreviewClient, payload: unknown) => {
        if (!handshakeSchema.safeParse(payload).success) {
          client.send('error', { code: 'PROTOCOL_MISMATCH', message: `Protocol ${PROTOCOL_VERSION} is required.` });
          return;
        }
        client.send('welcome', {
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: SERVER_VERSION,
          sessionId: client.sessionId,
          mode: 'local-preview',
          capabilities: ['health', 'protocol-handshake'],
        });
      });
      this.onMessage('ping', (client: PreviewClient, payload: unknown) => {
        const result = pingSchema.safeParse(payload);
        if (!result.success) {
          client.send('error', { code: 'INVALID_MESSAGE', message: 'Ping requires a requestId of 1–64 characters.' });
          return;
        }
        client.send('pong', { requestId: result.data.requestId, serverTime: Date.now() });
      });
      this.onMessage('*', (client: PreviewClient) => client.send('error', { code: 'UNSUPPORTED_MESSAGE', message: 'This room provides a connection check only.' }));
    }
    async onAuth(_client: PreviewClient, options: unknown, context: AuthContext) {
      if (!isLoopback(context.ip)) throw new ServerError(403, 'LOCAL_PREVIEW_ONLY');
      if (!handshakeSchema.safeParse(options).success) throw new ServerError(400, 'PROTOCOL_MISMATCH');
      try { await checkReady(); } catch { throw new ServerError(503, 'NOT_READY'); }
      return { mode: 'local-preview' }; // A transport session, never an account or character identity.
    }
    onJoin() { log('info', 'preview_connection_joined', { connections: this.clients.length }); }
    onLeave() { log('info', 'preview_connection_left', { connections: this.clients.length }); }
  };
}
