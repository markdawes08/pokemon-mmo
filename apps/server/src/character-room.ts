import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { CHARACTER_RULES_VERSION, PROTOCOL_VERSION, SERVER_VERSION, characterJoinSchema, handshakeSchema, saveProfileCommandSchema, worldCommandSchema, worldInputSchema,
  type CharacterSnapshot, type CharacterError, type ProfileSaved, type WorldSnapshot, type WorldLeft } from '@pokewaterblue/protocol';
import type { Database } from '@pokewaterblue/database';
import { readAccountSession, sessionStillValid, type AccountSession, type GameAuth } from './auth.js';
import { AccountApiError, AdmissionTickets, publicError } from './account-api.js';
import { CharacterService, type CharacterConnection } from './character-service.js';
import { isLoopback } from './handshake-room.js';
import { log } from './logger.js';
import { AdmissionReservations } from './admission-reservations.js';
import { WorldService } from './world-service.js';

type CharacterClient = Client<{
  auth: { identity: AccountSession; characterId: string };
  userData: { connection: CharacterConnection; busy: boolean };
  messages: { snapshot: CharacterSnapshot; saved: ProfileSaved; error: CharacterError; world: WorldSnapshot; 'world-left': WorldLeft };
}>;

export function createCharacterRoom(dependencies: {
  auth: GameAuth; database: Database; characters: CharacterService; tickets: AdmissionTickets;
  checkReady: () => Promise<void>; origins: Set<string>; contentHash: string;
  world: WorldService;
}) {
  const { auth, database, characters, tickets, checkReady, origins, contentHash, world } = dependencies;
  const owners = new Map<string, CharacterClient>();
  const pending = new AdmissionReservations();
  const snapshot = (client: CharacterClient): CharacterSnapshot | undefined => {
    const current = client.userData && characters.snapshot(client.userData.connection);
    return current ? { protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION, contentHash,
      rulesVersion: CHARACTER_RULES_VERSION, character: current.character, connectionGeneration: current.connectionGeneration } : undefined;
  };
  const terminate = (client: CharacterClient, error: CharacterError) => {
    if (client.userData) world.detach(client.userData.connection);
    try { client.send('error', error); }
    finally { client.leave(4003, error.code); }
  };
  return class CharacterRoom extends Room<{ client: CharacterClient }> {
    override maxClients = 32;
    override maxMessagesPerSecond = 12;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    onCreate() {
      this.heartbeatTimer = setInterval(() => {
        for (const client of this.clients) {
          if (client.userData?.busy) continue;
          void this.run(client, async () => {});
        }
      }, 2000);
      this.heartbeatTimer.unref();
      this.onMessage('hello', (client: CharacterClient, payload: unknown) => {
        void this.run(client, async () => {
          if (!handshakeSchema.safeParse(payload).success) throw new AccountApiError('PROTOCOL_MISMATCH', 'Reload to use the current protocol.');
          const current = snapshot(client);
          if (!current) throw new AccountApiError('RECONNECT_REQUIRED', 'Reconnect to reload the committed profile.');
          client.send('snapshot', current);
        });
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
      this.onMessage('*', (client: CharacterClient) => {
        void this.run(client, async () => { throw new AccountApiError('UNSUPPORTED_MESSAGE', 'This command is not supported. Story, battles and rewards remain unavailable.'); });
      });
    }
    private async run(client: CharacterClient, operation: () => Promise<void>, renew = true) {
      if (!client.userData || !client.auth) return;
      if (client.userData.busy) { client.send('error', { code: 'BUSY', message: 'Wait for the pending command before retrying.' }); return; }
      client.userData.busy = true;
      try {
        if (renew && !await sessionStillValid(database, client.auth.identity)) throw new AccountApiError('AUTH_REQUIRED', 'Your account session ended. Sign in again.');
        if (renew) await characters.heartbeat(client.userData.connection);
        await operation();
      } catch (error) {
        const detail = publicError(error);
        if (client.userData) world.publishFor(client.userData.connection);
        if (['AUTH_REQUIRED', 'SESSION_REPLACED', 'LEASE_EXPIRED', 'DATABASE_UNAVAILABLE', 'COMMAND_OUTCOME_UNKNOWN', 'RECONNECT_REQUIRED'].includes(detail.code)) terminate(client, detail);
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
        client.userData = { connection: acquired.connection, busy: false };
        world.attach({ connection: acquired.connection, world: state => client.send('world', state), character: state => client.send('snapshot', state), fail: error => terminate(client, error) });
        const previous = owners.get(client.auth.characterId);
        owners.set(client.auth.characterId, client);
        if (previous && previous !== client) terminate(previous, { code: 'SESSION_REPLACED', message: 'This character connected in another tab. Reconnect here to take control.' });
        log('info', 'character_connected', { characterId: client.auth.characterId, connectionGeneration: acquired.snapshot.connectionGeneration });
      } catch (error) { throw new ServerError(403, publicError(error).code); }
      finally { pending.release(client.sessionId); }
    }
    async onLeave(client: CharacterClient) {
      pending.release(client.sessionId);
      if (client.auth && owners.get(client.auth.characterId) === client) owners.delete(client.auth.characterId);
      if (client.userData) {
        world.detach(client.userData.connection);
        try { await characters.release(client.userData.connection); }
        catch { log('warn', 'character_release_deferred'); }
      }
    }
    onDispose() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); }
  };
}
