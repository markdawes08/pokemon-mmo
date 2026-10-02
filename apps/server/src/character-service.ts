import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '@pokewaterblue/database';
import {
  characterViewSchema, createCharacterSchema, saveProfileCommandSchema, worldCommandSchema, worldInputSchema, worldLocationSchema,
  practiceCommandSchema, practiceSnapshotSchema,
  type CharacterError, type CharacterView, type CreateCharacter, type ProfileSaved, type SaveProfileCommand,
  type WorldAvatar, type WorldCommand, type WorldInput, type WorldLocation, type WorldTransition,
  type PracticeCommand, type PracticeSnapshot, type PracticeState,
} from '@pokewaterblue/protocol';
import { WorldContent, WORLD_SOURCE_FINGERPRINT } from './world-content.js';
import { DEVELOPMENT_CONTENT_HASH, DEVELOPMENT_PROFILE_ID } from './development-profile.js';
import type { PreviewMoveResult } from '@pokewaterblue/game-rules';
import { PracticeEngineError, type PracticeEngine, type PracticeStored } from './practice-engine.js';

export class CharacterServiceError extends Error {
  constructor(readonly code: CharacterError['code'], message: string) { super(message); this.name = 'CharacterServiceError'; }
}
export interface CharacterConnection {
  readonly accountId: string;
  readonly characterId: string;
  readonly ownerId: string;
  readonly leaseGeneration: number;
  readonly connectionGeneration: number;
  readonly activityId: string;
  readonly sessionId?: string;
}
export interface SessionProjection { character: CharacterView; connectionGeneration: number; worldActive: boolean }
type WriteKind = 'create' | 'save' | 'world' | 'practice';
/** Failure injection for the real-PostgreSQL integration executable only; rejected outside NODE_ENV=test. */
export interface CharacterServiceTestHooks {
  beforeCommit?: (kind: WriteKind) => void | Promise<void>;
  commit?: (client: PoolClient, kind: WriteKind) => Promise<void>;
  beforePublish?: () => void | Promise<void>;
}
interface CharacterRow {
  id: string; account_id: string; name: string; revision: string; stage: string; activity: string;
  activity_id: string; created_at: Date; saved_at: Date | null;
  map_id: string | null; position_x: number | null; position_y: number | null;
  position_elevation: number | null; position_facing: WorldAvatar['direction'] | null;
  transition_generation: string; world_checkpoint_id: string | null;
}
interface LeaseRow {
  owner_id: string; lease_generation: string; connection_generation: string; active: boolean;
}
interface ReceiptRow { payload_hash: string; result: unknown }
interface PracticeRow { character_id: string; revision: string; battle_id: string | null; checkpoint: PracticeStored | null }
interface WorldRuntime {
  location: WorldLocation; direction: WorldAvatar['direction']; zoneGeneration: number; lastInputSequence: number;
  motion: WorldAvatar['motion']; transfer?: { move: Extract<PreviewMoveResult, { allowed: true; kind: 'transition' }>; from: WorldLocation; dueAt: number; durationMs: number };
  transition?: WorldTransition; lastCheckpointAt: number; dirty: boolean; detached: boolean;
}
interface Runtime { connection: CharacterConnection; character: CharacterView; frozen: boolean; suspended: boolean; world?: WorldRuntime; heartbeatAt: number }
export interface WorldProjection { avatar: WorldAvatar; zoneGeneration: number; lastInputSequence: number; transition?: WorldTransition }
interface SaveOutcome { character: CharacterView; latest: CharacterView; replayed: boolean }
class UnknownCommit extends Error {}

function fail(code: CharacterError['code'], message: string): never { throw new CharacterServiceError(code, message); }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const view = (row: CharacterRow): CharacterView => characterViewSchema.parse({
  id: row.id, name: row.name, revision: Number(row.revision), stage: row.stage,
  activity: row.activity, activityId: row.activity_id,
  createdAt: row.created_at.toISOString(), savedAt: row.saved_at?.toISOString() ?? null,
});
const sameConnection = (a: CharacterConnection, b: CharacterConnection) => a.accountId === b.accountId &&
  a.characterId === b.characterId && a.ownerId === b.ownerId && a.leaseGeneration === b.leaseGeneration &&
  a.connectionGeneration === b.connectionGeneration && a.activityId === b.activityId && a.sessionId === b.sessionId;

/** The sole mutation boundary for this staged profile. This is not a world or gameplay save. */
export class CharacterService {
  private readonly ownerId: string;
  private readonly leaseMs: number;
  private readonly hooks: CharacterServiceTestHooks | undefined;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly queues = new Map<string, { tail: Promise<unknown>; pending: number }>();
  private disposed = false;
  private worldContent?: WorldContent;
  private worldEnabled = false;
  private practiceEngine?: PracticeEngine;
  private practiceEnabled = false;

  configureWorld(content: WorldContent, enabled = (process.env['APP_MODE'] ?? 'local-preview') === 'local-preview' && ['development', 'test'].includes(process.env['NODE_ENV'] ?? 'development')) { this.worldContent = content; this.worldEnabled = enabled; }
  configurePractice(engine: PracticeEngine, enabled = (process.env['APP_MODE'] ?? 'local-preview') === 'local-preview' && ['development', 'test'].includes(process.env['NODE_ENV'] ?? 'development')) { this.practiceEngine = engine; this.practiceEnabled = enabled; }
  practiceAvailable(connection: CharacterConnection): boolean {
    return this.practiceEnabled && !!this.practiceEngine && this.snapshot(connection)?.character.stage === 'development-fixture';
  }

  constructor(private readonly database: Database, options: {
    ownerId?: string; leaseMs?: number; testHooks?: CharacterServiceTestHooks;
  } = {}) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.leaseMs = options.leaseMs ?? 15_000;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 100 || this.leaseMs > 300_000) throw new Error('Invalid lease duration.');
    if (options.testHooks && process.env['NODE_ENV'] !== 'test') throw new Error('Character failure injection is test-only.');
    this.hooks = options.testHooks;
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof CharacterServiceError) throw error;
      fail('DATABASE_UNAVAILABLE', 'Profile storage is unavailable. Reconnect and retry the same command.');
    }
  }

  // All character operations share this bounded queue. Database locks handle other service instances.
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(id) ?? { tail: Promise.resolve(), pending: 0 };
    if (queue.pending >= 32) return Promise.reject(new CharacterServiceError('RATE_LIMITED', 'Too many pending profile commands.'));
    queue.pending++;
    const next = queue.tail.catch(() => undefined).then(work);
    queue.tail = next;
    this.queues.set(id, queue);
    return next.finally(() => { if (--queue.pending === 0) this.queues.delete(id); });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>, kind?: WriteKind): Promise<T> {
    const client = await this.database.pool.connect();
    let committing = false;
    let destroy = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2500ms'");
      const result = await work(client);
      if (kind) await this.hooks?.beforeCommit?.(kind);
      committing = true;
      if (kind && this.hooks?.commit) await this.hooks.commit(client, kind);
      else await client.query('COMMIT');
      return result;
    } catch (error) {
      if (committing) { destroy = true; throw new UnknownCommit('The commit outcome needs receipt reconciliation.', { cause: error }); }
      try { await client.query('ROLLBACK'); } catch { destroy = true; }
      throw error;
    } finally { client.release(destroy); }
  }

  private async accountLock(client: PoolClient, accountId: string) {
    const account = await client.query('SELECT id FROM auth_user WHERE id=$1 FOR UPDATE', [accountId]);
    if (!account.rowCount) fail('AUTH_REQUIRED', 'The account session is no longer available.');
  }

  private async characterLock(client: PoolClient, accountId: string, characterId: string): Promise<CharacterRow> {
    const found = await client.query<CharacterRow>('SELECT * FROM characters WHERE id=$1 AND account_id=$2 FOR UPDATE', [characterId, accountId]);
    if (!found.rows[0]) fail('NOT_FOUND', 'No trainer profile belongs to this account.');
    return found.rows[0];
  }

  // Transport sessions are optional only for internal storage fixtures. Rooms always bind the authenticated session.
  // Consistent lock order is auth session, character, lease. Session revocation waits for an authorized commit.
  private async sessionLock(client: PoolClient, accountId: string, sessionId?: string) {
    if (!sessionId) return;
    const result = await client.query('SELECT id FROM auth_session WHERE id=$1 AND user_id=$2 AND expires_at > clock_timestamp() FOR SHARE', [sessionId, accountId]);
    if (!result.rowCount) fail('AUTH_REQUIRED', 'Your account session expired. Sign in again.');
  }

  private async leaseLock(client: PoolClient, connection: CharacterConnection) {
    const found = await client.query<LeaseRow>('SELECT *, expires_at > clock_timestamp() AS active FROM character_leases WHERE character_id=$1 FOR UPDATE', [connection.characterId]);
    const lease = found.rows[0];
    if (!lease || lease.owner_id !== connection.ownerId || Number(lease.lease_generation) !== connection.leaseGeneration ||
        Number(lease.connection_generation) !== connection.connectionGeneration) fail('SESSION_REPLACED', 'This trainer connection was replaced. Reconnect to continue.');
    if (!lease.active) fail('LEASE_EXPIRED', 'Trainer ownership expired. Reconnect to continue.');
  }

  private receipt(row: ReceiptRow | undefined, hash: string): CharacterView | undefined {
    if (!row) return undefined;
    if (row.payload_hash !== hash) fail('COMMAND_CONFLICT', 'This command ID was already used with different data.');
    return characterViewSchema.parse(row.result);
  }

  async get(accountId: string): Promise<CharacterView | null> {
    return this.guarded(async () => {
      const result = await this.database.pool.query<CharacterRow>('SELECT * FROM characters WHERE account_id=$1', [accountId]);
      return result.rows[0] ? view(result.rows[0]) : null;
    });
  }

  async create(accountId: string, input: CreateCharacter, sessionId?: string): Promise<CharacterView> {
    const parsed = createCharacterSchema.safeParse(input);
    if (!parsed.success) fail('NAME_INVALID', 'Use a unique command ID and a trainer name of 1–7 letters.');
    const command = parsed.data;
    const hash = fingerprint({ type: 'create-character', version: 1, name: command.name });
    return this.guarded(async () => {
      const readReceipt = async (client: PoolClient) => {
        await this.sessionLock(client, accountId, sessionId);
        await this.accountLock(client, accountId);
        const existing = await client.query<ReceiptRow>('SELECT * FROM account_creation_receipts WHERE account_id=$1 AND command_id=$2', [accountId, command.commandId]);
        return this.receipt(existing.rows[0], hash);
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.transaction(async client => {
            const previous = await readReceipt(client);
            if (previous) return previous;
            const existing = await client.query('SELECT id FROM characters WHERE account_id=$1', [accountId]);
            if (existing.rowCount) fail('CHARACTER_EXISTS', 'This account already has its trainer profile.');
            const inserted = await client.query<CharacterRow>('INSERT INTO characters (id, account_id, name, activity_id) VALUES ($1,$2,$3,$4) RETURNING *', [randomUUID(), accountId, command.name, randomUUID()]);
            const character = view(inserted.rows[0]);
            await client.query('INSERT INTO account_creation_receipts (account_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4)', [accountId, command.commandId, hash, JSON.stringify(character)]);
            return character;
          }, 'create');
        } catch (error) {
          if (!(error instanceof UnknownCommit)) throw error;
          // The same account lock waits for an in-flight transaction to finish before absence can mean retry.
          const recovered = await this.transaction(readReceipt);
          if (recovered) return recovered;
        }
      }
      return fail('COMMAND_OUTCOME_UNKNOWN', 'The profile command is unresolved. Retry the same command ID.');
    });
  }

  async acquire(accountId: string, characterId: string, sessionId?: string): Promise<{ connection: CharacterConnection; snapshot: SessionProjection }> {
    if (this.disposed) fail('NOT_READY', 'The character service is stopping.');
    return this.serial(characterId, () => this.guarded(async () => {
      const previous = this.runtimes.get(characterId);
      if (previous?.world && previous.connection.accountId === accountId) {
        previous.world.detached = true;
        this.finishMotion(previous, Date.now());
        if (previous.world.dirty && !previous.frozen) {
          try { await this.checkpoint(previous); }
          catch { previous.frozen = true; } // Revocation/outage never lets the old runtime delay fencing indefinitely.
        }
      }
      const acquired = await this.transaction(async client => {
        await this.sessionLock(client, accountId, sessionId);
        const character = view(await this.characterLock(client, accountId, characterId));
        const found = await client.query<LeaseRow>('SELECT *, expires_at > clock_timestamp() AS active FROM character_leases WHERE character_id=$1 FOR UPDATE', [characterId]);
        const old = found.rows[0];
        if (old?.active && old.owner_id !== this.ownerId) fail('BUSY', 'This trainer is still owned by another server. Retry after its lease expires.');
        const leaseGeneration = old ? Number(old.lease_generation) + (old.active ? 0 : 1) : 1;
        const connectionGeneration = old ? Number(old.connection_generation) + 1 : 1;
        if (!Number.isSafeInteger(leaseGeneration) || !Number.isSafeInteger(connectionGeneration)) fail('RECONNECT_REQUIRED', 'Trainer generation capacity is exhausted.');
        await client.query(`INSERT INTO character_leases (character_id,owner_id,lease_generation,connection_generation,expires_at)
          VALUES ($1,$2,$3,$4,clock_timestamp()+$5*interval '1 millisecond')
          ON CONFLICT (character_id) DO UPDATE SET owner_id=$2,lease_generation=$3,connection_generation=$4,expires_at=clock_timestamp()+$5*interval '1 millisecond'`,
        [characterId, this.ownerId, leaseGeneration, connectionGeneration, this.leaseMs]);
        const connection = Object.freeze({ accountId, characterId, ownerId: this.ownerId, leaseGeneration, connectionGeneration, activityId: character.activityId, ...(sessionId ? { sessionId } : {}) });
        return { connection, character };
      });
      this.runtimes.set(characterId, { ...acquired, frozen: false, suspended: false, heartbeatAt: Date.now() });
      return { connection: acquired.connection, snapshot: { character: structuredClone(acquired.character), connectionGeneration: acquired.connection.connectionGeneration, worldActive: false } };
    }));
  }

  snapshot(connection: CharacterConnection): SessionProjection | null {
    const runtime = this.runtimes.get(connection.characterId);
    return runtime && !runtime.frozen && sameConnection(runtime.connection, connection)
      ? { character: structuredClone(runtime.character), connectionGeneration: connection.connectionGeneration, worldActive: !!runtime.world } : null;
  }

  private runtime(connection: CharacterConnection): Runtime {
    const runtime = this.runtimes.get(connection.characterId);
    if (!runtime || !sameConnection(runtime.connection, connection)) fail('SESSION_REPLACED', 'This trainer connection was replaced. Reconnect to continue.');
    return runtime;
  }

  private assertTransport(runtime: Runtime) {
    if (runtime.suspended) fail('RECONNECT_REQUIRED', 'The trainer transport is suspended. Wait for reconnection.');
  }

  /** Stop new commands synchronously, then settle only the already accepted source-timed movement. */
  async suspendTransport(connection: CharacterConnection): Promise<void> {
    const current = this.runtime(connection);
    current.suspended = true;
    this.hideWorld(connection);
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      if (runtime.frozen) fail('RECONNECT_REQUIRED', 'The trainer must reload its committed state.');
      try {
        const world = runtime.world;
        if (world) world.detached = true;
        const dueAt = world?.transfer?.dueAt ?? (world?.motion ? world.motion.startedAt + world.motion.durationMs : 0);
        if (dueAt > Date.now()) await new Promise<void>(done => setTimeout(done, Math.min(1000, dueAt - Date.now())));
        this.finishMotion(runtime, Date.now());
        if (runtime.world?.transfer) await this.checkpoint(runtime, runtime.world.transfer);
        else if (runtime.world?.dirty) await this.checkpoint(runtime);
      } catch (error) { runtime.frozen = true; throw error; }
    }));
  }

  /** Same owner/activity, fresh transport generation. The queue prevents another local owner interleaving. */
  async resumeTransport(connection: CharacterConnection, deadline: number): Promise<{ connection: CharacterConnection; snapshot: SessionProjection }> {
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      if (!runtime.suspended || runtime.frozen || this.disposed || Date.now() >= deadline) fail('RECONNECT_REQUIRED', 'The transport reconnection window ended.');
      const generation = connection.connectionGeneration + 1;
      if (!Number.isSafeInteger(generation)) fail('RECONNECT_REQUIRED', 'Trainer generation capacity is exhausted.');
      let row: CharacterRow | undefined;
      try {
        for (let attempt = 0; attempt < 2 && !row; attempt++) {
          try {
            row = await this.transaction(async client => {
              await this.sessionLock(client, connection.accountId, connection.sessionId);
              const found = await this.characterLock(client, connection.accountId, connection.characterId);
              const result = await client.query<LeaseRow>('SELECT *, expires_at > clock_timestamp() AS active FROM character_leases WHERE character_id=$1 FOR UPDATE', [connection.characterId]);
              const lease = result.rows[0];
              if (!lease || lease.owner_id !== connection.ownerId || Number(lease.lease_generation) !== connection.leaseGeneration ||
                  ![connection.connectionGeneration, generation].includes(Number(lease.connection_generation))) fail('SESSION_REPLACED', 'Another connection owns this trainer.');
              if (!lease.active) fail('LEASE_EXPIRED', 'Trainer ownership expired.');
              // The target generation also reconciles a lost COMMIT acknowledgement, without a movement receipt.
              if (Number(lease.connection_generation) === connection.connectionGeneration) {
                if (Date.now() >= deadline) fail('RECONNECT_REQUIRED', 'The transport reconnection window ended.');
                await client.query("UPDATE character_leases SET connection_generation=$2,expires_at=clock_timestamp()+$3*interval '1 millisecond' WHERE character_id=$1", [connection.characterId, generation, this.leaseMs]);
              }
              return found;
            });
          } catch (error) { if (!(error instanceof UnknownCommit)) throw error; }
        }
        if (!row) fail('COMMAND_OUTCOME_UNKNOWN', 'Transport ownership could not be recovered. Reconnect explicitly.');
        runtime.connection = Object.freeze({ ...connection, connectionGeneration: generation });
        runtime.character = view(row);
        runtime.heartbeatAt = Date.now();
        // Presence remains hidden until the room accepts hello on the resumed transport.
        if (runtime.world) { runtime.world = this.worldFromRow(row); runtime.world.detached = true; }
        return { connection: runtime.connection, snapshot: { character: structuredClone(runtime.character), connectionGeneration: generation, worldActive: !!runtime.world } };
      } catch (error) { runtime.frozen = true; throw error; }
    }));
  }

  activateTransport(connection: CharacterConnection) {
    const runtime = this.runtime(connection);
    if (runtime.frozen || this.disposed) fail('RECONNECT_REQUIRED', 'The trainer must reconnect explicitly.');
    runtime.suspended = false;
    if (runtime.world) runtime.world.detached = false;
  }

  async heartbeat(connection: CharacterConnection): Promise<void> {
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      try {
        const latest = await this.transaction(async client => {
          await this.sessionLock(client, connection.accountId, connection.sessionId);
          const row = await this.characterLock(client, connection.accountId, connection.characterId);
          await this.leaseLock(client, connection);
          await client.query("UPDATE character_leases SET expires_at=clock_timestamp()+$2*interval '1 millisecond' WHERE character_id=$1", [connection.characterId, this.leaseMs]);
          return view(row);
        });
        runtime.character = runtime.world?.transfer ? { ...latest, activity: 'transferring' } : latest;
        runtime.frozen = false; runtime.heartbeatAt = Date.now();
      } catch (error) { runtime.frozen = true; throw error; }
    }));
  }

  async release(connection: CharacterConnection): Promise<void> {
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      try {
        if (runtime.world) {
          runtime.world.detached = true;
          this.finishMotion(runtime, Date.now());
          if (runtime.world.dirty && !runtime.frozen) await this.checkpoint(runtime);
        }
        await this.transaction(async client => {
          await this.characterLock(client, connection.accountId, connection.characterId);
          await this.leaseLock(client, connection);
          await client.query('UPDATE character_leases SET expires_at=clock_timestamp() WHERE character_id=$1', [connection.characterId]);
        });
      } finally { this.runtimes.delete(connection.characterId); }
    }));
  }

  async save(connection: CharacterConnection, input: SaveProfileCommand): Promise<ProfileSaved> {
    const parsed = saveProfileCommandSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Invalid profile checkpoint command.');
    const command = parsed.data;
    // Rebuild fixed fields so property insertion order cannot change the fingerprint.
    const hash = fingerprint({ type: command.type, version: command.version, activityId: command.activityId, expectedRevision: command.expectedRevision, payload: {} });
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      this.assertTransport(runtime);
      this.finishMotion(runtime, Date.now());
      if (runtime.world?.transfer) fail('BUSY', 'Wait for the map transition before saving.');
      const savedLocation = runtime.world && !runtime.world.detached ? { ...runtime.world.location, direction: runtime.world.direction } : undefined;
      const read = async (client: PoolClient) => {
        await this.sessionLock(client, connection.accountId, connection.sessionId);
        const row = await this.characterLock(client, connection.accountId, connection.characterId);
        await this.leaseLock(client, connection);
        const found = await client.query<ReceiptRow>('SELECT * FROM character_command_receipts WHERE character_id=$1 AND command_id=$2', [connection.characterId, command.commandId]);
        return { row, receipt: this.receipt(found.rows[0], hash) };
      };
      let outcome: SaveOutcome | undefined;
      try {
        for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
          try {
            outcome = await this.transaction(async client => {
              const { row, receipt } = await read(client);
              if (receipt) return { character: receipt, latest: view(row), replayed: true };
              if (row.activity === 'battle') fail('BUSY', 'Practice is saved after every action. Close practice before saving your world profile.');
              if (row.activity_id !== command.activityId || !['recovering', ...(savedLocation ? ['overworld'] : [])].includes(row.activity) || !['awaiting-new-game', 'development-fixture'].includes(row.stage)) fail('RECONNECT_REQUIRED', 'This command does not belong to the current trainer activity.');
              if (Number(row.revision) !== command.expectedRevision) fail('STALE_REVISION', 'The trainer profile changed. Refresh its current snapshot.');
              if (command.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('RECONNECT_REQUIRED', 'Trainer revision capacity is exhausted.');
              const changed = savedLocation
                ? await client.query<CharacterRow>('UPDATE characters SET revision=revision+1,saved_at=clock_timestamp(),map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing=$6,world_checkpoint_id=$7 WHERE id=$1 RETURNING *', [connection.characterId, savedLocation.mapId, savedLocation.x, savedLocation.y, savedLocation.elevation, savedLocation.direction, command.commandId])
                : await client.query<CharacterRow>('UPDATE characters SET revision=revision+1,saved_at=clock_timestamp() WHERE id=$1 RETURNING *', [connection.characterId]);
              const character = view(changed.rows[0]);
              await client.query('INSERT INTO character_command_receipts (character_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4)', [connection.characterId, command.commandId, hash, JSON.stringify(character)]);
              return { character, latest: character, replayed: false };
            }, 'save');
          } catch (error) {
            if (!(error instanceof UnknownCommit)) throw error;
            runtime.frozen = true;
            // Locking the character waits for the uncertain writer before we query its receipt.
            outcome = await this.transaction(async client => {
              const { row, receipt } = await read(client);
              return receipt ? { character: receipt, latest: view(row), replayed: true } : undefined;
            });
          }
        }
        if (!outcome) fail('COMMAND_OUTCOME_UNKNOWN', 'The profile checkpoint is unresolved. Retry the same command ID.');
        try {
          await this.hooks?.beforePublish?.();
          runtime.character = outcome.latest; runtime.frozen = false;
        } catch {
          runtime.frozen = true;
          // Never acknowledge an unreflected commit: reload under the same lease fence before resynchronizing.
          runtime.character = await this.transaction(async client => {
            await this.sessionLock(client, connection.accountId, connection.sessionId);
            const row = await this.characterLock(client, connection.accountId, connection.characterId);
            await this.leaseLock(client, connection);
            return view(row);
          });
          runtime.frozen = false;
        }
        if (savedLocation && runtime.world && !outcome.replayed) { runtime.world.lastCheckpointAt = Date.now(); runtime.world.dirty = false; }
        return { commandId: command.commandId, character: structuredClone(outcome.character), replayed: outcome.replayed };
      } catch (error) {
        if (!(error instanceof CharacterServiceError) || ['AUTH_REQUIRED', 'SESSION_REPLACED', 'LEASE_EXPIRED', 'COMMAND_OUTCOME_UNKNOWN'].includes(error.code)) runtime.frozen = true;
        throw error;
      }
    }));
  }

  private practice(): PracticeEngine {
    if (!this.practiceEnabled || !this.practiceEngine) fail('NOT_READY', 'Practice battles are available only in the local development mode.');
    return this.practiceEngine;
  }

  private practiceView(engine: PracticeEngine, row: PracticeRow | undefined): PracticeState {
    if (!row) return { revision: 0, session: null };
    const revision = Number(row.revision);
    if (!Number.isSafeInteger(revision) || revision < 0 || (row.battle_id === null) !== (row.checkpoint === null)) {
      fail('NOT_READY', 'The practice checkpoint needs administrative recovery.');
    }
    if (!row.battle_id || !row.checkpoint) return { revision, session: null };
    try { return { revision, session: engine.project(row.battle_id, row.checkpoint) }; }
    catch {
      // Old engine versions cannot be resumed, but the durable ID/revision still
      // permits an explicit close without interpreting or applying their data.
      return { revision, session: null, unavailable: { battleId: row.battle_id, message: 'This practice uses an unavailable engine version. Close it and start a new practice.' } };
    }
  }

  private practiceReply(engine: PracticeEngine, row: PracticeRow | undefined, commandId: string | null, replayed: boolean): PracticeSnapshot {
    return practiceSnapshotSchema.parse({ commandId, replayed, catalogue: engine.catalogue(), state: this.practiceView(engine, row) });
  }

  /** Authenticated owner-only projection; engine bytes, RNG and wild choices never leave this boundary. */
  async practiceSnapshot(connection: CharacterConnection, options: { handshakeRead?: true } = {}): Promise<PracticeSnapshot> {
    const engine = this.practice();
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      // Only the room's authenticated hello may read while native reconnection
      // remains suspended. It does not activate authority or world presence.
      if (!options.handshakeRead) this.assertTransport(runtime);
      const result = await this.transaction(async client => {
        const character = await this.worldRead(client, connection);
        await this.fixtureLock(client, character);
        const stored = await client.query<PracticeRow>('SELECT * FROM character_practice_state WHERE character_id=$1 FOR UPDATE', [connection.characterId]);
        return { character, practice: stored.rows[0] };
      });
      const reply = this.practiceReply(engine, result.practice, null, false);
      runtime.character = runtime.world?.transfer ? { ...view(result.character), activity: 'transferring' } : view(result.character);
      return reply;
    }));
  }

  /** Practice owns only its isolated checkpoint. No creature, bag, money or reward writes occur here. */
  async practiceCommand(connection: CharacterConnection, input: PracticeCommand): Promise<PracticeSnapshot> {
    const engine = this.practice();
    const parsed = practiceCommandSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Invalid practice command.');
    const command = parsed.data;
    const { commandId, ...payload } = command;
    const hash = fingerprint(payload);
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      this.assertTransport(runtime);
      const read = async (client: PoolClient) => {
        const character = await this.worldRead(client, connection);
        await this.fixtureLock(client, character);
        const stored = await client.query<PracticeRow>('SELECT * FROM character_practice_state WHERE character_id=$1 FOR UPDATE', [connection.characterId]);
        const receipt = await client.query<ReceiptRow>('SELECT * FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [connection.characterId, commandId]);
        if (receipt.rows[0] && receipt.rows[0].payload_hash !== hash) fail('COMMAND_CONFLICT', 'This practice command ID was already used with different data.');
        return { character, practice: stored.rows[0], replayed: !!receipt.rows[0] };
      };
      type Result = Awaited<ReturnType<typeof read>>;
      let result: Result | undefined;
      try {
        for (let attempt = 0; attempt < 2 && !result; attempt++) {
          try {
            result = await this.transaction(async client => {
              const current = await read(client);
              this.assertTransport(runtime);
              if (current.replayed) return current;
              const revision = Number(current.practice?.revision ?? 0);
              if (!Number.isSafeInteger(revision) || revision < 0) fail('NOT_READY', 'Invalid practice revision.');
              if (command.expectedRevision !== revision) fail('STALE_REVISION', 'Practice changed. Refresh before choosing again.');
              if (revision >= Number.MAX_SAFE_INTEGER) fail('NOT_READY', 'Practice revision capacity is exhausted.');
              let battleId = current.practice?.battle_id ?? null;
              let checkpoint = current.practice?.checkpoint ?? null;
              let character = current.character;
              if (command.kind === 'start') {
                if (battleId || checkpoint) fail('BUSY', 'Close the current practice before starting another.');
                // A fresh profile-only connection can retain a saved overworld activity.
                // Explicit practice may claim it without changing its durable location;
                // an active world runtime (including movement) still requires Leave first.
                if (runtime.world || !['recovering', 'overworld'].includes(character.activity)) fail('BUSY', 'Leave the shared world before starting practice.');
                battleId = randomUUID();
                try { checkpoint = engine.create(battleId, command.setup); }
                catch (error) {
                  if (error instanceof PracticeEngineError) fail(error.code, error.message);
                  fail('NOT_READY', 'The practice engine could not create this setup.');
                }
                if (Number(character.revision) >= Number.MAX_SAFE_INTEGER) fail('NOT_READY', 'Trainer revision capacity is exhausted.');
                const changed = await client.query<CharacterRow>("UPDATE characters SET activity='battle',activity_id=$2,revision=revision+1,saved_at=clock_timestamp() WHERE id=$1 RETURNING *", [character.id, randomUUID()]);
                character = changed.rows[0];
              } else {
                if (!battleId || !checkpoint || battleId !== command.battleId || character.activity !== 'battle') fail('STALE_REVISION', 'This practice is no longer active. Refresh its current state.');
                if (command.kind === 'choose') {
                  try { checkpoint = engine.advance(checkpoint, command.choice); }
                  catch (error) {
                    if (error instanceof PracticeEngineError) fail(error.code, error.message);
                    fail('NOT_READY', 'This practice cannot advance. Close it and start a new practice.');
                  }
                } else {
                  if (Number(character.revision) >= Number.MAX_SAFE_INTEGER) fail('NOT_READY', 'Trainer revision capacity is exhausted.');
                  // Closing is deliberately independent of obsolete/corrupt engine data.
                  battleId = null; checkpoint = null;
                  const changed = await client.query<CharacterRow>("UPDATE characters SET activity='recovering',activity_id=$2,revision=revision+1,saved_at=clock_timestamp() WHERE id=$1 RETURNING *", [character.id, randomUUID()]);
                  character = changed.rows[0];
                }
              }
              this.assertTransport(runtime);
              // Validate the exact public candidate before the durable write as well as after recovery.
              if (battleId && checkpoint) {
                try { engine.project(battleId, checkpoint); }
                catch { fail('NOT_READY', 'The practice candidate could not be projected safely.'); }
              }
              const updated = await client.query<PracticeRow>(`INSERT INTO character_practice_state (character_id,revision,battle_id,checkpoint)
                VALUES ($1,$2,$3,$4) ON CONFLICT (character_id) DO UPDATE SET revision=$2,battle_id=$3,checkpoint=$4,updated_at=clock_timestamp() RETURNING *`,
              [connection.characterId, revision + 1, battleId, checkpoint ? JSON.stringify(checkpoint) : null]);
              await client.query('INSERT INTO practice_command_receipts (character_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4)',
                [connection.characterId, commandId, hash, JSON.stringify({ revision: revision + 1, battleId })]);
              return { character, practice: updated.rows[0], replayed: false };
            }, 'practice');
          } catch (error) {
            if (!(error instanceof UnknownCommit)) throw error;
            runtime.frozen = true;
            // The same character row lock waits for an uncertain writer before a missing receipt permits retry.
            const recovered = await this.transaction(read);
            if (recovered.replayed) result = recovered;
          }
        }
        if (!result) fail('COMMAND_OUTCOME_UNKNOWN', 'Practice could not confirm this command. Reconnect and retry the same command ID.');
        try { await this.hooks?.beforePublish?.(); }
        catch {
          runtime.frozen = true;
          result = await this.transaction(read);
          if (!result.replayed) fail('COMMAND_OUTCOME_UNKNOWN', 'Practice could not recover its committed command.');
        }
        const reply = this.practiceReply(engine, result.practice, commandId, result.replayed);
        runtime.character = runtime.world?.transfer ? { ...view(result.character), activity: 'transferring' } : view(result.character);
        runtime.frozen = false;
        return reply;
      } catch (error) {
        if (!(error instanceof CharacterServiceError) || ['AUTH_REQUIRED', 'SESSION_REPLACED', 'LEASE_EXPIRED', 'COMMAND_OUTCOME_UNKNOWN'].includes(error.code)) runtime.frozen = true;
        throw error;
      }
    }));
  }

  private content(): WorldContent {
    if (!this.worldContent) fail('NOT_READY', 'Shared development world content is not available.');
    return this.worldContent;
  }

  private location(row: CharacterRow): WorldLocation {
    try { return this.content().validateLocation({ mapId: row.map_id, x: row.position_x, y: row.position_y, elevation: row.position_elevation }); }
    catch { return fail('NOT_READY', 'The saved location is not supported by this development world.'); }
  }

  private worldFromRow(row: CharacterRow, previous?: WorldRuntime): WorldRuntime {
    return { location: this.location(row), direction: row.position_facing ?? 'south', zoneGeneration: Number(row.transition_generation),
      lastInputSequence: previous?.lastInputSequence ?? 0, motion: null, lastCheckpointAt: Date.now(), dirty: false, detached: false };
  }

  private async fixtureLock(client: PoolClient, row: CharacterRow) {
    if (row.stage !== 'development-fixture') fail('NOT_READY', 'Shared exploration requires the explicit offline r1-squirtle-v1 development fixture.');
    const marker = await client.query(`SELECT 1 FROM domain_outcomes o JOIN content_versions v ON v.content_hash=o.content_hash
      JOIN character_flags f ON f.character_id=o.character_id AND f.flag_key=$4
      WHERE o.character_id=$1 AND o.type='development-seed' AND o.business_key=$2 AND o.content_hash=$3 AND v.source_fingerprint=$5`,
    [row.id, DEVELOPMENT_PROFILE_ID, DEVELOPMENT_CONTENT_HASH, `development:${DEVELOPMENT_PROFILE_ID}:initialized`, WORLD_SOURCE_FINGERPRINT]);
    if (!marker.rowCount) fail('NOT_READY', 'The named development fixture or its pinned source marker is missing.');
    this.location(row);
  }

  private async worldRead(client: PoolClient, connection: CharacterConnection): Promise<CharacterRow> {
    await this.sessionLock(client, connection.accountId, connection.sessionId);
    const row = await this.characterLock(client, connection.accountId, connection.characterId);
    await this.leaseLock(client, connection);
    return row;
  }

  // Called only under the character queue. Movement is server memory; durable checkpoints remain transaction-fenced.
  private finishMotion(runtime: Runtime, now: number) {
    const world = runtime.world;
    if (world?.motion && now >= world.motion.startedAt + world.motion.durationMs) {
      world.location = { ...world.motion.to }; world.motion = null; world.dirty = true;
    }
  }

  /** Immediately hides a disconnected/fenced transport; its queued cleanup may still checkpoint an authorized last tile. */
  hideWorld(connection: CharacterConnection) {
    const runtime = this.runtimes.get(connection.characterId);
    if (runtime && sameConnection(runtime.connection, connection) && runtime.world) runtime.world.detached = true;
  }

  worldProjection(connection: CharacterConnection, now = Date.now()): WorldProjection | null {
    const runtime = this.runtimes.get(connection.characterId);
    const world = runtime?.world;
    if (!runtime || !world || world.detached || runtime.suspended || runtime.frozen || !sameConnection(runtime.connection, connection) || now - runtime.heartbeatAt >= this.leaseMs) return null;
    return structuredClone({ avatar: { id: runtime.character.id, name: runtime.character.name, ...world.location, direction: world.direction, motion: world.motion },
      zoneGeneration: world.zoneGeneration, lastInputSequence: world.lastInputSequence, ...(world.transition ? { transition: world.transition } : {}) });
  }

  worldAvatars(mapId: string, exceptId: string, now = Date.now()): WorldAvatar[] {
    const avatars: WorldAvatar[] = [];
    for (const runtime of this.runtimes.values()) {
      const projection = this.worldProjection(runtime.connection, now);
      if (projection && projection.avatar.mapId === mapId && projection.avatar.id !== exceptId) avatars.push(projection.avatar);
    }
    return avatars.sort((a, b) => a.id.localeCompare(b.id));
  }

  async enterWorld(connection: CharacterConnection, input: WorldCommand): Promise<SessionProjection> {
    if (!this.worldEnabled) fail('NOT_READY', 'Shared exploration is restricted to the local development mode.');
    const parsed = worldCommandSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Invalid shared world entry command.');
    const command = parsed.data;
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      this.assertTransport(runtime);
      const previous = runtime.world;
      const row = await this.worldCommand(runtime, 'enter', command);
      if (row.activity !== 'overworld') fail('RECONNECT_REQUIRED', 'That entry command belongs to an earlier activity. Refresh and enter again.');
      // Receipt replay during this activity must not rewind uncheckpointed motion.
      if (!previous || previous.detached) runtime.world = this.worldFromRow(row);
      const character = view(row);
      runtime.character = runtime.world?.transfer ? { ...character, activity: 'transferring' } : character;
      runtime.frozen = false;
      return this.snapshot(connection)!;
    }));
  }

  async leaveWorld(connection: CharacterConnection, input: WorldCommand): Promise<CharacterView> {
    const parsed = worldCommandSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Invalid shared world exit command.');
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      this.assertTransport(runtime);
      this.finishMotion(runtime, Date.now());
      if (runtime.world?.transfer) fail('BUSY', 'Wait for the map transition before leaving.');
      const row = await this.worldCommand(runtime, 'leave', parsed.data);
      if (row.activity !== 'recovering') fail('RECONNECT_REQUIRED', 'That exit command belongs to an earlier activity. Refresh the current world connection.');
      runtime.character = view(row);
      runtime.world = undefined;
      return structuredClone(runtime.character);
    }));
  }

  private async worldCommand(runtime: Runtime, kind: 'enter' | 'leave', command: WorldCommand): Promise<CharacterRow> {
    const connection = runtime.connection;
    const hash = fingerprint({ type: `${kind}-world`, version: 1, activityId: command.activityId, expectedRevision: command.expectedRevision });
    const read = async (client: PoolClient) => {
      const row = await this.worldRead(client, connection);
      const receipt = await client.query<ReceiptRow>('SELECT * FROM character_command_receipts WHERE character_id=$1 AND command_id=$2', [row.id, command.commandId]);
      return { row, receipt: this.receipt(receipt.rows[0], hash) };
    };
    let result: CharacterRow | undefined;
    try {
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
          result = await this.transaction(async client => {
            const { row, receipt } = await read(client);
            if (kind === 'enter') await this.fixtureLock(client, row);
            if (receipt) return row;
            if (kind === 'enter' && runtime.world && !runtime.world.detached) fail('BUSY', 'This trainer is already exploring the shared world.');
            if (kind === 'leave') await this.fixtureLock(client, row);
            if (row.activity_id !== command.activityId || Number(row.revision) !== command.expectedRevision) fail('STALE_REVISION', 'The trainer activity changed. Refresh before continuing.');
            if (!['recovering', 'overworld'].includes(row.activity)) fail('RECONNECT_REQUIRED', 'Another trainer activity owns this character.');
            if (kind === 'leave' && (!runtime.world || row.activity !== 'overworld')) fail('NOT_READY', 'This trainer is not in the shared world.');
            if (Number(row.revision) >= Number.MAX_SAFE_INTEGER || Number(row.transition_generation) >= Number.MAX_SAFE_INTEGER) fail('RECONNECT_REQUIRED', 'Trainer counter capacity is exhausted.');
            const location = kind === 'leave' ? runtime.world!.location : this.location(row);
            const direction = kind === 'leave' ? runtime.world!.direction : row.position_facing!;
            const changed = await client.query<CharacterRow>(`UPDATE characters SET activity=$2,activity_id=$3,revision=revision+1,saved_at=clock_timestamp(),
              map_id=$4,position_x=$5,position_y=$6,position_elevation=$7,position_facing=$8,transition_generation=transition_generation+1,world_checkpoint_id=$9 WHERE id=$1 RETURNING *`,
            [row.id, kind === 'enter' ? 'overworld' : 'recovering', randomUUID(), location.mapId, location.x, location.y, location.elevation, direction, command.commandId]);
            await client.query('INSERT INTO character_command_receipts (character_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4)', [row.id, command.commandId, hash, JSON.stringify(view(changed.rows[0]))]);
            return changed.rows[0];
          }, 'world');
        } catch (error) {
          if (!(error instanceof UnknownCommit)) throw error;
          runtime.frozen = true;
          result = await this.transaction(async client => { const { row, receipt } = await read(client); return receipt ? row : undefined; });
        }
      }
      if (!result) fail('COMMAND_OUTCOME_UNKNOWN', 'The world command is unresolved. Reconnect and retry the same command.');
      try { await this.hooks?.beforePublish?.(); }
      catch { runtime.frozen = true; result = await this.transaction(client => this.worldRead(client, connection)); }
      runtime.frozen = false;
      return result;
    } catch (error) { if (!(error instanceof CharacterServiceError) || ['AUTH_REQUIRED', 'LEASE_EXPIRED', 'SESSION_REPLACED'].includes(error.code)) runtime.frozen = true; throw error; }
  }

  async worldInput(connection: CharacterConnection, input: WorldInput): Promise<void> {
    const parsed = worldInputSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Shared movement accepts only bounded directional input.');
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection), world = runtime.world;
      this.assertTransport(runtime);
      if (!world || world.detached || runtime.frozen) fail('RECONNECT_REQUIRED', 'Enter the shared world before moving.');
      // One read-only fence inside the serialized mutation boundary; no lease update or per-packet receipt.
      // Session revocation and takeover are observed even if a packet waited behind a durable save.
      try {
        const result = await this.database.pool.query<LeaseRow & { session_valid: boolean }>(`SELECT l.*,l.expires_at>clock_timestamp() AS active,
          ($4::text IS NULL OR EXISTS (SELECT 1 FROM auth_session s WHERE s.id=$4 AND s.user_id=$2 AND s.expires_at>clock_timestamp())) AS session_valid
          FROM character_leases l JOIN characters c ON c.id=l.character_id WHERE l.character_id=$1 AND c.account_id=$2 AND l.owner_id=$3`,
        [connection.characterId, connection.accountId, connection.ownerId, connection.sessionId ?? null]);
        const lease = result.rows[0];
        if (!lease || Number(lease.lease_generation) !== connection.leaseGeneration || Number(lease.connection_generation) !== connection.connectionGeneration) fail('SESSION_REPLACED', 'This trainer connection was replaced.');
        if (!lease.session_valid) fail('AUTH_REQUIRED', 'Your account session ended. Sign in again.');
        if (!lease.active) fail('LEASE_EXPIRED', 'Trainer ownership expired. Reconnect.');
      } catch (error) { runtime.frozen = true; throw error; }
      this.assertTransport(runtime);
      const intent = parsed.data, now = Date.now();
      if (now - runtime.heartbeatAt >= this.leaseMs) { runtime.frozen = true; fail('LEASE_EXPIRED', 'Trainer ownership expired. Reconnect.'); }
      if (intent.connectionGeneration !== connection.connectionGeneration || intent.zoneGeneration !== world.zoneGeneration) fail('RECONNECT_REQUIRED', 'This movement belongs to an old connection or map.');
      if (intent.sequence <= world.lastInputSequence) return; // Old packets cannot alter direction or consume a tile.
      // Gaps are legal: transport/room backpressure can reject an earlier packet before it reaches this queue.
      this.finishMotion(runtime, now);
      world.lastInputSequence = intent.sequence;
      if (world.motion || world.transfer) fail('BUSY', 'The previous step is still in progress.');
      world.direction = intent.direction; world.dirty = true; world.transition = undefined;
      const move = this.content().move(world.location, intent.direction, intent.run);
      if (!move.allowed) {
        if (move.reason === 'unsupported-destination') fail('UNSUPPORTED_MESSAGE', 'That destination is outside the three-map development world.');
        if (['unsupported-terrain', 'invalid-position', 'invalid-warp'].includes(move.reason)) fail('UNSUPPORTED_MESSAGE', 'This terrain or transfer is not supported by the development world.');
        return; // Collision is an acknowledged stationary input, not a failed save.
      }
      if (move.kind === 'transition') {
        const forcedArrival = move.arrival && (move.arrival.x !== move.position.x || move.arrival.y !== move.position.y) ? 16 : 0;
        const durationMs = (move.durationFrames + forcedArrival) * 1000 / 60;
        world.transfer = { move, from: { ...world.location }, dueAt: now + durationMs, durationMs };
        runtime.character = { ...runtime.character, activity: 'transferring' };
      }
      else world.motion = { from: { ...world.location }, to: worldLocationSchema.parse(move.position), startedAt: now, durationMs: move.durationFrames * 1000 / 60, kind: move.kind, movementMode: move.movementMode };
    }));
  }

  private async checkpoint(runtime: Runtime, transfer?: NonNullable<WorldRuntime['transfer']>): Promise<void> {
    const world = runtime.world;
    if (!world) return;
    const connection = runtime.connection, checkpointId = randomUUID(), expectedRevision = runtime.character.revision;
    const target = transfer ? worldLocationSchema.parse(transfer.move.position) : { ...world.location };
    const direction = transfer?.move.direction ?? world.direction;
    let result: CharacterRow | undefined;
    const read = (client: PoolClient) => this.worldRead(client, connection);
    try {
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
          result = await this.transaction(async client => {
            const row = await read(client);
            if (row.world_checkpoint_id === checkpointId) return row;
            if (row.activity !== 'overworld' || row.activity_id !== runtime.character.activityId || Number(row.revision) !== expectedRevision) fail('RECONNECT_REQUIRED', 'The world checkpoint lost its activity owner.');
            if (Number(row.revision) >= Number.MAX_SAFE_INTEGER || (transfer && Number(row.transition_generation) >= Number.MAX_SAFE_INTEGER)) fail('RECONNECT_REQUIRED', 'Trainer counter capacity is exhausted.');
            const changed = await client.query<CharacterRow>(`UPDATE characters SET map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing=$6,
              revision=revision+1,saved_at=clock_timestamp(),world_checkpoint_id=$7,transition_generation=transition_generation+$8 WHERE id=$1 RETURNING *`,
            [row.id, target.mapId, target.x, target.y, target.elevation, direction, checkpointId, transfer ? 1 : 0]);
            return changed.rows[0];
          }, 'world');
        } catch (error) {
          if (!(error instanceof UnknownCommit)) throw error;
          runtime.frozen = true;
          result = await this.transaction(async client => { const row = await read(client); return row.world_checkpoint_id === checkpointId ? row : undefined; });
        }
      }
      if (!result) fail('COMMAND_OUTCOME_UNKNOWN', 'The world checkpoint is unresolved. Reconnect to recover.');
      try { await this.hooks?.beforePublish?.(); }
      catch { runtime.frozen = true; result = await this.transaction(read); }
      runtime.character = view(result);
      // A single location owner also defines map membership, so there is no second room copy to publish before commit.
      runtime.world = this.worldFromRow(result, world);
      runtime.world.detached = world.detached;
      // A periodic checkpoint records the last finished tile without cancelling an accepted in-flight step.
      // Its completion will mark the new location dirty again, including if COMMIT took longer than the animation.
      if (!transfer && !world.detached) runtime.world.motion = world.motion;
      if (transfer) runtime.world.transition = { id: checkpointId, via: transfer.move.via, from: transfer.from, to: this.location(result),
        arrival: transfer.move.arrival ? worldLocationSchema.parse(transfer.move.arrival) : null, direction, durationMs: transfer.durationMs };
      runtime.frozen = false;
    } catch (error) { runtime.frozen = true; throw error; }
  }

  async tickWorld(now = Date.now()): Promise<{ connection: CharacterConnection; error: unknown }[]> {
    const results = await Promise.all([...this.runtimes.values()].filter(runtime => runtime.world && !runtime.world.detached && !runtime.suspended && !runtime.frozen).map(runtime =>
      this.serial(runtime.connection.characterId, () => this.guarded(async () => {
        if (!this.runtimes.has(runtime.connection.characterId) || this.runtimes.get(runtime.connection.characterId) !== runtime || !runtime.world || runtime.world.detached || runtime.suspended || runtime.frozen) return;
        if (now - runtime.heartbeatAt >= this.leaseMs) { runtime.frozen = true; fail('LEASE_EXPIRED', 'Trainer ownership expired. Reconnect.'); }
        this.finishMotion(runtime, now);
        if (runtime.world.transfer && now >= runtime.world.transfer.dueAt) await this.checkpoint(runtime, runtime.world.transfer);
        else if (!runtime.world.transfer && runtime.world.dirty && now - runtime.world.lastCheckpointAt >= 5000) await this.checkpoint(runtime);
      })).then(() => undefined, error => ({ connection: runtime.connection, error }))));
    return results.filter((result): result is { connection: CharacterConnection; error: unknown } => result !== undefined);
  }

  /** Graceful transport cleanup saves only a finished tile; revoked sessions cannot write and are still hidden. */
  async checkpointWorldOnDisconnect(connection: CharacterConnection): Promise<void> {
    this.hideWorld(connection);
    return this.serial(connection.characterId, () => this.guarded(async () => {
      const runtime = this.runtime(connection);
      this.finishMotion(runtime, Date.now());
      if (runtime.world?.dirty && !runtime.frozen) await this.checkpoint(runtime);
    }));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.runtimes.values()].map(runtime => this.release(runtime.connection)));
  }
}
