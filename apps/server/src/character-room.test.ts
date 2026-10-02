import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacterRoom } from './character-room.js';
import { AccountApiError } from './account-api.js';
import { sessionStillValid } from './auth.js';

vi.mock('./auth.js', () => ({ sessionStillValid: vi.fn(async () => true), readAccountSession: vi.fn() }));
type CharacterRoom = InstanceType<ReturnType<typeof createCharacterRoom>>;
type CharacterClient = Parameters<CharacterRoom['onJoin']>[0];
const input = { sequence: 1, connectionGeneration: 1, zoneGeneration: 1, direction: 'north', run: true };
const save = { commandId: '00000000-0000-4000-8000-000000000001', type: 'save-profile', version: 1,
  activityId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1, payload: {} };
function gate() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const owned: CharacterRoom[] = [];
function setup() {
  const heartbeat = gate();
  const characters = { heartbeat: vi.fn(() => heartbeat.promise), worldInput: vi.fn(async () => {}),
    snapshot: vi.fn(), save: vi.fn(async () => ({})), release: vi.fn(async () => {}) };
  const world = { publishFor: vi.fn(), detach: vi.fn() };
  const Room = createCharacterRoom({ characters, world, auth: {}, database: {}, tickets: {}, reconnections: { remove: vi.fn() },
    checkReady: async () => {}, origins: new Set(), contentHash: '0'.repeat(64) } as unknown as Parameters<typeof createCharacterRoom>[0]);
  const room = new Room(); owned.push(room);
  const handlers = new Map<string, (client: CharacterClient, value: unknown) => void>();
  vi.spyOn(room, 'onMessage').mockImplementation(((type: string, callback: (client: CharacterClient, value: unknown) => void) => {
    handlers.set(type, callback); return () => {};
  }) as typeof room.onMessage);
  const client = { sessionId: 'transport', auth: { identity: { sessionId: 'cookie', userId: 'owner' }, characterId: 'trainer' },
    userData: { connection: { characterId: 'trainer', accountId: 'owner', ownerId: 'process', sessionId: 'cookie', leaseGeneration: 1, connectionGeneration: 1 },
      busy: false, suspended: false, awaitingHello: false, helloDeadline: Date.now() + 15_000, terminated: false, bindingToken: 'binding' },
    send: vi.fn(), leave: vi.fn() } as unknown as CharacterClient;
  room.clients.push(client); room.onCreate();
  return { room, client, heartbeat, characters, world, send: (type: string, value: unknown) => handlers.get(type)!(client, value) };
}
beforeEach(() => { vi.useFakeTimers(); vi.mocked(sessionStillValid).mockResolvedValue(true); });
afterEach(() => { for (const room of owned.splice(0)) room.onDispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('movement overlapping automatic lease maintenance', () => {
  it('defers one valid input and executes it immediately after the heartbeat without BUSY or retry', async () => {
    const { client, heartbeat, characters, world, send } = setup();
    await vi.advanceTimersByTimeAsync(2000); expect(characters.heartbeat).toHaveBeenCalledTimes(1);
    send('world-input', input);
    expect(characters.worldInput).not.toHaveBeenCalled(); expect(client.send).not.toHaveBeenCalled();
    heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).toHaveBeenCalledExactlyOnceWith(client.userData!.connection, input);
    expect(world.publishFor).toHaveBeenCalledExactlyOnceWith(client.userData!.connection);
    expect(client.send).not.toHaveBeenCalled(); expect(client.userData!.busy).toBe(false);
  });
  it('keeps the queue bounded to one movement while excess or malformed packets retain backpressure', async () => {
    const { client, heartbeat, characters, send } = setup(); await vi.advanceTimersByTimeAsync(2000);
    send('world-input', input); send('world-input', { ...input, sequence: 2 }); send('world-input', { ...input, teleport: true });
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send).toHaveBeenLastCalledWith('error', { code: 'BUSY', message: 'Wait for the pending command before retrying.' });
    heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).toHaveBeenCalledExactlyOnceWith(client.userData!.connection, input);
  });
  it('does not queue malformed input even when the maintenance slot is empty', async () => {
    const { client, heartbeat, characters, send } = setup(); await vi.advanceTimersByTimeAsync(2000);
    send('world-input', { ...input, x: 12 }); heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).not.toHaveBeenCalled(); expect(client.userData!.deferredMovement).toBeUndefined();
  });
  it('retains ordinary command backpressure and correlates valid Save errors', async () => {
    const { client, heartbeat, characters, send } = setup(); send('save', save); await vi.advanceTimersByTimeAsync(0);
    send('world-input', input); send('save', save);
    expect(client.send).toHaveBeenLastCalledWith('error', { code: 'BUSY', message: 'Wait for the pending command before retrying.', commandId: save.commandId });
    heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).not.toHaveBeenCalled(); expect(characters.save).toHaveBeenCalledTimes(1);
  });
  for (const reason of ['suspended', 'generation', 'leave', 'shutdown'] as const) it(`cancels pending movement on ${reason}`, async () => {
    const { room, client, heartbeat, characters, send } = setup(); await vi.advanceTimersByTimeAsync(2000); send('world-input', input);
    if (reason === 'suspended') client.userData!.suspended = true;
    else if (reason === 'generation') { client.userData!.connection = { ...client.userData!.connection, connectionGeneration: 2 }; client.userData!.deferredMovement = undefined; }
    else if (reason === 'leave') await room.onLeave(client);
    else room.onDispose();
    heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).not.toHaveBeenCalled(); expect(client.userData!.deferredMovement).toBeUndefined();
  });
  it('terminates a failed renewal and discards its deferred movement', async () => {
    const { client, heartbeat, characters, send } = setup(); await vi.advanceTimersByTimeAsync(2000); send('world-input', input);
    heartbeat.reject(new AccountApiError('AUTH_REQUIRED', 'The account session ended.')); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).not.toHaveBeenCalled(); expect(client.userData!.terminated).toBe(true);
    expect(client.send).toHaveBeenCalledWith('error', { code: 'AUTH_REQUIRED', message: 'The account session ended.' });
  });
  it('executes deferred movement through the ordinary service generation fence', async () => {
    const { client, heartbeat, characters, send } = setup();
    characters.worldInput.mockRejectedValueOnce(new AccountApiError('SESSION_REPLACED', 'Trainer replaced.'));
    await vi.advanceTimersByTimeAsync(2000); send('world-input', input); heartbeat.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(characters.worldInput).toHaveBeenCalledTimes(1); expect(client.userData!.terminated).toBe(true);
    expect(client.send).toHaveBeenCalledWith('error', { code: 'SESSION_REPLACED', message: 'Trainer replaced.' });
  });
  for (const outcome of ['resolves', 'rejects'] as const) it(`does not renew, terminate or clear a new generation after an old maintenance auth read ${outcome}`, async () => {
    const authRead = gate(); vi.mocked(sessionStillValid).mockImplementationOnce(async () => { await authRead.promise; return true; });
    const { client, characters, send } = setup(); await vi.advanceTimersByTimeAsync(2000); send('world-input', input);
    const data = client.userData!; data.connection = { ...data.connection, connectionGeneration: 2 };
    data.maintenance = false; const newOperation = async () => {};
    data.deferredMovement = { connection: data.connection, operation: newOperation }; data.busy = true;
    if (outcome === 'resolves') authRead.resolve(); else authRead.reject(new Error('Old generation auth read failed.'));
    await vi.advanceTimersByTimeAsync(0);
    expect(characters.heartbeat).not.toHaveBeenCalled(); expect(characters.worldInput).not.toHaveBeenCalled();
    expect(data.busy).toBe(true); expect(data.deferredMovement?.operation).toBe(newOperation); expect(client.leave).not.toHaveBeenCalled();
  });
});
