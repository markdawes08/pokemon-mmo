import type { PracticeCatalogue, PracticeChoice, PracticeMon, PracticePresentation, PracticeSetup } from '@pokewaterblue/protocol';
import type { AccountPracticeState, attachAccounts } from './accounts';
import './practice.css';

type Bridge = ReturnType<typeof attachAccounts>['practice'];
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
};
const statusName = (value: number) => value === 8 ? 'Poisoned' : value === 16 ? 'Burned' : 'Healthy';
const titleCase = (text: string) => text.toLowerCase().replace(/\b[a-z]/g, value => value.toUpperCase());

/** Browser presentation consumes only the explicitly public practice protocol. */
export function attachPractice(bridge: Bridge, onOpen: () => void, onClose: () => void) {
  const dialog = element('dialog', '', 'practice-dialog'); dialog.id = 'practice-dialog';
  dialog.setAttribute('aria-labelledby', 'practice-title');
  dialog.innerHTML = `<header class="practice-header"><div><p class="eyebrow">Battle studio / Local development</p><h2 id="practice-title">Practice battle</h2></div><button class="button" id="practice-close" type="button">Close practice</button></header>
    <div class="practice-body"><div class="practice-intro"><p>Build a team, choose an opponent, and try the battle mechanics. Your practice session is saved after each action so you can return later.</p><span class="practice-badge">Practice · no rewards</span></div>
    <p id="practice-status" class="practice-notice" role="status" aria-live="polite"></p><div id="practice-connection" class="practice-connection-actions"></div>
    <section id="practice-setup" aria-label="Practice setup"><div id="practice-presets" class="practice-presets" aria-label="Quick setups"></div>
      <div class="practice-setup-grid"><section class="practice-section"><div class="practice-section-heading"><h3 id="practice-party-count">Your team</h3><button class="button" id="practice-add" type="button">Add Pokémon</button></div><p class="practice-caption">Choose up to six. Only supported, source-legal moves are offered.</p><div id="practice-team" class="practice-members"></div></section>
      <section class="practice-section"><h3>Wild opponent</h3><p class="practice-caption">The server controls its move choices.</p><div id="practice-opponent-setup" class="practice-members"></div></section></div>
      <div class="practice-setup-actions"><button class="button primary-button" id="practice-start" type="button">Start battle</button><span class="practice-caption">Your saved party, bag, money and story are unchanged.</span></div></section>
    <section id="practice-battle" class="hidden" aria-label="Practice battle"><div class="practice-battle-grid"><div>
      <div id="practice-stage" class="practice-stage"><span id="practice-weather" class="practice-weather"></span>
        <div id="practice-opponent-card" class="practice-health-card practice-enemy-card"></div><img id="practice-opponent-sprite" class="practice-sprite practice-enemy-sprite" alt="" />
        <img id="practice-self-sprite" class="practice-sprite practice-self-sprite" alt="" /><div id="practice-self-card" class="practice-health-card practice-self-card"></div></div>
      <div class="practice-turn"><strong id="practice-turn"></strong><span id="practice-prompt"></span></div><div id="practice-choices" class="practice-choices"></div><div id="practice-actions" class="practice-battle-actions"></div>
      <div id="practice-result" class="practice-result hidden"></div>
    </div><aside class="practice-section"><h3>Your party</h3><p class="practice-caption">Select an available member to switch.</p><ul id="practice-party" class="practice-party" aria-label="Practice party"></ul></aside></div>
      <section class="practice-log" aria-label="Battle events"><h3>Battle log</h3><ol id="practice-events" aria-live="polite" aria-relevant="additions"></ol></section></section></div>`;
  document.querySelector('main')!.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  let connection: AccountPracticeState | undefined, catalogue: PracticeCatalogue | undefined, setup: PracticeSetup | undefined;
  let localError = '', setupStamp = '', eventsStamp = '', previousRevision = -1;
  let connectOnOpen = false;
  let automaticBattleId: string | undefined;
  const wildBattle = () => connection?.snapshot?.state.session?.origin === 'route1-wild-test' || connection?.snapshot?.state.unavailable?.origin === 'route1-wild-test';
  const species = (id: number) => catalogue?.species.find(row => row.id === id);
  const name = (id: number) => titleCase(species(id)?.name ?? `Pokémon ${id}`);
  const moveName = (id: number) => titleCase(catalogue?.moves.find(row => row.id === id)?.name ?? `Move ${id}`);
  const ready = () => !!connection?.connected && connection.fresh && !connection.reconnecting && !connection.busy && !connection.waiting && !connection.retry && (connection.worldState === 'preview' || (wildBattle() && connection.worldState === 'battle'));
  const invoke = (action: () => void | Promise<void>) => {
    localError = '';
    try { void Promise.resolve(action()).catch(error => { localError = error instanceof Error ? error.message : 'Please try again.'; render(); }); }
    catch (error) { localError = error instanceof Error ? error.message : 'Please try again.'; }
    render();
  };
  const button = (text: string, action: () => void | Promise<void>, primary = false) => {
    const result = element('button', text, `button${primary ? ' primary-button' : ''}`); result.type = 'button';
    result.addEventListener('click', () => invoke(action)); return result;
  };
  const cancelOpenConnection = () => { connectOnOpen = false; };
  const openAccount = () => { cancelOpenConnection(); dialog.close(); bridge.openAccount(); };
  const connectForOpenDialog = () => {
    if (!connectOnOpen || !dialog.open || !connection || connection.busy || connection.reconnecting || connection.waiting) return;
    // Consume the user's open intent before connecting: account notifications
    // may re-enter this subscriber, and a failed attempt must remain manual.
    connectOnOpen = false;
    if (!connection.eligible || !['preview', 'battle'].includes(connection.worldState) || (connection.connected && connection.fresh)) return;
    invoke(() => bridge.connect());
  };
  const normalise = (mon: PracticeMon) => {
    const row = species(mon.speciesId)!;
    mon.level = Math.min(100, Math.max(1, Math.trunc(mon.level) || 1));
    const legal = row.moves.filter(move => move.level <= mon.level).map(move => move.id);
    mon.moveIds = [...new Set(mon.moveIds)].filter(id => legal.includes(id)).slice(0, 4);
    if (!mon.moveIds.length && legal[0]) mon.moveIds = [legal[0]];
    if (!row.abilities.some(ability => ability.slot === mon.abilityNum)) mon.abilityNum = row.abilities[0]!.slot;
  };
  function member(mon: PracticeMon, index: number | null) {
    const row = species(mon.speciesId)!, card = element('div', '', 'practice-member');
    const image = element('img'); image.src = row.frontSprite; image.alt = ''; card.append(image);
    const fields = element('div', '', 'practice-member-fields'), head = element('div', '', 'practice-member-head'); card.append(fields); fields.append(head);
    const prefix = index === null ? 'Opponent' : `Party ${index + 1}`;
    const label = (text: string, input: HTMLElement, parent: HTMLElement = fields) => { const node = element('label', text); node.append(input); parent.append(node); };
    const select = element('select'); select.setAttribute('aria-label', `${prefix} species`);
    for (const entry of catalogue!.species) { const option = element('option', titleCase(entry.name)); option.value = String(entry.id); select.append(option); }
    select.value = String(mon.speciesId); select.addEventListener('change', () => { mon.speciesId = Number(select.value); normalise(mon); render(); }); label('Pokémon', select, head);
    const level = element('input'); level.type = 'number'; level.min = '1'; level.max = '100'; level.value = String(mon.level); level.setAttribute('aria-label', `${prefix} level`);
    level.addEventListener('change', () => { mon.level = Number(level.value); normalise(mon); render(); }); label('Level', level, head);
    if (index !== null) { const remove = button('×', () => { setup!.player.splice(index, 1); render(); }); remove.classList.add('practice-remove'); remove.setAttribute('aria-label', `Remove party ${index + 1}`); remove.disabled = setup!.player.length === 1; head.append(remove); }
    const moveFields = element('div', '', 'practice-move-selects'); fields.append(moveFields);
    const legal = row.moves.filter(move => move.level <= mon.level);
    for (let slot = 0; slot < 4; slot++) {
      const moveSelect = element('select'); moveSelect.setAttribute('aria-label', `${prefix} move ${slot + 1}`);
      const empty = element('option', '— Empty —'); empty.value = '0'; moveSelect.append(empty);
      for (const move of legal) { const option = element('option', moveName(move.id)); option.value = String(move.id); moveSelect.append(option); }
      moveSelect.value = String(mon.moveIds[slot] ?? 0);
      moveSelect.addEventListener('change', () => {
        const ids = Array.from({ length: 4 }, (_, i) => i === slot ? Number(moveSelect.value) : mon.moveIds[i] ?? 0);
        mon.moveIds = [...new Set(ids.filter(Boolean))]; normalise(mon); render();
      }); label(`Move ${slot + 1}`, moveSelect, moveFields);
    }
    const advanced = element('details'); advanced.append(element('summary', 'Ability & starting condition')); fields.append(advanced);
    const options = element('div', '', 'practice-move-selects'); advanced.append(options);
    const ability = element('select'); ability.setAttribute('aria-label', `${prefix} ability`);
    for (const entry of row.abilities) { const option = element('option', titleCase(entry.name)); option.value = String(entry.slot); ability.append(option); }
    ability.value = String(mon.abilityNum); ability.addEventListener('change', () => { mon.abilityNum = Number(ability.value) as 0 | 1; }); label('Ability', ability, options);
    const condition = element('select'); condition.setAttribute('aria-label', `${prefix} status`);
    for (const value of [0, 8, 16]) { const option = element('option', statusName(value)); option.value = String(value); condition.append(option); }
    condition.value = String(mon.status); condition.addEventListener('change', () => { mon.status = Number(condition.value) as 0 | 8 | 16; }); label('Status', condition, options);
    for (const [key, title, min] of [['hpPercent', 'Starting HP %', 1], ['ppPercent', 'Starting PP %', 0]] as const) {
      const input = element('input'); input.type = 'number'; input.min = String(min); input.max = '100'; input.value = String(mon[key]); input.setAttribute('aria-label', `${prefix} ${title}`);
      input.addEventListener('change', () => { mon[key] = Math.max(min, Math.min(100, Math.trunc(Number(input.value)) || min)); input.value = String(mon[key]); }); label(title, input, options);
    }
    return card;
  }
  function renderSetup() {
    if (!catalogue || !setup) return;
    const stamp = JSON.stringify(setup);
    if (stamp !== setupStamp) {
      setupStamp = stamp; el('practice-team').replaceChildren(...setup.player.map((mon, i) => member(mon, i)));
      el('practice-opponent-setup').replaceChildren(member(setup.opponent, null));
      el('practice-presets').replaceChildren(...catalogue.presets.map(preset => {
        const control = button(preset.name, () => { setup = structuredClone(preset.setup); localError = ''; render(); }); control.title = preset.description; return control;
      }));
    }
    el('practice-party-count').textContent = `Your team · ${setup.player.length}/6`;
    for (const control of el('practice-setup').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) control.disabled = !ready();
    el<HTMLButtonElement>('practice-add').disabled = !ready() || setup.player.length === 6;
    if (setup.player.length === 1) el<HTMLButtonElement>('practice-team').querySelector<HTMLButtonElement>('.practice-remove')!.disabled = true;
  }
  function health(target: HTMLElement, speciesId: number, level: number, percent: number, hp: string, effects: string[]) {
    const heading = element('div', '', 'practice-health-heading'); heading.append(element('strong', name(speciesId)), element('small', `Lv. ${level}`));
    const track = element('div', '', 'practice-hp-track'), fill = element('div', '', 'practice-hp-fill');
    fill.style.width = `${percent}%`; fill.dataset.low = String(percent <= 50); fill.dataset.critical = String(percent <= 20); track.append(fill);
    target.replaceChildren(heading, track, element('div', hp, 'practice-hp-text'), element('div', effects.join(' · '), 'practice-effects'));
    target.dataset.hp = hp; target.setAttribute('aria-label', `${name(speciesId)} level ${level}, ${hp}${effects.length ? `, ${effects.join(', ')}` : ''}`);
  }
  function renderBattle(view: PracticePresentation) {
    const own = view.self, wild = view.opponent;
    el<HTMLImageElement>('practice-self-sprite').src = species(own.speciesId)!.backSprite;
    el<HTMLImageElement>('practice-opponent-sprite').src = species(wild.speciesId)!.frontSprite;
    const effects = (mon: { status: number; charging: boolean; protected: boolean }, focus = false) => [mon.status ? statusName(mon.status) : '', mon.charging ? 'Charging' : '', mon.protected ? 'Protected' : '', focus ? 'Focused' : ''].filter(Boolean);
    health(el('practice-self-card'), own.speciesId, own.level, Math.ceil(100 * own.hp / own.maxHP), `HP ${own.hp}/${own.maxHP}`, effects(own, own.focusEnergy));
    health(el('practice-opponent-card'), wild.speciesId, wild.level, wild.hpPercent, `HP ${wild.hpPercent}%`, effects(wild));
    el('practice-stage').dataset.weather = view.weather.kind;
    el('practice-weather').textContent = view.weather.kind === 'rain' ? `Rain · ${view.weather.turnsRemaining} turns` : wildBattle() ? 'Route 1 grass' : 'Practice field';
    el('practice-turn').textContent = `Turn ${view.turn}`;
    el('practice-prompt').textContent = view.phase === 'post-faint' ? 'Use your next Pokémon?' : view.phase === 'replacement' ? 'Choose a replacement' : view.phase === 'ended' ? 'Battle complete' : own.charging ? 'Release Skull Bash' : 'Choose an action';
    const choices = view.availableChoices;
    const choose = (choice: PracticeChoice) => bridge.submit({ kind: 'choose', battleId: connection!.snapshot!.state.session!.battleId, choice });
    const moveButtons = own.moves.map(move => {
      const choice = choices.find(choice => choice.kind === 'move' && choice.slot === move.slot);
      const control = element('button', '', 'practice-move'); control.type = 'button'; control.dataset.moveId = String(move.moveId);
      const text = element('div'); text.append(element('strong', moveName(move.moveId)), element('span', titleCase(catalogue!.moves.find(row => row.id === move.moveId)!.type)));
      control.append(text, element('span', `${move.pp}/${move.maxPP} PP`)); control.disabled = !ready() || !choice;
      control.setAttribute('aria-label', `${moveName(move.moveId)}, ${move.pp} of ${move.maxPP} PP`); control.addEventListener('click', () => invoke(() => choose(choice!))); return control;
    });
    el('practice-choices').replaceChildren(...moveButtons);
    const actionLabels = { 'continue-charge': 'Release Skull Bash', struggle: 'Fight · Struggle', run: 'Run', 'use-next': 'Use next Pokémon', 'attempt-run': 'Try to escape' };
    el('practice-actions').replaceChildren(...choices.filter(choice => choice.kind in actionLabels).map(choice => {
      const control = button(actionLabels[choice.kind as keyof typeof actionLabels], () => choose(choice), choice.kind !== 'run'); control.disabled = !ready(); return control;
    }));
    const finish = button(wildBattle() ? view.phase === 'ended' ? 'Return to Route 1' : 'End encounter test' : view.phase === 'ended' ? 'Finish practice' : 'End practice', () => bridge.submit({ kind: 'close', battleId: connection!.snapshot!.state.session!.battleId })); finish.disabled = !ready(); el('practice-actions').append(finish);
    el('practice-party').replaceChildren(...view.party.map(mon => {
      const item = element('li'), control = element('button'); control.type = 'button'; control.dataset.partyIndex = String(mon.partyIndex); control.dataset.active = String(mon.partyIndex === view.activeIndex);
      const image = element('img'); image.src = species(mon.speciesId)!.frontSprite; image.alt = '';
      const text = element('div'); text.append(element('strong', `${name(mon.speciesId)} · Lv. ${mon.level}`), element('small', `HP ${mon.hp}/${mon.maxHP} · ${statusName(mon.status)}`));
      const choice = choices.find(choice => (choice.kind === 'switch' || choice.kind === 'replace') && choice.partyIndex === mon.partyIndex);
      control.append(image, text, element('span', mon.hp === 0 ? 'Fainted' : mon.partyIndex === view.activeIndex ? 'Active' : 'Switch', 'practice-party-state'));
      control.disabled = !ready() || !choice; control.setAttribute('aria-label', `${choice?.kind === 'replace' ? 'Send out' : 'Switch to'} ${name(mon.speciesId)}, party ${mon.partyIndex + 1}`);
      control.addEventListener('click', () => invoke(() => choose(choice!))); item.append(control); return item;
    }));
    const outcomes = { won: 'You won!', lost: 'Your team fainted', draw: 'Both sides fainted', ran: 'You got away', 'forced-escape': 'The battle ended with Whirlwind' };
    el('practice-result').classList.toggle('hidden', !view.outcome);
    if (view.outcome) el('practice-result').replaceChildren(element('h3', outcomes[view.outcome]), element('p', wildBattle()
      ? 'Wild encounter test complete. Your saved team and items are unchanged. Return to the grass to continue exploring.'
      : 'Practice complete. Your saved team and items are unchanged. Finish practice to build another team.'));
    const events = connection!.snapshot!.state.session!.events, stamp = JSON.stringify(events);
    if (stamp !== eventsStamp) {
      eventsStamp = stamp; el('practice-events').replaceChildren(...events.map(event => { const item = element('li', event.text); item.dataset.sequence = String(event.sequence); return item; }));
      el('practice-events').scrollTop = el('practice-events').scrollHeight;
    }
  }
  function render() {
    if (!connection) return;
    const state = connection.snapshot?.state;
    const wild = wildBattle();
    dialog.dataset.origin = wild ? 'route1-wild-test' : 'practice';
    el('practice-title').textContent = wild ? 'Wild encounter' : 'Practice battle';
    el('practice-close').textContent = wild ? 'Hide battle' : 'Close practice';
    dialog.querySelector('.practice-intro p')!.textContent = wild
      ? 'A wild Pokémon appeared in Route 1 grass. Battle with a temporary level 5 Squirtle, then return to your saved location. Your normal party and items stay unchanged.'
      : 'Build a team, choose an opponent, and try the battle mechanics. Your practice session is saved after each action so you can return later.';
    dialog.querySelector('.practice-badge')!.textContent = wild ? 'Wild test · no captures or rewards' : 'Practice · no rewards';
    if (connection.snapshot) catalogue = connection.snapshot.catalogue;
    if (!setup && catalogue) setup = structuredClone(state?.session?.setup ?? catalogue.presets[0]!.setup);
    if (state && state.revision !== previousRevision) { previousRevision = state.revision; localError = ''; }
    dialog.dataset.revision = String(state?.revision ?? 0); dialog.dataset.phase = state?.session?.presentation.phase ?? 'setup';
    dialog.dataset.connectionState = connection.reconnecting ? 'reconnecting' : connection.connected && connection.fresh ? 'connected' : 'disconnected';
    let message = 'Choose a quick setup or customize your team. Every action is saved to this practice session.';
    if (state?.session) {
      const view = state.session.presentation;
      message = view.phase === 'ended' ? 'Battle complete. Finish practice to choose another setup.'
        : view.phase === 'post-faint' ? 'Choose whether to send out your next Pokémon or try to escape.'
          : view.phase === 'replacement' ? 'Choose an available party member to continue.'
            : view.self.charging ? 'Skull Bash is charged. Release it to continue the next turn.'
              : view.party.length > 1 ? 'Choose a move, switch your Pokémon, or run. Every action is saved.' : 'Choose a move or run. Every action is saved.';
    }
    if (!connection.signedIn) message = connection.testingAccounts.length
      ? 'Choose a ready-made trainer below. No email or password needed.'
      : 'Sign in through Account to practice with a local development trainer.';
    else if (!connection.eligible) message = 'Practice needs a local development trainer. Your normal saved assets will not be changed.';
    else if (connection.worldState !== 'preview' && !wild) message = 'Leave the shared world before practicing. Your world location will be checkpointed first.';
    else if (connection.reconnecting) message = 'Reconnecting your trainer… Battle controls will return after the saved state is restored.';
    else if (!connection.connected || !connection.fresh) message = 'Connect your trainer to load your saved practice session.';
    if (connection.message) message = connection.message;
    el('practice-status').textContent = localError || message; el('practice-status').dataset.error = String(!!localError || connection.error);
    const actions: HTMLButtonElement[] = [];
    if (!connection.signedIn || !connection.eligible) {
      for (const account of connection.testingAccounts) actions.push(button(`Play as ${account.name}`, () => bridge.playAsTestAccount(account.id), true));
      actions.push(button('Open Account', openAccount, !connection.testingAccounts.length));
    }
    else if (connection.worldState === 'shared') actions.push(button('Leave shared world & practice', () => bridge.leaveShared(), true));
    else if (connection.worldState !== 'preview' && !wild) actions.push(button('Open Account', openAccount, true));
    else if ((!connection.connected || !connection.fresh) && !connection.reconnecting) actions.push(button('Connect practice', () => bridge.connect(), true));
    if (connection.retry) { const retry = button('Retry last action', () => bridge.retry(), true); retry.disabled = !connection.connected || !connection.fresh || connection.reconnecting; actions.push(retry); }
    if (connection.reconnecting) actions.push(button('Open Account', openAccount));
    for (const control of actions) control.disabled ||= connection.busy || connection.waiting;
    el('practice-connection').replaceChildren(...actions);
    el('practice-setup').classList.toggle('hidden', wild || !catalogue || !!state?.session || !!state?.unavailable);
    el('practice-battle').classList.toggle('hidden', !state?.session);
    if (state?.unavailable) {
      el('practice-status').textContent = state.unavailable.message;
      if (!wild) { const close = button('Close unavailable practice', () => bridge.submit({ kind: 'close', battleId: state.unavailable!.battleId }), true); close.disabled = !ready(); el('practice-connection').append(close); }
    }
    if (state?.session) renderBattle(state.session.presentation); else renderSetup();
  }
  el('practice-close').addEventListener('click', () => { cancelOpenConnection(); dialog.close(); });
  dialog.addEventListener('close', () => { cancelOpenConnection(); onClose(); });
  document.querySelector('#account-button')!.addEventListener('click', cancelOpenConnection);
  document.querySelector('#account-signout')!.addEventListener('click', cancelOpenConnection);
  el('practice-add').addEventListener('click', () => { if (setup && ready() && setup.player.length < 6) { setup.player.push(structuredClone(setup.player[0]!)); render(); } });
  el('practice-start').addEventListener('click', () => { if (setup) invoke(() => bridge.submit({ kind: 'start', setup: structuredClone(setup!) })); });
  const unsubscribe = bridge.subscribe(state => {
    connection = state;
    const wild = wildBattle(), id = state.snapshot?.state.session?.battleId ?? state.snapshot?.state.unavailable?.battleId;
    if (wild && state.fresh && id && automaticBattleId !== id) {
      automaticBattleId = id; cancelOpenConnection();
      if (!dialog.open) { onOpen(); dialog.showModal(); el('practice-close').focus(); }
    } else if (!wild && automaticBattleId && state.fresh && !state.retry && !state.waiting) {
      automaticBattleId = undefined; if (dialog.open) dialog.close();
    }
    render(); connectForOpenDialog();
  });
  document.querySelector('#practice-button')!.addEventListener('click', () => {
    connectOnOpen = true;
    onOpen(); dialog.showModal(); el('practice-close').focus();
    connectForOpenDialog();
  });
  window.addEventListener('pagehide', unsubscribe, { once: true });
}
