import { CHARACTER_RULES_VERSION, PROTOCOL_VERSION, SERVER_VERSION, WORLD_POLICY, type CharacterError, type CharacterSnapshot, type WorldSnapshot } from '@pokewaterblue/protocol';
import { CharacterService, type CharacterConnection } from './character-service.js';
import { publicError } from './account-api.js';
import { WORLD_SOURCE_FINGERPRINT } from './world-content.js';
import { log } from './logger.js';

interface Subscriber {
  connection: CharacterConnection;
  world: (state: WorldSnapshot) => void;
  character: (state: CharacterSnapshot) => void;
  fail: (error: CharacterError) => void;
  lastCharacter?: string;
}

/** Logical per-map zones on the authenticated character transport; positions live only in CharacterService. */
export class WorldService {
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly timer: ReturnType<typeof setInterval>;
  private activeTick?: Promise<void>;
  private lastPublication = 0;

  constructor(private readonly characters: CharacterService, private readonly contentHash: string) {
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!this.activeTick) {
        this.activeTick = characters.tickWorld(now).then(errors => {
          for (const failure of errors) {
            const subscriber = this.subscribers.get(failure.connection.characterId);
            if (subscriber?.connection === failure.connection) {
              this.detach(failure.connection);
              try { subscriber.fail(publicError(failure.error)); } catch { /* Closed transport; authority is already detached. */ }
            }
          }
        }).catch(() => {
          log('error', 'world_tick_failed');
          for (const subscriber of [...this.subscribers.values()]) {
            this.detach(subscriber.connection);
            try { subscriber.fail({ code: 'RECONNECT_REQUIRED', message: 'World simulation stopped. Reconnect to recover.' }); } catch { /* Closed transport. */ }
          }
        }).finally(() => { this.activeTick = undefined; });
      }
      if (now - this.lastPublication >= 100) {
        this.lastPublication = now;
        for (const subscriber of this.subscribers.values()) this.publish(subscriber, now);
      }
    }, 50);
    this.timer.unref();
  }

  attach(subscriber: Subscriber) {
    const current = this.characters.snapshot(subscriber.connection)?.character;
    // Initial admission is acknowledged only by explicit hello, after its auth/lease checks finish.
    // Autonomous publications start when a later durable revision or activity actually changes.
    if (current) subscriber.lastCharacter = `${current.revision}:${current.activityId}:${current.activity}`;
    this.subscribers.set(subscriber.connection.characterId, subscriber);
  }
  detach(connection: CharacterConnection) {
    this.characters.hideWorld(connection);
    if (this.subscribers.get(connection.characterId)?.connection === connection) this.subscribers.delete(connection.characterId);
  }
  publishFor(connection: CharacterConnection) {
    const subscriber = this.subscribers.get(connection.characterId);
    if (subscriber?.connection === connection) this.publish(subscriber, Date.now());
  }
  private publish(subscriber: Subscriber, now: number) {
    try { this.publishState(subscriber, now); }
    catch {
      this.detach(subscriber.connection);
      try { subscriber.fail({ code: 'RECONNECT_REQUIRED', message: 'World publication failed. Reconnect to reload committed state.' }); } catch { /* Transport is already lost; authority is detached. */ }
    }
  }
  private publishState(subscriber: Subscriber, now: number) {
    const privateState = this.characters.snapshot(subscriber.connection);
    if (!privateState) return;
    const key = `${privateState.character.revision}:${privateState.character.activityId}:${privateState.character.activity}`;
    if (key !== subscriber.lastCharacter) {
      subscriber.lastCharacter = key;
      subscriber.character({ protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION, contentHash: this.contentHash,
        rulesVersion: CHARACTER_RULES_VERSION, ...privateState });
    }
    const state = this.characters.worldProjection(subscriber.connection, now);
    if (!state) return;
    subscriber.world({ mode: 'shared-development', policy: WORLD_POLICY, contentHash: this.contentHash, sourceFingerprint: WORLD_SOURCE_FINGERPRINT,
      serverTime: now, connectionGeneration: subscriber.connection.connectionGeneration, zoneGeneration: state.zoneGeneration,
      lastInputSequence: state.lastInputSequence, self: state.avatar,
      nearby: this.characters.worldAvatars(state.avatar.mapId, state.avatar.id, now), ...(state.transition ? { transition: state.transition } : {}) });
  }
  async close() { clearInterval(this.timer); await this.activeTick; this.subscribers.clear(); }
}
