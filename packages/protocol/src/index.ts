import { z } from 'zod';
export * from './accounts.js';
export * from './assets.js';
export * from './world.js';

export const PROTOCOL_VERSION = 1 as const;
export const SERVER_VERSION = '0.1.0' as const;
export const HANDSHAKE_ROOM = 'handshake' as const;
export const handshakeSchema = z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION) });
export const pingSchema = z.strictObject({ requestId: z.string().min(1).max(64) });
export const welcomeSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  serverVersion: z.string(),
  sessionId: z.string(),
  mode: z.literal('local-preview'),
  capabilities: z.array(z.enum(['health', 'protocol-handshake'])),
});
export const pongSchema = z.strictObject({ requestId: z.string(), serverTime: z.number().int() });
export const errorSchema = z.strictObject({
  code: z.enum(['INVALID_MESSAGE', 'UNSUPPORTED_MESSAGE', 'PROTOCOL_MISMATCH', 'NOT_READY']),
  message: z.string(),
});
export type Welcome = z.infer<typeof welcomeSchema>;
export type Pong = z.infer<typeof pongSchema>;
export type ProtocolError = z.infer<typeof errorSchema>;
export * from './practice.js';
