import { Client, type Room } from '@colyseus/sdk';
import './accounts.css';
import { renderTrainerAssets } from './trainer-assets.js';
import {
  CHARACTER_ROOM, CHARACTER_RECONNECT_GRACE_MS, PROTOCOL_VERSION, accountViewSchema, characterViewSchema, characterTicketSchema,
  characterSnapshotSchema, profileSavedSchema, characterErrorSchema, trainerNameSchema, trainerAssetsSchema,
  type AccountView, type CharacterSnapshot, type SaveProfileCommand, type CreateCharacter, type TrainerAssets,
  worldSnapshotSchema, worldLeftSchema, type WorldSnapshot, type WorldCommand,
} from '@pokewaterblue/protocol';
import type { Direction } from '@pokewaterblue/game-rules';

export type WorldConnectionState = 'preview' | 'shared' | 'reconnecting' | 'disconnected';
export interface AccountWorldBridge {
  canEnter: () => boolean;
  onState: (state: WorldConnectionState) => void;
  onSnapshot: (snapshot: WorldSnapshot) => boolean;
  onError: (message: string) => void;
  onInputBusy: () => void;
}

/** Profile persistence is separate from the renderer's local exploration. */
export function attachAccounts(onOpen: () => void, onClose: () => void, worldBridge: AccountWorldBridge) {
  const trigger = document.querySelector<HTMLButtonElement>('#account-button')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'account-dialog'; dialog.className = 'account-dialog';
  dialog.setAttribute('aria-labelledby', 'account-title');
  dialog.innerHTML = `
    <header class="account-header"><div><p class="eyebrow">Your adventure</p><h2 id="account-title">Trainer account</h2></div><button class="button" id="account-close" type="button">Close account</button></header>
    <div class="account-body">
      <p class="account-intro">Keep your trainer on this computer. Local development trainers can enter the shared world; anonymous exploration remains a separate preview.</p>
      <p id="account-status" class="account-status" role="status" aria-live="polite">Checking your account…</p>
      <section id="account-auth" class="hidden">
        <div class="account-tabs" aria-label="Account action"><button class="button" id="account-signin-mode" type="button" aria-pressed="true">Sign in</button><button class="button" id="account-signup-mode" type="button" aria-pressed="false">Create account</button></div>
        <form id="account-auth-form">
          <label for="account-email">Email<input id="account-email" type="email" autocomplete="email" maxlength="254" required /></label>
          <label for="account-password">Password<input id="account-password" type="password" autocomplete="current-password" minlength="12" maxlength="128" required /></label>
          <p class="account-note" id="account-password-note">Use your account password.</p>
          <button class="button primary-button" id="account-auth-submit" type="submit">Sign in to account</button>
        </form>
      </section>
      <section id="account-profile" class="hidden">
        <p id="account-email-display" class="account-email"></p>
        <form id="account-trainer-form" class="hidden">
          <h3>Create your trainer</h3><label for="account-trainer-name">Trainer name<input id="account-trainer-name" type="text" autocomplete="off" pattern="[A-Za-z]{1,7}" maxlength="7" required /></label>
          <p class="account-note">Choose 1–7 letters. One trainer per account for now.</p>
          <button class="button primary-button" id="account-create-trainer" type="submit">Create trainer</button>
        </form>
        <section id="account-trainer" class="hidden" aria-label="Saved trainer">
          <div class="trainer-card"><span class="trainer-emblem" aria-hidden="true">●</span><div><p class="eyebrow">Trainer profile</p><h3 id="account-trainer-display"></h3><p id="account-saved-at" class="account-note"></p></div></div>
          <p class="account-note" id="account-stage-note">Your trainer is saved. Anonymous exploration does not save game progress; the opening adventure is coming soon.</p>
          <div class="account-actions"><button class="button primary-button" id="account-connect" type="button">Connect trainer</button><button class="button" id="account-save" type="button" disabled>Save trainer</button></div>
          <div class="account-actions hidden" id="account-world-actions"><button class="button primary-button" id="account-world-enter" type="button">Enter shared world</button><button class="button hidden" id="account-world-leave" type="button">Leave shared world</button></div>
          <details id="account-assets-details" class="account-assets-details"><summary>Saved party &amp; bag</summary><section id="account-assets" aria-label="Saved party and bag"></section></details>
        </section>
        <button class="button" id="account-signout" type="button">Sign out</button>
      </section>
      <button class="button hidden" id="account-retry" type="button">Check account again</button>
    </div>`;
  document.querySelector('main')!.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  let account: AccountView | null = null;
  let assets: TrainerAssets | null = null;
  let snapshot: CharacterSnapshot | null = null;
  let room: Room | undefined;
  let operation = 0, busy = false, signup = false;
  let pendingSave: SaveProfileCommand | null = null;
  let pendingCreate: CreateCharacter | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let saveRetries = 0;
  let destroyed = false;
  let worldState: WorldConnectionState = 'preview', wantsWorld = false;
  let shared: WorldSnapshot | null = null;
  let sequence = 0, lastWorldAt = 0;
  let recovery: { room: Room; deadline: number; previousGeneration: number; transportReady: boolean; privateReady: boolean; helloRetries: number;
    timer: ReturnType<typeof setTimeout>; helloTimer?: ReturnType<typeof setTimeout>; snapshotTimer?: ReturnType<typeof setTimeout> } | undefined;
  let worldRequest: { commandId: string; command: WorldCommand; kind: 'enter' | 'leave'; retries: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout> } | undefined;
  const setWorldState = (state: WorldConnectionState) => { if (worldState === state) return; worldState = state; worldBridge.onState(state); };
  const failWorldRequest = (message: string) => {
    if (!worldRequest) return;
    const request = worldRequest; worldRequest = undefined; clearTimeout(request.timer); clearTimeout(request.retryTimer); request.reject(new Error(message));
  };
  const finishWorldRequest = () => {
    if (!worldRequest) return;
    const request = worldRequest; worldRequest = undefined; clearTimeout(request.timer); clearTimeout(request.retryTimer); request.resolve();
  };
  const status = (text: string, error = false) => {
    el('account-status').textContent = text;
    el('account-status').classList.toggle('account-error', error);
  };
  const clearSaveTimers = () => {
    clearTimeout(saveTimer); saveTimer = undefined;
    clearTimeout(saveRetryTimer); saveRetryTimer = undefined;
    saveRetries = 0;
  };
  const recoveryNotice = 'Connection interrupted. Reconnecting for up to 60 seconds; movement is paused.';
  const clearRecovery = () => {
    if (!recovery) return;
    clearTimeout(recovery.timer); clearTimeout(recovery.helloTimer); clearTimeout(recovery.snapshotTimer); recovery = undefined;
  };
  const finishRecovery = () => {
    clearRecovery();
    status(pendingSave ? 'Trainer reconnected. Save confirmation is unknown. Retry save to check the same command safely.'
      : worldState === 'shared' ? 'Shared world reconnected. Release and press a direction to move.' : 'Trainer reconnected.');
    render();
  };
  function render() {
    dialog.dataset.connectionState = recovery ? 'reconnecting' : room ? 'connected' : 'disconnected';
    el('account-trainer').dataset.connectionGeneration = String(snapshot?.connectionGeneration ?? 0);
    el('account-auth').classList.toggle('hidden', !!account);
    el('account-profile').classList.toggle('hidden', !account);
    el('account-trainer-form').classList.toggle('hidden', !account || !!account.character);
    el('account-trainer').classList.toggle('hidden', !account?.character);
    el('account-email-display').textContent = account?.user.email ?? '';
    trigger.textContent = account?.character ? account.character.name : 'Account';
    if (account?.character) {
      el('account-trainer-display').textContent = account.character.name;
      el('account-saved-at').textContent = account.character.savedAt
        ? `Saved ${new Date(account.character.savedAt).toLocaleString()}` : 'Trainer created and saved.';
      el('account-trainer').dataset.revision = String(account.character.revision);
      el('account-stage-note').textContent = recovery ? 'Connection interrupted. Movement and Save are paused while your trainer reconnects.' : account.character.stage === 'development-fixture'
        ? worldState === 'shared' ? 'Shared development world. Save trainer checkpoints your current location.' : 'Local development trainer. Enter the shared world to explore with other trainers.'
        : 'Your trainer is saved. Anonymous exploration does not save game progress; the opening adventure is coming soon.';
    }
    renderTrainerAssets(el('account-assets'), assets);
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.id !== 'account-close') button.disabled = busy;
    }
    el<HTMLButtonElement>('account-save').disabled = busy || !!recovery || !room?.connection.isOpen || !snapshot;
    el('account-save').textContent = pendingSave ? 'Retry save' : 'Save trainer';
    el<HTMLButtonElement>('account-connect').disabled = busy || !!room;
    el('account-connect').textContent = recovery ? 'Reconnecting trainer…' : room ? 'Trainer connected' : snapshot ? 'Reconnect trainer' : 'Connect trainer';
    el('account-world-actions').classList.toggle('hidden', account?.character?.stage !== 'development-fixture');
    el('account-world-enter').classList.toggle('hidden', worldState === 'shared' || worldState === 'reconnecting');
    el<HTMLButtonElement>('account-world-enter').disabled = busy || !!recovery || !worldBridge.canEnter();
    el('account-world-enter').textContent = worldState === 'disconnected' ? 'Reconnect shared world' : 'Enter shared world';
    el('account-world-leave').classList.toggle('hidden', worldState === 'preview');
    for (const input of dialog.querySelectorAll<HTMLInputElement>('input')) input.disabled = busy;
  }
  const showRetry = (visible: boolean) => el('account-retry').classList.toggle('hidden', !visible);
  async function request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    } catch { throw new Error('The server could not be reached. Check your connection and try again.'); }
    if (response.status === 401) throw new SessionExpired();
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429) throw new Error('Too many attempts. Please wait a moment and try again.');
      // Display only bounded server error text, never raw response objects.
      const message = data && typeof data === 'object' && 'message' in data ? data.message
        : data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'message' in data.error ? data.error.message : null;
      throw new Error(typeof message === 'string' && message.length < 256 ? message : 'The request could not be completed. Please try again.');
    }
    return data;
  }
  function disconnect(reason = 'World connection closed. Reconnect to continue.') {
    // Save owns its busy state until confirmation. Cancelling that timer must
    // also release its controls; perform() still owns other async operations.
    if (saveTimer !== undefined) busy = false;
    clearSaveTimers();
    clearRecovery();
    const previous = room; room = undefined;
    shared = null;
    if (worldState !== 'preview') setWorldState('disconnected');
    failWorldRequest(reason);
    if (previous) {
      previous.reconnection.enabled = false; previous.reconnection.enqueuedMessages = [];
      if (previous.connection.isOpen) void previous.leave().catch(() => {});
      previous.connection.close(1000);
    }
  }
  function clearAccount() {
    operation++; disconnect(); account = null; assets = null; snapshot = null; pendingSave = null; pendingCreate = null;
    el<HTMLDetailsElement>('account-assets-details').open = false;
    el<HTMLInputElement>('account-password').value = '';
    el<HTMLInputElement>('account-trainer-name').value = '';
    wantsWorld = false;
  }
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    busy = true; showRetry(false); render();
    try { await action(); }
    catch (error) {
      if (error instanceof SessionExpired) { clearAccount(); status('Please sign in to continue.', true); }
      else if (recovery) { status(recoveryNotice); }
      else { status(error instanceof Error ? error.message : 'Please try again.', true); showRetry(true); }
    } finally { busy = false; if (!destroyed) render(); }
  }
  async function refresh() {
    const current = operation;
    try {
      const value = accountViewSchema.parse(await request('/api/account'));
      if (current !== operation || destroyed) return;
      if (account && account.user.id !== value.user.id) { clearAccount(); }
      account = value;
      assets = null;
      const assetOperation = operation;
      await refreshAssets();
      if (assetOperation !== operation || destroyed || !account) return;
      status(recovery ? recoveryNotice : pendingSave ? 'Save confirmation is unknown. Retry save to check the same command safely.'
        : account.character ? 'Your trainer is saved.' : 'Signed in. Choose your trainer name.');
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error;
      clearAccount(); status('Sign in or create a local account.');
    }
  }
  async function refreshAssets() {
    const characterId = account?.character?.id;
    if (!characterId) { assets = null; return; }
    const current = operation;
    const value = trainerAssetsSchema.parse(await request(`/api/characters/${characterId}/assets`));
    if (current !== operation || destroyed || account?.character?.id !== characterId) return;
    if (value.characterId !== characterId) throw new Error('The saved party response did not match your trainer.');
    assets = value;
  }
  async function connect() {
    if (!account?.character) return;
    disconnect();
    const current = ++operation;
    const ticket = characterTicketSchema.parse(await request(`/api/characters/${account.character.id}/ticket`, {}));
    const joined = await new Client(`${location.origin}/socket`).joinOrCreate(CHARACTER_ROOM, { protocolVersion: PROTOCOL_VERSION, ticket: ticket.ticket });
    Object.assign(joined.reconnection, { enabled: true, minUptime: 0, maxRetries: 100, delay: 250, minDelay: 250, maxDelay: 2000, maxEnqueuedMessages: 0 });
    if (current !== operation || destroyed) {
      joined.reconnection.enabled = false;
      if (joined.connection.isOpen) void joined.leave().catch(() => {});
      joined.connection.close(1000); return;
    }
    room = joined;
    const nativeReconnect = joined.connection.reconnect.bind(joined.connection);
    let transportDropped = false;
    // SDK 0.18.4 does not cancel/recheck its scheduled reconnect timeout when
    // enabled changes. Guard the public transport method before it opens a socket.
    joined.connection.reconnect = options => {
      if (room !== joined || destroyed || !joined.reconnection.enabled || !recovery || Date.now() >= recovery.deadline) return;
      nativeReconnect(options);
    };
    const ready = new Promise<void>((resolve, reject) => {
      let initialized = false;
      const timeout = setTimeout(() => { if (room === joined) disconnect(); reject(new Error('Trainer connection timed out. Please reconnect.')); }, 8000);
      const failReady = (message: string) => { clearTimeout(timeout); reject(new Error(message)); };
      const sendRecoveryHello = () => {
        const active = recovery;
        if (!active || active.room !== joined) return;
        clearTimeout(active.helloTimer);
        active.helloTimer = setTimeout(() => {
          if (room === joined && recovery === active && active.transportReady && joined.connection.isOpen) joined.send('hello', { protocolVersion: PROTOCOL_VERSION });
        }, active.helloRetries ? 150 : 0);
      };
      joined.onDrop(() => {
        if (room === joined) transportDropped = true;
        if (room !== joined || destroyed || !joined.reconnection.enabled) return;
        const wasSaving = saveTimer !== undefined;
        clearSaveTimers(); if (wasSaving) busy = false;
        joined.reconnection.enqueuedMessages = [];
        failWorldRequest(recoveryNotice); failReady(recoveryNotice);
        if (!recovery) {
          const deadline = Date.now() + CHARACTER_RECONNECT_GRACE_MS;
          const timer = setTimeout(() => {
            if (room !== joined) return;
            const message = 'Automatic reconnect timed out. Open Account to reconnect your trainer.';
            disconnect(message); busy = false; status(message, true); render();
          }, CHARACTER_RECONNECT_GRACE_MS);
          recovery = { room: joined, deadline, previousGeneration: snapshot?.connectionGeneration ?? 0,
            transportReady: false, privateReady: false, helloRetries: 0, timer };
        } else {
          clearTimeout(recovery.helloTimer); clearTimeout(recovery.snapshotTimer);
          recovery.previousGeneration = snapshot?.connectionGeneration ?? recovery.previousGeneration;
          recovery.transportReady = false; recovery.privateReady = false; recovery.helloRetries = 0;
        }
        shared = null;
        if (wantsWorld || worldState !== 'preview') setWorldState('reconnecting');
        status(recoveryNotice); showRetry(false); render();
      });
      joined.onReconnect(() => {
        joined.reconnection.enqueuedMessages = [];
        if (room !== joined || !recovery || destroyed || !joined.reconnection.enabled || Date.now() >= recovery.deadline) {
          joined.reconnection.enabled = false; joined.connection.close(1000); return;
        }
        recovery.transportReady = true;
        // The SDK emits onReconnect before acknowledging JOIN_ROOM. Defer hello
        // until after that acknowledgement, then await both authoritative views.
        sendRecoveryHello();
        recovery.snapshotTimer = setTimeout(() => {
          if (room !== joined || !recovery) return;
          const message = 'Reconnected transport did not restore your trainer. Reconnect from Account.';
          disconnect(message); busy = false; status(message, true); render();
        }, Math.min(8000, Math.max(1, recovery.deadline - Date.now())));
      });
      joined.onMessage('snapshot', (value: unknown) => {
        if (room !== joined || (recovery && !recovery.transportReady)) return;
        const parsed = characterSnapshotSchema.safeParse(value);
        if (!parsed.success || parsed.data.character.id !== account?.character?.id
          || (recovery && (parsed.data.connectionGeneration <= recovery.previousGeneration || typeof parsed.data.worldActive !== 'boolean'))) {
          const message = 'Incompatible trainer snapshot. Reload to continue.';
          disconnect(message); failReady(message); status(message, true); render(); return;
        }
        snapshot = parsed.data; account.character = snapshot.character;
        clearTimeout(timeout);
        if (recovery) {
          recovery.privateReady = true; sequence = 0;
          // Resume only the activity the server actually owns. An interrupted
          // Enter/Leave command must never cause an automatic new world entry.
          wantsWorld = snapshot.worldActive === true;
          if (!wantsWorld) { if (worldState !== 'preview') setWorldState('preview'); finishRecovery(); }
        } else if (!initialized) { status('Trainer connected.'); }
        initialized = true;
        render(); resolve();
      });
      joined.onMessage('world', (value: unknown) => {
        if (room !== joined || !wantsWorld || (recovery && !recovery.privateReady)) return;
        const parsed = worldSnapshotSchema.safeParse(value);
        if (!parsed.success || parsed.data.self.id !== account?.character?.id || parsed.data.contentHash !== snapshot?.contentHash
          || parsed.data.connectionGeneration !== snapshot.connectionGeneration) {
          const message = 'World content or connection changed. Reload and reconnect.';
          disconnect(message); worldBridge.onError(message); status(message, true); render(); return;
        }
        shared = parsed.data; sequence = Math.max(sequence, shared.lastInputSequence); lastWorldAt = performance.now();
        setWorldState('shared');
        if (!worldBridge.onSnapshot(shared)) {
          const message = 'World content differs from this client. Reload before reconnecting.';
          disconnect(message); status(message, true); render(); return;
        }
        if (recovery) finishRecovery();
        if (worldRequest?.kind === 'enter') finishWorldRequest();
      });
      joined.onMessage('world-left', (value: unknown) => {
        if (room !== joined) return;
        const parsed = worldLeftSchema.safeParse(value);
        if (!parsed.success || parsed.data.character.id !== account?.character?.id || parsed.data.commandId !== worldRequest?.commandId) return;
        account.character = parsed.data.character;
        if (snapshot) snapshot.character = parsed.data.character;
        shared = null; wantsWorld = false; setWorldState('preview'); finishWorldRequest();
        status('Shared world left. Anonymous exploration is unsaved.'); render();
      });
      joined.onMessage('saved', (value: unknown) => {
        if (room !== joined || recovery) return;
        const parsed = profileSavedSchema.safeParse(value);
        if (!parsed.success || parsed.data.character.id !== account?.character?.id || parsed.data.commandId !== pendingSave?.commandId) return;
        if (parsed.data.character.revision >= account.character.revision) account.character = parsed.data.character;
        if (snapshot && parsed.data.character.revision >= snapshot.character.revision) snapshot.character = parsed.data.character;
        clearSaveTimers(); pendingSave = null; busy = false;
        status(worldState === 'shared' ? 'Trainer saved. Shared world location checkpointed.' : 'Trainer saved. Map exploration remains unsaved.'); render();
      });
      joined.onMessage('error', (value: unknown) => {
        if (room !== joined) return;
        const parsed = characterErrorSchema.safeParse(value);
        if (parsed.success && parsed.data.code === 'BUSY') {
          if (recovery?.transportReady && recovery.helloRetries < 5) {
            recovery.helloRetries++; sendRecoveryHello(); return;
          }
          if (pendingSave && saveTimer !== undefined && saveRetries < 5) {
            // A heartbeat or previous input may still own the room. Preserve the
            // command and original confirmation deadline for an idempotent retry.
            const command = pendingSave;
            saveRetries++;
            clearTimeout(saveRetryTimer);
            saveRetryTimer = setTimeout(() => {
              saveRetryTimer = undefined;
              if (room === joined && !recovery && joined.connection.isOpen && pendingSave === command && saveTimer !== undefined) joined.send('save', command);
            }, 150);
            return;
          }
          if (worldRequest && worldRequest.retries < 5) {
            const pending = worldRequest;
            pending.retries++;
            clearTimeout(pending.retryTimer);
            pending.retryTimer = setTimeout(() => {
              if (room === joined && !recovery && joined.connection.isOpen && worldRequest === pending) joined.send(pending.kind === 'enter' ? 'world-enter' : 'world-leave', pending.command);
            }, 150);
            return;
          }
          if (!worldRequest && !pendingSave && worldState === 'shared') { worldBridge.onInputBusy(); return; }
        }
        clearSaveTimers(); busy = false;
        if (!parsed.success) { disconnect(); failReady('Incompatible server response. Reload to continue.'); status('Incompatible server response.', true); render(); return; }
        const error = parsed.data;
        const leaving = worldRequest?.kind === 'leave';
        failWorldRequest(error.message);
        if (worldState === 'shared') worldBridge.onError(error.message);
        if (error.snapshot && error.snapshot.character.id === account?.character?.id) { snapshot = error.snapshot; account.character = snapshot.character; }
        if (['STALE_REVISION', 'COMMAND_CONFLICT', 'INVALID_MESSAGE'].includes(error.code)) pendingSave = null;
        if (leaving || recovery || ['SESSION_REPLACED', 'AUTH_REQUIRED', 'LEASE_EXPIRED', 'RECONNECT_REQUIRED', 'DATABASE_UNAVAILABLE', 'COMMAND_OUTCOME_UNKNOWN'].includes(error.code)) {
          disconnect(error.message);
          if (error.code === 'AUTH_REQUIRED') clearAccount();
        }
        failReady(error.message); status(error.message, true); render();
      });
      joined.onLeave(() => {
        if (room !== joined) return;
        joined.reconnection.enabled = false; joined.reconnection.enqueuedMessages = [];
        room = undefined; clearSaveTimers(); clearRecovery(); busy = false;
        shared = null; if (worldState !== 'preview') setWorldState('disconnected'); failWorldRequest('Trainer disconnected.');
        status('Trainer disconnected. Reconnect to continue.', true); failReady('Trainer disconnected.'); render();
      });
      joined.onError(code => {
        if (room !== joined) return;
        // Native socket errors are followed by onDrop. Allow its bounded retry;
        // actual protocol/admission errors are terminal and need fresh admission.
        if (!code || [1001, 1005, 1006, 4010].includes(code)) return;
        disconnect(); busy = false; status('Trainer connection rejected. Reconnect to continue.', true); failReady('Trainer connection rejected.'); render();
      });
      joined.send('hello', { protocolVersion: PROTOCOL_VERSION });
    });
    await ready;
    await refreshAssets();
    if (current !== operation || destroyed) return;
    if (room !== joined || transportDropped || recovery) throw new Error(recovery ? recoveryNotice : 'Trainer connection changed. Check your restored trainer before continuing.');
    sequence = 0;
    if (wantsWorld) await requestWorld('enter');
  }
  async function requestWorld(kind: 'enter' | 'leave') {
    if (!room?.connection.isOpen || !snapshot || recovery) throw new Error('Connect your trainer first.');
    if (worldRequest) throw new Error('A world request is already in progress.');
    const command: WorldCommand = { commandId: crypto.randomUUID(), activityId: snapshot.character.activityId, expectedRevision: snapshot.character.revision };
    wantsWorld = kind === 'enter';
    room.reconnection.enabled = kind === 'enter';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { failWorldRequest('World confirmation timed out. Reconnect to recover your saved location.'); disconnect(); render(); }, 8000);
      worldRequest = { commandId: command.commandId, command, kind, retries: 0, resolve, reject, timer };
      room!.send(kind === 'enter' ? 'world-enter' : 'world-leave', command);
    });
  }
  async function leaveWorld() {
    if (busy) return;
    if (recovery || !room || worldState === 'disconnected') {
      disconnect(); wantsWorld = false; shared = null; setWorldState('preview');
      status('Shared world left. Anonymous exploration is unsaved.'); render(); return;
    }
    await perform(async () => { await requestWorld('leave'); });
  }
  function mode(create: boolean) {
    signup = create;
    el('account-signin-mode').setAttribute('aria-pressed', String(!create));
    el('account-signup-mode').setAttribute('aria-pressed', String(create));
    el('account-auth-submit').textContent = create ? 'Create local account' : 'Sign in to account';
    el<HTMLInputElement>('account-password').autocomplete = create ? 'new-password' : 'current-password';
    el('account-password-note').textContent = create ? 'Use 12–128 characters. Email verification and password recovery are not connected yet.' : 'Use your account password.';
  }
  trigger.addEventListener('click', () => {
    onOpen(); dialog.showModal();
    if (recovery) { status(recoveryNotice); render(); } else void perform(refresh);
  });
  el('account-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', onClose);
  el('account-signin-mode').addEventListener('click', () => mode(false));
  el('account-signup-mode').addEventListener('click', () => mode(true));
  el('account-retry').addEventListener('click', () => { void perform(refresh); });
  el('account-auth-form').addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const email = el<HTMLInputElement>('account-email').value.trim();
      const password = el<HTMLInputElement>('account-password').value;
      try { await request(`/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, { email, password, ...(signup ? { name: 'Trainer' } : {}) }); }
      catch (error) { if (error instanceof SessionExpired) throw new Error('Email or password was not accepted.', { cause: error }); throw error; }
      el<HTMLInputElement>('account-password').value = ''; pendingSave = null;
      await refresh();
    });
  });
  el('account-trainer-form').addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const parsed = trainerNameSchema.safeParse(el<HTMLInputElement>('account-trainer-name').value);
      if (!parsed.success) throw new Error('Use 1–7 letters for your trainer name.');
      if (!pendingCreate || pendingCreate.name !== parsed.data) pendingCreate = { commandId: crypto.randomUUID(), name: parsed.data };
      const response = await request('/api/characters', pendingCreate);
      const character = characterViewSchema.parse(response && typeof response === 'object' && 'character' in response ? response.character : null);
      if (!account) return;
      account.character = character; pendingCreate = null; render();
      await connect();
    });
  });
  el('account-connect').addEventListener('click', () => { void perform(connect); });
  el('account-world-enter').addEventListener('click', () => {
    void perform(async () => {
      if (account?.character?.stage !== 'development-fixture' || !worldBridge.canEnter()) return;
      if (!room) { wantsWorld = true; await connect(); }
      else await requestWorld('enter');
      status('Shared world connected. Your location is controlled by the server.'); dialog.close();
    });
  });
  el('account-world-leave').addEventListener('click', () => { void leaveWorld(); });
  el('account-save').addEventListener('click', () => {
    if (busy || recovery || !room?.connection.isOpen || !snapshot) return;
    pendingSave ??= { commandId: crypto.randomUUID(), type: 'save-profile', version: 1,
      activityId: snapshot.character.activityId, expectedRevision: snapshot.character.revision, payload: {} };
    clearSaveTimers(); busy = true; render(); status('Saving trainer…');
    saveTimer = setTimeout(() => { clearSaveTimers(); busy = false; status('Save confirmation timed out. Retry to check the same save safely.', true); render(); }, 8000);
    room.send('save', pendingSave);
  });
  el('account-signout').addEventListener('click', () => {
    void perform(async () => {
      wantsWorld = false; disconnect();
      await request('/api/auth/sign-out', {}); clearAccount(); status('Signed out.');
    });
  });
  window.addEventListener('pagehide', () => { destroyed = true; operation++; disconnect(); }, { once: true });
  const watchdog = setInterval(() => {
    if (worldState === 'shared' && performance.now() - lastWorldAt > 5000) {
      // The SDK maps this close code to onDrop immediately, even on an offline
      // browser whose native socket close event would otherwise be delayed.
      room?.connection.close(4010, 'World snapshots stopped.');
    }
  }, 1000);
  window.addEventListener('pagehide', () => clearInterval(watchdog), { once: true });
  void perform(refresh);
  return {
    leaveWorld,
    sendWorldInput(direction: Direction, run: boolean): number | undefined {
      if (recovery || !room?.connection.isOpen || !shared || worldState !== 'shared' || snapshot?.character.activity !== 'overworld' || busy || worldRequest) return;
      const inputSequence = ++sequence;
      room.send('world-input', { sequence: inputSequence, connectionGeneration: shared.connectionGeneration, zoneGeneration: shared.zoneGeneration, direction, run });
      return inputSequence;
    },
  };
}

class SessionExpired extends Error {}
