import { describe, expect, it } from 'vitest';
import { AdmissionTickets } from './account-api.js';

const identity = { sessionId: 'session-one', userId: 'user-one', email: 'one@example.test' };
describe('cookie-bound one-use admission tickets', () => {
  it('rejects another account or session without consuming the owner ticket', () => {
    const tickets = new AdmissionTickets();
    const issued = tickets.issue(identity, 'character-one');
    expect(() => tickets.consume(issued.ticket, { ...identity, userId: 'user-two' })).toThrow('invalid');
    expect(() => tickets.consume(issued.ticket, { ...identity, sessionId: 'session-two' })).toThrow('invalid');
    expect(tickets.consume(issued.ticket, identity).characterId).toBe('character-one');
    expect(() => tickets.consume(issued.ticket, identity)).toThrow('invalid');
  });
  it('expires at the boundary, caps outstanding tickets and clears on shutdown', () => {
    let now = 10_000;
    const tickets = new AdmissionTickets(() => now);
    const issued = tickets.issue(identity, 'character-one');
    now += 15_000;
    expect(() => tickets.consume(issued.ticket, identity)).toThrow('expired');
    for (let i = 0; i < 4; i++) tickets.issue(identity, 'character-one');
    expect(() => tickets.issue(identity, 'character-one')).toThrow('Too many');
    tickets.clear();
    expect(tickets.issue(identity, 'character-one').ticket.length).toBeGreaterThanOrEqual(32);
  });
});
