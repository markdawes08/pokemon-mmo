import { describe, expect, it } from 'vitest';
import { localTestingEnabled, localTestingOriginAllowed } from './local-testing-auth.js';

describe('local testing gates', () => {
  it('permits explicit local development/test modes only', () => {
    expect(localTestingEnabled({ APP_MODE: 'local-preview', NODE_ENV: 'development' })).toBe(true);
    expect(localTestingEnabled({ APP_MODE: 'local-preview', NODE_ENV: 'test' })).toBe(true);
    expect(localTestingEnabled({ APP_MODE: 'local-preview', NODE_ENV: 'production' })).toBe(false);
    expect(localTestingEnabled({ APP_MODE: 'tester' as 'local-preview', NODE_ENV: 'development' })).toBe(false);
  });
  it('requires a configured exact loopback origin even if misconfigured callers add another origin', () => {
    const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173', 'https://example.test', 'http://localhost:5173/path']);
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) expect(localTestingOriginAllowed(origin, origins)).toBe(true);
    for (const origin of [undefined, 'null', 'https://example.test', 'http://localhost:5173/path', 'http://localhost:9000']) expect(localTestingOriginAllowed(origin, origins)).toBe(false);
  });
});
