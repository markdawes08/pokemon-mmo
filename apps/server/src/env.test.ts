import { describe, expect, it } from 'vitest';
import { allowedOrigins, parseServerEnv } from './env.js';
import { handshakeSchema, pingSchema } from '@pokewaterblue/protocol';

const valid = { DATABASE_URL: 'postgresql://example:secret@127.0.0.1:5433/example', BETTER_AUTH_SECRET: 'unit-test-secret-with-at-least-32-characters', BETTER_AUTH_URL: 'http://localhost:5173' };
describe('local preview configuration and contract', () => {
  it('requires PostgreSQL and does not fall back to another database', () => {
    expect(() => parseServerEnv({})).toThrow('DATABASE_URL');
    expect(() => parseServerEnv({ DATABASE_URL: 'sqlite://example' })).toThrow('PostgreSQL');
  });
  it('cannot expose the unauthenticated preview as a tester server', () => {
    expect(() => parseServerEnv({ ...valid, HOST: '0.0.0.0' })).toThrow('HOST');
    expect(() => parseServerEnv({ ...valid, APP_MODE: 'private-test' })).toThrow('APP_MODE');
    expect(parseServerEnv(valid).HOST).toBe('127.0.0.1');
  });
  it('rejects mismatched versions and attempted identity injection', () => {
    expect(handshakeSchema.safeParse({ protocolVersion: 2 }).success).toBe(false);
    expect(handshakeSchema.safeParse({ protocolVersion: 1, userId: 'admin' }).success).toBe(false);
    expect(pingSchema.safeParse({ requestId: 'x'.repeat(65) }).success).toBe(false);
  });
  it('requires a secret and exact local auth origins without exposing rejected values', () => {
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: 'sensitive-short' })).toThrow('BETTER_AUTH_SECRET');
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: 'sensitive-short' })).not.toThrow('sensitive-short');
    for (const BETTER_AUTH_URL of ['https://example.com', 'http://localhost:5173/path', 'http://localhost:5173/', 'http://user:secret@localhost:5173']) {
      expect(() => parseServerEnv({ ...valid, BETTER_AUTH_URL })).toThrow('BETTER_AUTH_URL');
    }
  });
  it('allows configured loopback aliases and backend ports only', () => {
    const origins = allowedOrigins(parseServerEnv(valid));
    expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    expect(origins.has('http://localhost:2567')).toBe(true);
    expect(origins.has('http://localhost:5174')).toBe(false);
    expect(origins.has('http://localhost.attacker.test:5173')).toBe(false);
    expect(origins.has('null')).toBe(false);
  });
});
