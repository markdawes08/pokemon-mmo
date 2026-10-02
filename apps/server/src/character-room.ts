import { Room, ServerError, CloseCode, type AuthContext, type Client } from '@colyseus/core';
import { CHARACTER_RECONNECT_GRACE_MS, CHARACTER_RULES_VERSION, PROTOCOL_VERSION, SERVER_VERSION, characterJoinSchema, handshakeSchema, saveProfileCommandSchema, worldCommandSchema, worldInputSchema,
  practiceCommandSchema, wildTestCommandSchema, type PracticeSnapshot, type WildTestSnapshot,
  type CharacterSnapshot, type CharacterError, type ProfileSaved, type WorldSnapshot, type WorldLeft } from '@pokewaterblue/protocol';
import type { Database } from '@pokewaterblue/database';
import { readAccountSession, sessionStillValid, type AccountSession, type GameAuth } from './auth.js';
import { AccountApiError, AdmissionTickets, publicError } from './account-api.js';
import { CharacterService, type CharacterConnection } from './character-service.js';
import { isLoopback } from './handshake-room.js';
import { log } from './logger.js';
import { AdmissionReservations } from './admission-reservations.js';
import { WorldService } from './world-service.js';
import { ReconnectionBindings } from './reconnection-bindings.js';

type CharacterClient = Client<{
  auth: { identity: AccountSession; characterId: string };
  userData: { connection: CharacterConnection; busy: boolean; suspended: boolean; awaitingHello: boolean; helloDeadline: number; resumeTimer?: ReturnType<typeof setTimeout>; terminated: boolean; bindingToken: string };
  messages: { snapshot: CharacterSnapshot; saved: ProfileSaved; error: CharacterError; world: WorldSnapshot; 'world-left': WorldLeft; practice: PracticeSnapshot; 'wild-test': WildTestSnapshot };
}>;
interface Grace {
  client: CharacterClient; deadline: number; settled: Promise<boolean>; heartbeat?: Promise<void>;
  deferred: ReturnType<Room['allowReconnection']>; resuming: boolean; timer: ReturnType<typeof setTimeout>;
}

export function createCharacterRoom(dependencies: {
  auth: GameAuth; database: Database; characters: CharacterService; tickets: AdmissionTickets;
  checkReady: () => Promise<void>; origins: Set<string>; contentHash: string;
  world: WorldService; reconnections: ReconnectionBindings;
}) {
  const { auth, database, characters, tickets, checkReady, origins, contentHash, world, reconnections } = dependencies;
  const owners = new Map<string, CharacterClient>();
  const terminators = new WeakMap<CharacterClient, (error: CharacterError) => void>();
  const pending = new AdmissionReservations();
  const snapshot = (client: CharacterClient): CharacterSnapshot | undefined => {
    const current = client.userData && characters.snapshot(client.userData.connection);
    return current ? { protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION, contentHash,
      rulesVersion: CHARACTER_RULES_VERSION, ...current } : undefined;
  };
  return class CharacterRoom extends Room<{ client: CharacterClient }> {
    override maxClients = 32;
    override maxMessagesPerSecond = 12;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private readonly grace = new Map<string, Grace>();
    private stopping = false;
    private terminate(client: CharacterClient, error: CharacterError) {
      const data = client.userData;
      if (data) {
        data.terminated = true; data.suspended = true;
        clearTimeout(data.resumeTimer); data.resumeTimer = undefined;
        reconnections.remove(data.bindingToken);
        world.detach(data.connection);
      }
      const grace = this.grace.get(client.sessionId);
      if (grace) { clearTimeout(grace.timer); grace.deferred.reject(error); }
      try { client.send('error', error); } catch { /* Dropped transport; cancellation still fences authority. */ }
      try { client.leave(CloseCode.FAILED_TO_RECONNECT, error.code); } catch { /* Already closed. */ }
    }
    private bind(client: CharacterClient) {
      reconnections.register(client.reconnectionToken, { roomId: this.roomId, transportSessionId: client.sessionId,
        identity: client.auth!.identity, deadline: null,
        cancel: shutdown => this.terminate(client, shutdown
          ? { code: 'RECONNECT_REQUIRED', message: 'The server is stopping. Reconnect after it restarts.' }
          : { code: 'AUTH_REQUIRED', message: 'Your account session ended. Sign in again.' }) });
      client.userData!.bindingToken = client.reconnectionToken;
    }
    private attach(client: CharacterClient) {
      world.attach({ connection: client.userData!.connection, world: state => client.send('world', state),
        character: state => client.send('snapshot', state), practice: state => client.send('practice', state), fail: error => this.terminate(client, error) });
    }
    onCreate() {
      this.heartbeatTimer = setInterval(() => {
        for (const client of this.clients) {
          if (client.userData?.awaitingHello && Date.now() >= client.userData.helloDeadline) {
            this.terminate(client, { code: 'RECONNECT_REQUIRED', message: 'The trainer handshake timed out. Reconnect explicitly.' }); continue;
          }
          if (client.userData?.busy || client.userData?.suspended || client.userData?.awaitingHello) continue;
          void this.run(client, async () => {});
        }
        for (const grace of this.grace.values()) {
          if (grace.resuming || grace.heartbeat || grace.client.userData?.terminated) continue;
          if (Date.now() >= grace.deadline) { grace.deferred.reject(false); continue; }
          grace.heartbeat = characters.heartbeat(grace.client.userData!.connection).catch(error => this.terminate(grace.client, publicError(error)))
            .finally(() => { grace.heartbeat = undefined; });
        }
      }, 2000);
      this.heartbeatTimer.unref();
      this.onMessage('hello', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          if (!handshakeSchema.safeParse(payload).success) throw new AccountApiError('PROTOCOL_MISMATCH', 'Reload to use the current protocol.');
          // Complete every asynchronous read before acknowledging hello. A client
          // may issue its first command as soon as it receives the private view.
          const practice = characters.practiceAvailable(client.userData!.connection)
            ? await characters.practiceSnapshot(client.userData!.connection, { handshakeRead: true }) : undefined;
          const wildTest = characters.wildAvailable(client.userData!.connection)
            ? await characters.wildTestSnapshot(client.userData!.connection, { handshakeRead: true }) : undefined;
          if (client.userData!.suspended || client.userData!.terminated || this.stopping ||
              client.userData!.awaitingHello && Date.now() >= client.userData!.helloDeadline) throw new AccountApiError('RECONNECT_REQUIRED', 'The trainer handshake ended. Reconnect explicitly.');
          const current = snapshot(client);
          if (!current) throw new AccountApiError('RECONNECT_REQUIRED', 'Reconnect to reload the committed profile.');
          client.send('snapshot', current);
          characters.activateTransport(client.userData!.connection);
          client.userData!.awaitingHello = false;
          clearTimeout(client.userData!.resumeTimer); client.userData!.resumeTimer = undefined;
          world.publishFor(client.userData!.connection);
          if (practice) client.send('practice', practice);
          if (wildTest) client.send('wild-test', wildTest);
        }, true, true);
      });
      this.onMessage('save', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          const parsed = saveProfileCommandSchema.safeParse(payload);
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Invalid profile save command.');
          client.send('saved', await characters.save(client.userData!.connection, parsed.data));
          world.publishFor(client.userData!.connection);
        });
      });
      this.onMessage('world-enter', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          const parsed = worldCommandSchema.safeParse(payload);
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Invalid shared world entry command.');
          await characters.enterWorld(client.userData!.connection, parsed.data);
          world.publishFor(client.userData!.connection);
        });
      });
      this.onMessage('world-leave', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          const parsed = worldCommandSchema.safeParse(payload);
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Invalid shared world exit command.');
          const character = await characters.leaveWorld(client.userData!.connection, parsed.data);
          client.send('world-left', { commandId: parsed.data.commandId, character });
          world.publishFor(client.userData!.connection);
        });
      });
      this.onMessage('world-input', (client: CharacterClient, payload: unknown) => {
        // Inputs do not renew/write leases or create receipts. Authenticated 2s heartbeats own renewal.
        void this.run(client, async () => {
          const parsed = worldInputSchema.safeParse(payload);
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Movement accepts only directional input and current generations.');
          await characters.worldInput(client.userData!.connection, parsed.data);
          world.publishFor(client.userData!.connection);
        }, false);
      });
      this.onMessage('practice-query', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 0) throw new AccountApiError('INVALID_MESSAGE', 'Practice query takes an empty object.');
          client.send('practice', await characters.practiceSnapshot(client.userData!.connection));
        });
      });
      this.onMessage('practice-command', (client: CharacterClient, payload: unknown) => {
        // Parse before backpressure so BUSY can identify this exact valid request.
        const parsed = practiceCommandSchema.safeParse(payload);
        void this.run(client, async () => {
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Invalid practice command.');
          const practice = await characters.practiceCommand(client.userData!.connection, parsed.data);
          const current = snapshot(client);
          if (!current) throw new AccountApiError('RECONNECT_REQUIRED', 'Reconnect to reload the committed practice.');
          client.send('snapshot', current);
          client.send('practice', practice);
          world.publishFor(client.userData!.connection);
        }, true, false, parsed.success ? parsed.data.commandId : undefined);
      });
      this.onMessage('wild-test-query', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 0) throw new AccountApiError('INVALID_MESSAGE', 'Wild encounter query takes an empty object.');
          client.send('wild-test', await characters.wildTestSnapshot(client.userData!.connection));
        });
      });
      this.onMessage('wild-test-command', (client: CharacterClient, payload: unknown) => {
        const parsed = wildTestCommandSchema.safeParse(payload);
        void this.run(client, async () => {
          if (!parsed.success) throw new AccountApiError('INVALID_MESSAGE', 'Invalid wild encounter testing command.');
          const setting = await characters.wildTestCommand(client.userData!.connection, parsed.data);
          client.send('wild-test', setting);
          world.publishFor(client.userData!.connection);
        }, true, false, parsed.success ? parsed.data.commandId : undefined);
      });
      this.onMessage('*', (client: CharacterClient) => {
        void this.run(client, async () => { throw new AccountApiError('UNSUPPORTED_MESSAGE', 'This command is not supported. Normal story battles and rewards remain unavailable.'); });
      });
    }
    private async run(client: CharacterClient, operation: () => Promise<void>, renew = true, hello = false, commandId?: string) {
      if (!client.userData || !client.auth) return;
      if (client.userData.suspended || client.userData.terminated || client.userData.awaitingHello && !hello) return;
      if (client.userData.awaitingHello && Date.now() >= client.userData.helloDeadline) {
        this.terminate(client, { code: 'RECONNECT_REQUIRED', message: 'The trainer handshake timed out. Reconnect explicitly.' }); return;
      }
      if (client.userData.busy) { client.send('error', { code: 'BUSY', message: 'Wait for the pending command before retrying.', ...(commandId ? { commandId } : {}) }); return; }
      client.userData.busy = true;
      try {
        if (renew && !await sessionStillValid(database, client.auth.identity)) throw new AccountApiError('AUTH_REQUIRED', 'Your account session ended. Sign in again.');
        if (renew) await characters.heartbeat(client.userData.connection);
        if (client.userData.suspended || client.userData.terminated) return;
        if (client.userData.awaitingHello && Date.now() >= client.userData.helloDeadline) throw new AccountApiError('RECONNECT_REQUIRED', 'The trainer handshake timed out. Reconnect explicitly.');
        await operation();
      } catch (error) {
        const detail = { ...publicError(error), ...(commandId ? { commandId } : {}) };
        if (client.userData) world.publishFor(client.userData.connection);
        if (['AUTH_REQUIRED', 'SESSION_REPLACED', 'LEASE_EXPIRED', 'DATABASE_UNAVAILABLE', 'COMMAND_OUTCOME_UNKNOWN', 'RECONNECT_REQUIRED'].includes(detail.code)) this.terminate(client, detail);
        else client.send('error', { ...detail, ...(snapshot(client) ? { snapshot: snapshot(client) } : {}) });
      } finally { if (client.userData) client.userData.busy = false; }
    }
    async onAuth(client: CharacterClient, options: unknown, context: AuthContext) {
      if (!isLoopback(context.ip) || !origins.has(context.headers.get('origin') ?? '')) throw new ServerError(403, 'ORIGIN_REJECTED');
      const parsed = characterJoinSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, 'PROTOCOL_MISMATCH');
      if (!pending.reserve(client.sessionId, client.ref, owners.size)) throw new ServerError(429, 'RATE_LIMITED');
      try {
        await checkReady();
        const identity = await readAccountSession(auth, context.headers);
        if (!identity) throw new AccountApiError('AUTH_REQUIRED', 'Sign in to join your character.');
        if (!pending.has(client.sessionId)) throw new AccountApiError('RECONNECT_REQUIRED', 'The connection closed or admission expired.');
        return tickets.consume(parsed.data.ticket, identity);
      } catch (error) {
        pending.release(client.sessionId);
        const detail = publicError(error);
        throw new ServerError(detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'DATABASE_UNAVAILABLE' ? 503 : 403, detail.code);
      }
    }
    async onJoin(client: CharacterClient) {
      if (!client.auth) throw new ServerError(401, 'AUTH_REQUIRED');
      try {
        if (!pending.has(client.sessionId)) throw new AccountApiError('RECONNECT_REQUIRED', 'The connection closed or admission expired.');
        if (!await sessionStillValid(database, client.auth.identity)) throw new AccountApiError('AUTH_REQUIRED', 'Sign in again.');
        const acquired = await characters.acquire(client.auth.identity.userId, client.auth.characterId, client.auth.identity.sessionId);
        if (!pending.has(client.sessionId)) {
          await characters.release(acquired.connection);
          throw new AccountApiError('RECONNECT_REQUIRED', 'The connection closed or admission expired.');
        }
        client.userData = { connection: acquired.connection, busy: false, suspended: false, awaitingHello: true, helloDeadline: Date.now() + 15_000, terminated: false, bindingToken: client.reconnectionToken };
        terminators.set(client, error => this.terminate(client, error));
        this.attach(client);
        this.bind(client);
        const previous = owners.get(client.auth.characterId);
        owners.set(client.auth.characterId, client);
        if (previous && previous !== client) terminators.get(previous)?.({ code: 'SESSION_REPLACED', message: 'This character connected in another tab. Reconnect here to take control.' });
        log('info', 'character_connected', { characterId: client.auth.characterId, connectionGeneration: acquired.snapshot.connectionGeneration });
      } catch (error) { throw new ServerError(403, publicError(error).code); }
      finally { pending.release(client.sessionId); }
    }
    onDrop(client: CharacterClient, code?: number) {
      const data = client.userData;
      if (!data || !client.auth || data.terminated || data.awaitingHello || this.stopping || owners.get(client.auth.characterId) !== client ||
          !(new Set<number>([CloseCode.GOING_AWAY, CloseCode.NO_STATUS_RECEIVED, CloseCode.ABNORMAL_CLOSURE, CloseCode.MAY_TRY_RECONNECT])).has(code ?? 0)) return;
      data.suspended = true;
      world.detach(data.connection);
      const deadline = Date.now() + CHARACTER_RECONNECT_GRACE_MS;
      // Colyseus 0.18's timed mode leaves its timer referenced after rejection.
      // Manual mode lets our original-drop timer own both expiry and cancellation.
      const deferred = this.allowReconnection(client, 'manual');
      // Install the reservation immediately, before settling the at-most-one accepted source step.
      const timer = setTimeout(() => this.terminate(client, { code: 'RECONNECT_REQUIRED', message: 'The transport reconnection window ended. Reconnect explicitly.' }), CHARACTER_RECONNECT_GRACE_MS);
      timer.unref();
      const grace: Grace = { client, deadline, deferred, settled: Promise.resolve(false), resuming: false, timer };
      this.grace.set(client.sessionId, grace);
      reconnections.suspend(data.bindingToken, deadline);
      grace.settled = characters.suspendTransport(data.connection).then(() => true, error => { this.terminate(client, publicError(error)); return false; });
      deferred.catch(() => {}); // Framework invokes onLeave for expiry/cancellation.
      log('info', 'character_transport_dropped');
    }
    async onReconnect(client: CharacterClient) {
      const grace = this.grace.get(client.sessionId), data = client.userData;
      try {
        if (grace) { grace.resuming = true; await grace.heartbeat; }
        if (!grace || !data || !client.auth || data.terminated || this.stopping || Date.now() >= grace.deadline ||
            owners.get(client.auth.characterId) !== grace.client || !await grace.settled) throw new AccountApiError('RECONNECT_REQUIRED', 'The transport reconnection window ended.');
        const resumed = await characters.resumeTransport(data.connection, grace.deadline);
        data.connection = resumed.connection;
        if (data.terminated || this.stopping || Date.now() >= grace.deadline || owners.get(client.auth.characterId) !== grace.client) throw new AccountApiError('RECONNECT_REQUIRED', 'The transport reconnection window ended.');
        reconnections.remove(data.bindingToken);
        this.grace.delete(client.sessionId);
        data.suspended = false; data.busy = false; data.awaitingHello = true;
        data.helloDeadline = Math.min(Date.now() + 15_000, grace.deadline); data.resumeTimer = grace.timer;
        owners.set(client.auth.characterId, client);
        terminators.set(client, error => this.terminate(client, error));
        this.bind(client);
        this.attach(client);
        log('info', 'character_transport_reconnected');
      } catch (error) {
        this.terminate(client, publicError(error));
        throw new ServerError(CloseCode.FAILED_TO_RECONNECT, publicError(error).code);
      }
    }
    async onLeave(client: CharacterClient) {
      pending.release(client.sessionId);
      const grace = this.grace.get(client.sessionId);
      if (grace) clearTimeout(grace.timer);
      this.grace.delete(client.sessionId);
      if (client.auth && (owners.get(client.auth.characterId) === client || owners.get(client.auth.characterId)?.userData === client.userData)) owners.delete(client.auth.characterId);
      if (client.userData) {
        clearTimeout(client.userData.resumeTimer); client.userData.resumeTimer = undefined;
        client.userData.terminated = true;
        reconnections.remove(client.userData.bindingToken);
        world.detach(client.userData.connection);
        try { await characters.release(client.userData.connection); }
        catch { log('warn', 'character_release_deferred'); }
      }
    }
    override onBeforeShutdown() { this.stopping = true; super.onBeforeShutdown(); }
    onDispose() {
      this.stopping = true;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      for (const grace of this.grace.values()) { clearTimeout(grace.timer); grace.deferred.reject(false); }
      this.grace.clear();
      for (const client of this.clients) {
        clearTimeout(client.userData?.resumeTimer);
        if (client.userData) client.userData.resumeTimer = undefined;
      }
    }
  };
}
