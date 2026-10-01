import { createHash } from 'node:crypto';
import type { AccountSession } from './auth.js';

interface Binding {
  roomId: string; transportSessionId: string; identity: AccountSession;
  deadline: number | null; cancel: (shutdown?: boolean) => void;
}

/** Colyseus skips onAuth during resume. The upgrade must prove the original signed account session. */
export class ReconnectionBindings {
  private readonly bindings = new Map<string, Binding>();
  private key(token: string) { return createHash('sha256').update(token).digest('hex'); }
  register(token: string, binding: Binding) { this.bindings.set(this.key(token), binding); }
  remove(token: string) { this.bindings.delete(this.key(token)); }
  suspend(token: string, deadline: number) {
    const binding = this.bindings.get(this.key(token));
    if (binding) binding.deadline = deadline;
  }
  expected(token: string, roomId: string, transportSessionId: string): AccountSession | null {
    const binding = this.bindings.get(this.key(token));
    if (!binding || binding.roomId !== roomId || binding.transportSessionId !== transportSessionId ||
        binding.deadline !== null && binding.deadline <= Date.now()) return null;
    return binding.identity;
  }
  /** Manual SDK matchmaking has a room and token, but not yet its transport session ID. */
  expectedForMatchmaking(token: string, roomId: string): AccountSession | null {
    const binding = this.bindings.get(this.key(token));
    if (!binding || binding.roomId !== roomId || binding.deadline !== null && binding.deadline <= Date.now()) return null;
    return binding.identity;
  }
  revokeSession(sessionId: string) {
    for (const [key, binding] of this.bindings) {
      if (binding.identity.sessionId === sessionId) { this.bindings.delete(key); try { binding.cancel(); } catch { /* Already closed. */ } }
    }
  }
  clear() { for (const binding of [...this.bindings.values()]) { try { binding.cancel(true); } catch { /* Already closed. */ } } this.bindings.clear(); }
}
