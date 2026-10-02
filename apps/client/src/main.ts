import Phaser from 'phaser';
import { connectPreview } from './network';
import { WorldScene } from './world';
import { loadWorld } from './content';
import { loadDialogueFont, layoutDialogue } from './dialogue-font';
import { PreviewAudio } from './audio';
import { attachFieldGuide, loadFieldGuide } from './field-guide';
import { attachAccounts } from './accounts';
import { attachPractice } from './practice';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="topbar"><div class="wordmark">Poké<span>WaterBlue</span></div><div class="topbar-actions"><span class="build-label">Local development · 027</span><button class="button" id="practice-button" type="button">Practice battle</button><button class="button" id="account-button" type="button">Account</button></div></header>
    <div class="location"><div><p class="eyebrow" id="region-label">Kanto / Pallet Town</p><h1 id="location-name">Pallet Town</h1></div><p class="location-note" id="location-note">Home, town, and the road north.</p></div>
    <section class="console" aria-label="Game preview">
      <div class="screen-surround"><div class="game-screen" id="game" tabindex="0" aria-label="Pallet Town map. Arrows or W A S D move. Shift runs. E interacts."><div class="error-panel" id="loading">Loading Pallet Town…</div>
        <section id="dialogue" class="dialogue hidden" role="dialog" aria-labelledby="dialogue-speaker" aria-describedby="dialogue-text">
          <div class="dialogue-heading"><strong id="dialogue-speaker"></strong><span id="dialogue-page"></span></div>
          <p id="dialogue-text" aria-live="polite"></p>
          <canvas id="dialogue-bitmap" width="216" height="30" aria-hidden="true"></canvas>
          <div class="dialogue-actions"><span>E / Enter to continue · Esc to close</span><button id="dialogue-next" type="button">Continue</button></div>
        </section>
      </div></div>
      <div class="console-bottom"><span class="console-mark">WATERBLUE</span><span class="power"><span class="power-dot" id="power"></span>LOCAL</span></div>
    </section>
    <div class="toolbar"><div class="controls"><span class="key">↑</span> <span class="key">←</span> <span class="key">↓</span> <span class="key">→</span> / <span class="key">WASD</span> Walk &nbsp; <span class="key">Shift</span> Run &nbsp; <span class="key">E</span> Interact <span id="focus-hint">· Click map to focus</span></div>
      <div class="actions"><button class="button" id="guide" disabled>Field guide</button><button class="button" id="sound" aria-pressed="false" disabled>Sound off</button><label class="volume-control" for="volume">Volume <input id="volume" type="range" min="0" max="100" value="35" /></label><button class="button" id="overlay" aria-pressed="false">Collision overlay</button><button class="button" id="reset">Reset position</button></div>
    </div>
    <div class="status-row"><span class="status"><span class="dot" id="server-dot"></span><span id="server-status" role="status">Connecting to server…</span></span><span class="status"><span class="dot" id="db-dot"></span><span id="db-status">Checking database…</span></span><span id="display-info">240 × 160</span></div>
    <div class="world-status"><strong id="world-mode" role="status">Anonymous preview</strong><span id="world-nearby">Nearby trainers: 0</span><button class="button hidden" id="leave-world" type="button">Leave shared world</button></div>
    <ul id="nearby-players" class="nearby-players" aria-label="Nearby trainers"></ul>
    <p class="footnote" id="world-note">Walk with arrows or WASD, hold Shift to run outdoors, and press E to speak or read signs. Anonymous exploration is unsaved. Local development trainers can enter the shared world through Account. Try supported battle mechanics with Practice battle. Wild encounters and story progression are still ahead.</p>
    <div class="debug-readout" id="message" aria-live="polite"></div>
    <dialog id="field-guide" class="field-guide" aria-labelledby="guide-title" aria-describedby="guide-intro">
      <header class="guide-header"><div><p class="eyebrow">Kanto / Reference</p><h2 id="guide-title">Field guide</h2></div><button class="button" id="guide-close" type="button">Close field guide</button></header>
      <div class="guide-body"><p id="guide-intro" class="guide-note">Browse the starter families and Route 1 Pokémon. This is a reference guide. Practice battle lets you test supported mechanics; wild encounters, capture and saved-party management are still ahead.</p>
        <div class="guide-controls"><label for="guide-species">Species <select id="guide-species"></select></label><label for="guide-level">Level <input id="guide-level" type="number" min="1" max="100" step="1" value="5" /></label></div>
        <div class="guide-grid"><section class="guide-card"><h3 id="guide-name"></h3><p id="guide-types" class="guide-types"></p><h4>Base stats</h4><div id="guide-stats" class="table-scroll"></div><p id="guide-abilities"></p><p id="guide-catch" class="guide-note"></p><p id="guide-growth" class="guide-note"></p><h4>Evolution</h4><p id="guide-evolutions"></p></section><section class="guide-card" id="guide-encounters" aria-label="Encounter reference"></section></div>
        <section class="guide-card"><h3>Level-up moves</h3><div id="guide-learnset" class="table-scroll"></div></section>
        <section class="guide-card"><h3>Items</h3><div id="guide-items" class="table-scroll"></div></section>
        <section class="guide-card"><h3>Move reference</h3><p class="guide-note">Source values: power 0 indicates no listed base power; accuracy 0 uses special accuracy rules.</p><div id="guide-moves" class="table-scroll"></div></section>
      </div>
    </dialog>
  </main>`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screen = element('game');
let setAccountMenu = (_open: boolean) => {};
let worldScene: WorldScene | undefined;
const closeMenu = () => { const open = !!document.querySelector('dialog[open]'); setAccountMenu(open); if (!open) screen.focus(); };
const accounts = attachAccounts(() => setAccountMenu(true), closeMenu, {
  canEnter: () => screen.dataset.ready === 'true' && !!worldScene,
  onState: state => {
    worldScene?.setWorldState(state);
    screen.dataset.worldMode = state; screen.dataset.worldReady = String(state === 'shared');
    element('world-mode').textContent = state === 'preview' ? 'Anonymous preview' : state === 'shared' ? 'Shared world'
      : state === 'reconnecting' ? 'Shared world reconnecting' : 'Shared world disconnected';
    element<HTMLButtonElement>('reset').disabled = state !== 'preview';
    element('leave-world').classList.toggle('hidden', state === 'preview');
    element('world-note').textContent = state === 'preview'
      ? 'Anonymous exploration is unsaved. Walk with arrows or WASD, hold Shift to run outdoors, and press E to interact. Local development trainers can enter the shared world through Account.'
      : state === 'shared' ? 'Shared development world. Other trainers are visible and do not block your path. Save trainer checkpoints your location. Leave shared exploration to try Practice battle. Story interactions and wild encounters are still ahead.'
        : state === 'reconnecting' ? 'Movement is paused while the connection recovers, for up to 60 seconds. Leave shared world to stop reconnecting and return to anonymous exploration.'
          : 'Movement is paused. Open Account to reconnect your trainer, or leave the shared world to return to anonymous exploration.';
    if (state !== 'shared') { element('nearby-players').replaceChildren(); element('world-nearby').textContent = 'Nearby trainers: 0'; }
  },
  onSnapshot: snapshot => {
    if (!worldScene?.receiveWorld(snapshot)) return false;
    const nearby = snapshot.nearby.filter(avatar => avatar.mapId === snapshot.self.mapId);
    element('world-nearby').textContent = `Nearby trainers: ${nearby.length}`;
    element('nearby-players').replaceChildren(...nearby.map(avatar => {
      const item = document.createElement('li'); item.textContent = avatar.name;
      Object.assign(item.dataset, { avatarId: avatar.id, mapId: avatar.mapId, tileX: String(avatar.x), tileY: String(avatar.y), elevation: String(avatar.elevation) });
      return item;
    }));
    return true;
  },
  onError: message => worldScene?.sharedWorldError(message),
  onInputBusy: () => worldScene?.sharedWorldBusy(),
});
attachPractice(accounts.practice, () => setAccountMenu(true), closeMenu);
element('leave-world').addEventListener('click', () => { void accounts.leaveWorld().then(() => screen.focus()); });
let lastMessage = '';
const report = (message: string) => {
  if (message !== lastMessage) { element('message').textContent = message; lastMessage = message; }
};
function setStatus(id: 'server' | 'db', text: string, ok: boolean) {
  element(`${id}-status`).textContent = text;
  element(`${id}-dot`).className = `dot ${ok ? 'ok' : 'error'}`;
  if (id === 'server') element('power').className = `power-dot ${ok ? '' : 'offline'}`;
}
void connectPreview((text, ok) => setStatus('server', text, ok)).then(close => window.addEventListener('pagehide', close, { once: true })).catch(() => setStatus('server', 'Server unavailable', false));
void fetch('/api/ready').then(async response => {
  if (!response.ok) throw new Error('Database unavailable');
  setStatus('db', 'Database ready', true);
}).catch(() => setStatus('db', 'Database unavailable', false));

try {
  const world = await loadWorld();
  const fieldGuide = await loadFieldGuide(world.manifest.fieldGuide);
  const dialogueFont = await loadDialogueFont(world.manifest.dialogueFont);
  for (const map of Object.values(world.maps)) for (const event of [...map.events.objects, ...map.events.signs]) {
    const interaction = event.interaction;
    const pages = interaction.kind === 'unavailable' ? [interaction.reason] : interaction.pages;
    for (const text of pages) layoutDialogue(text, dialogueFont.font);
  }
  const soundButton = element<HTMLButtonElement>('sound');
  const sound = new PreviewAudio(world.manifest.audio.url, state => {
    soundButton.setAttribute('aria-pressed', String(state.enabled));
    soundButton.textContent = state.error ? 'Retry sound' : state.enabled ? 'Sound on' : 'Sound off';
    soundButton.title = state.error ?? (state.paused ? 'Sound paused while the preview is inactive.' : 'Pallet Town music and dialogue sound.');
    if (state.error) report(state.error);
  });
  sound.setVolume(Number(element<HTMLInputElement>('volume').value) / 100);
  soundButton.disabled = false;
  soundButton.addEventListener('click', () => { void sound.setEnabled(soundButton.getAttribute('aria-pressed') !== 'true'); });
  element<HTMLInputElement>('volume').addEventListener('input', event => sound.setVolume(Number((event.target as HTMLInputElement).value) / 100));
  window.addEventListener('pagehide', () => sound.destroy(), { once: true });
  element('loading').remove();
  const scene = new WorldScene(world, screen, report, map => {
    sound.setMusic(map.music === world.manifest.audio.music ? map.music : null);
    element('location-name').textContent = map.displayName;
    element('region-label').textContent = map.name === 'Route1' ? 'Kanto / Route 1' : 'Kanto / Pallet Town';
    element('location-note').textContent = map.name === 'Route1' ? 'The road north.' : map.name === 'PalletTown' ? 'Home, town, and the road north.' : 'Home / Ground floor';
    document.title = `PokéWaterBlue · ${map.displayName}`;
    screen.setAttribute('aria-label', `${map.displayName} map. Arrows or W A S D move. Shift runs. E interacts.`);
  }, message => {
    screen.dataset.ready = 'false';
    const panel = document.createElement('div'); panel.className = 'error-panel asset-error'; panel.setAttribute('role', 'alert');
    panel.textContent = message; screen.append(panel); report('Scenery could not be loaded.');
  }, page => {
    const panel = element('dialogue');
    if (!page) {
      const hadFocus = panel.contains(document.activeElement);
      panel.classList.add('hidden');
      if (hadFocus) screen.focus();
      return;
    }
    element('dialogue-speaker').textContent = page.speaker;
    element('dialogue-text').textContent = page.text;
    dialogueFont.draw(element<HTMLCanvasElement>('dialogue-bitmap'), page.text);
    sound.playSelect();
    element('dialogue-page').textContent = page.total > 1 ? `${page.page} / ${page.total}` : '';
    element('dialogue-next').textContent = page.page === page.total ? 'Close' : 'Continue';
    panel.classList.remove('hidden');
  });
  worldScene = scene;
  scene.bindWorldInput(accounts.sendWorldInput);
  screen.dataset.worldMode = 'preview'; screen.dataset.worldReady = 'false'; screen.dataset.nearbyCount = '0';
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: screen, width: 240, height: 160,
    backgroundColor: '#395f49', pixelArt: true, roundPixels: true, antialias: false,
    scale: { mode: Phaser.Scale.NONE, width: 240, height: 160 },
    audio: { noAudio: true }, scene: [scene],
    input: { keyboard: { target: screen } },
    render: { transparent: false, powerPreference: 'low-power' },
  });
  attachFieldGuide(fieldGuide, () => { scene.setMenuOpen(true); sound.playSelect(); }, closeMenu);
  setAccountMenu = open => scene.setMenuOpen(open);
  if (document.querySelector('dialog[open]')) scene.setMenuOpen(true);
  const resize = () => {
    const available = screen.parentElement!.clientWidth - 32;
    const scale = Math.max(1, Math.min(4, Math.floor(available / 240), Math.floor((window.innerHeight - 340) / 160)));
    game.scale.setZoom(scale);
    screen.style.width = `${240 * scale}px`; screen.style.height = `${160 * scale}px`;
    screen.style.setProperty('--pixel-scale', String(scale));
    element('display-info').textContent = `240 × 160 · ${scale}×`;
  };
  game.events.once(Phaser.Core.Events.READY, resize);
  window.addEventListener('resize', resize);
  element('overlay').addEventListener('click', () => {
    const enabled = scene.toggleDebug(); element('overlay').setAttribute('aria-pressed', String(enabled));
    report(enabled ? 'Red: blocked · Orange: ledges · Blue: water · Yellow: map exits · Purple: story triggers' : 'Collision overlay hidden.');
  });
  element('reset').addEventListener('click', () => { scene.resetPosition(); screen.focus(); });
  element('dialogue-next').addEventListener('click', () => { scene.advanceDialogue(); screen.focus(); });
  screen.addEventListener('pointerdown', event => { if (!(event.target instanceof HTMLButtonElement)) screen.focus(); });
  screen.addEventListener('focus', () => { element('focus-hint').textContent = '· Map focused'; });
  screen.addEventListener('blur', () => { element('focus-hint').textContent = '· Click map to focus'; });
  window.addEventListener('pagehide', () => game.destroy(true), { once: true });
} catch (error) {
  screen.replaceChildren();
  const panel = document.createElement('div'); panel.className = 'error-panel';
  panel.textContent = `${error instanceof Error ? error.message : 'Could not load map.'} Run npm.cmd run content:build, then restart the preview.`;
  screen.append(panel); report('Map loading failed.');
}
