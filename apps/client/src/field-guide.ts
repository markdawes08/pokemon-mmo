import { fieldGuideSchema, type FieldGuide } from '@pokewaterblue/content-schema';

export async function loadFieldGuide(url: string): Promise<FieldGuide> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Field guide content is missing. Rebuild content.');
  const parsed = fieldGuideSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Field guide data has invalid records or missing references. Rebuild content.');
  return parsed.data;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function table(headers: string[], rows: (string | number)[][], label: string): HTMLTableElement {
  const element = node('table'); element.setAttribute('aria-label', label);
  const head = node('thead'), headings = node('tr');
  for (const value of headers) { const cell = node('th', value); cell.scope = 'col'; headings.append(cell); }
  head.append(headings); element.append(head);
  const body = node('tbody');
  for (const row of rows) { const line = node('tr'); for (const value of row) line.append(node('td', String(value))); body.append(line); }
  element.append(body); return element;
}

export function attachFieldGuide(data: FieldGuide, onOpen: () => void, onClose: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#field-guide')!;
  const select = document.querySelector<HTMLSelectElement>('#guide-species')!;
  const level = document.querySelector<HTMLInputElement>('#guide-level')!;
  const species = new Map(data.species.map(row => [row.id, row]));
  const moves = new Map(data.moves.map(row => [row.id, row]));
  const types = new Map(data.types.map(row => [row.id, row.name]));
  const abilities = new Map(data.abilities.map(row => [row.id, row]));
  const container = (id: string) => document.getElementById(id)!;
  for (const entry of data.species) { const option = node('option', entry.name); option.value = String(entry.id); select.append(option); }
  const render = () => {
    const entry = species.get(Number(select.value))!;
    container('guide-name').textContent = entry.name;
    container('guide-types').textContent = entry.types.map(id => types.get(id)).join(' / ');
    const labels = ['HP', 'Attack', 'Defense', 'Speed', 'Sp. Attack', 'Sp. Defense'];
    container('guide-stats').replaceChildren(table(labels, [[entry.stats.hp, entry.stats.attack, entry.stats.defense, entry.stats.speed, entry.stats.spAttack, entry.stats.spDefense]], 'Base stats'));
    const abilityText = entry.abilities.map(id => abilities.get(id)!).map(ability => `${ability.name}: ${ability.description}`).join(' · ');
    container('guide-abilities').textContent = abilityText;
    const growth = data.growthRates.find(growth => growth.id === entry.growthRate)!;
    const selectedLevel = Math.min(100, Math.max(1, Math.trunc(Number(level.value)) || 1));
    container('guide-growth').textContent = `${growth.name} growth · ${growth.experience[selectedLevel]!.toLocaleString('en-US')} total experience at level ${selectedLevel}`;
    container('guide-catch').textContent = `Catch rate ${entry.catchRate} · Base experience yield ${entry.expYield}`;
    container('guide-evolutions').textContent = entry.evolutions.length
      ? entry.evolutions.map(evolution => `${species.get(evolution.species)!.name} at level ${evolution.level}`).join(' · ')
      : 'Final evolution';
    container('guide-learnset').replaceChildren(table(['Level', 'Move', 'Type', 'Power', 'Accuracy', 'PP'], entry.levelUpLearnset.map(learn => {
      const move = moves.get(learn.move)!;
      return [learn.level, move.name, types.get(move.type)!, move.power, move.accuracy, move.pp];
    }), 'Level-up moves'));
  };
  select.addEventListener('change', render); level.addEventListener('input', render);
  level.addEventListener('change', () => { level.value = String(Math.min(100, Math.max(1, Math.trunc(Number(level.value)) || 1))); render(); });
  render();
  for (const area of data.encounters) {
    const section = node('section'); section.append(node('h3', `${area.name} grass`));
    section.append(node('p', 'Share of encounters in grass; this is not a chance per step.', 'guide-note'));
    section.append(table(['Pokémon', 'Share', 'Levels'], area.entries.map(entry => [species.get(entry.species)!.name, `${entry.chance}%`, `${entry.minLevel}–${entry.maxLevel}`]), `${area.name} encounters`));
    container('guide-encounters').append(section);
  }
  container('guide-items').append(table(['Item', 'Price', 'Pocket', 'Description'], data.items.map(item => [item.name, item.price, item.pocket, item.description]), 'Items'));
  container('guide-moves').append(table(['Move', 'Type', 'Power', 'Accuracy', 'PP'], data.moves.map(move => [move.name, types.get(move.type)!, move.power, move.accuracy, move.pp]), 'Move reference'));
  const trigger = document.querySelector<HTMLButtonElement>('#guide')!;
  trigger.disabled = false;
  trigger.addEventListener('click', () => { onOpen(); dialog.showModal(); select.focus(); });
  document.getElementById('guide-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', onClose);
}
