import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AdmissionReservations } from './admission-reservations.js';

describe('aborted async Colyseus admissions', () => {
  it('releases all 64 early-close admissions even when neither room join nor leave runs', () => {
    const reservations = new AdmissionReservations();
    const sockets = Array.from({ length: 64 }, () => new EventEmitter());
    for (const [index, socket] of sockets.entries()) expect(reservations.reserve(String(index), socket, 0)).toBe(true);
    expect(reservations.reserve('blocked', new EventEmitter(), 0)).toBe(false);
    // Mirrors Room._onJoin: transport close marks LEAVING while onAuth awaits;
    // the application callbacks will not run because clients.push never occurs.
    for (const socket of sockets) socket.emit('close');
    expect(reservations.reserve('next', new EventEmitter(), 0)).toBe(true);
    expect(sockets.every(socket => socket.listenerCount('close') === 0)).toBe(true);
  });
  it('bounds missing-close callbacks with expiry and never exempts active sockets from the cap', () => {
    let now = 0;
    const reservations = new AdmissionReservations(() => now);
    const socket = new EventEmitter();
    expect(reservations.reserve('pending', socket, 63)).toBe(true);
    expect(reservations.reserve('next', new EventEmitter(), 63)).toBe(false);
    now = 15_000;
    expect(reservations.has('pending')).toBe(false);
    expect(socket.listenerCount('close')).toBe(0);
    expect(reservations.reserve('still-full', new EventEmitter(), 64)).toBe(false);
    expect(reservations.reserve('next', new EventEmitter(), 63)).toBe(true);
    reservations.release('next'); reservations.release('next');
    expect(reservations.reserve('after-join', new EventEmitter(), 63)).toBe(true);
  });
});
