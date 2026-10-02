import type { TrainerAssets } from '@pokewaterblue/protocol';

/** Only owner-visible display fields reach this renderer. No live item or party commands yet. */
export function renderTrainerAssets(target: HTMLElement, assets: TrainerAssets | null) {
  target.replaceChildren();
  const add = (parent: HTMLElement, tag: string, text: string, className = '') => {
    const element = document.createElement(tag); element.textContent = text; element.className = className;
    parent.append(element); return element;
  };
  if (!assets) { add(target, 'p', 'Saved party and bag have not been loaded.', 'account-note'); return; }
  target.dataset.revision = String(assets.revision);
  if (assets.profileId) add(target, 'p', 'Development fixture · Squirtle Lv. 5 starting profile. Enter shared exploration through Account, or test mechanics with Practice battle. Wild encounters are still ahead.', 'asset-fixture');
  add(target, 'h4', `Party · ${assets.party.length}/6`);
  if (!assets.party.length) add(target, 'p', 'Your party is empty. Your first partner arrives with the opening adventure.', 'account-note');
  for (const member of assets.party) {
    const card = add(target, 'article', '', 'asset-creature');
    card.setAttribute('aria-label', `${member.name} level ${member.level}`);
    const title = add(card, 'div', '', 'asset-line');
    add(title, 'strong', member.nickname ?? member.name);
    add(title, 'span', `Lv. ${member.level}`);
    add(card, 'p', `HP ${member.hp}/${member.maxHp} · ${member.status === 'healthy' ? 'Healthy' : member.status}`, 'account-note');
    const moves = add(card, 'ul', '', 'asset-moves');
    for (const move of member.moves) {
      const row = add(moves, 'li', '', 'asset-line');
      add(row, 'span', move.name); add(row, 'span', `${move.pp}/${move.maxPp} PP`);
    }
  }
  add(target, 'h4', 'Bag');
  if (!assets.inventory.length) add(target, 'p', 'No items yet.', 'account-note');
  else {
    const items = add(target, 'ul', '', 'asset-items');
    for (const item of assets.inventory) {
      const row = add(items, 'li', '', 'asset-line');
      add(row, 'span', item.name); add(row, 'strong', `× ${item.quantity}`);
    }
  }
  add(target, 'p', `Money ${assets.money.toLocaleString()} · Storage ${assets.storage.used}/${assets.storage.capacity}`, 'account-note asset-totals');
  add(target, 'p', 'Saved records only. Party changes and item use are coming later.', 'account-note');
}
