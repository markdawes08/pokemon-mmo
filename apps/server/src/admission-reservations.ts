import type { EventEmitter } from 'node:events';

/** Counts async admissions that are not yet members of a Colyseus room. */
export class AdmissionReservations {
  private readonly pending = new Map<string, { expiresAt: number; ref: EventEmitter; closed: () => void }>();
  constructor(private readonly now = Date.now) {}
  private prune() {
    for (const [id, reservation] of this.pending) if (reservation.expiresAt <= this.now()) this.release(id);
  }
  reserve(id: string, ref: EventEmitter, active: number): boolean {
    this.prune();
    if (active + this.pending.size >= 64 || this.pending.has(id)) return false;
    const closed = () => this.release(id);
    this.pending.set(id, { expiresAt: this.now() + 15_000, ref, closed });
    // Colyseus can skip both application onJoin and onLeave after an async
    // onAuth disconnect. Listen to its documented transport EventEmitter too.
    ref.once('close', closed);
    return true;
  }
  has(id: string): boolean { this.prune(); return this.pending.has(id); }
  release(id: string) {
    const reservation = this.pending.get(id);
    if (reservation) reservation.ref.removeListener('close', reservation.closed);
    this.pending.delete(id);
  }
}
