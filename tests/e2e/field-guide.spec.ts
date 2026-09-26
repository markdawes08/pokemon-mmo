import { test, expect, type Page } from '@playwright/test';

interface GuideProjection {
  schemaVersion: number;
  profile: string;
  scope: string;
  species: {
    id: number; name: string;
    stats: { hp: number; attack: number; defense: number; speed: number; spAttack: number; spDefense: number };
    catchRate: number; expYield: number; growthRate: number;
    levelUpLearnset: { level: number; move: number }[];
    evolutions: { level: number; species: number }[];
  }[];
  moves: { id: number; name: string; power: number; accuracy: number; pp: number }[];
  items: { id: number; name: string; description: string; price: number }[];
  growthRates: { id: number; experience: number[] }[];
  encounters: { mapId: string; entries: { species: number; chance: number; minLevel: number; maxLevel: number }[] }[];
}

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
}

async function coordinates(page: Page) {
  const screen = page.locator('#game');
  return { x: await screen.getAttribute('data-tile-x'), y: await screen.getAttribute('data-tile-y') };
}

test('field guide shows independently checked source records and receives only public reference data', async ({ page }) => {
  await start(page);
  const response = await page.request.get('/content/field-guide.json');
  expect(response.ok()).toBe(true);
  const data = await response.json() as GuideProjection;
  expect(data.schemaVersion).toBe(1);
  expect(data.profile).toBe('firered-private');
  expect(data.scope).toBe('pallet-route1-reference');
  expect(data.species.map(species => species.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20]);

  // These fixtures were inspected directly in the pinned source, independently of the exporter.
  const bulbasaur = data.species.find(species => species.id === 1)!;
  expect(bulbasaur.stats).toEqual({ hp: 45, attack: 49, defense: 49, speed: 45, spAttack: 65, spDefense: 65 });
  expect([bulbasaur.catchRate, bulbasaur.expYield, bulbasaur.growthRate]).toEqual([45, 64, 3]);
  expect(bulbasaur.evolutions).toEqual([{ level: 16, species: 2 }]);
  expect(bulbasaur.levelUpLearnset.filter(move => move.level === 15)).toEqual([{ level: 15, move: 77 }, { level: 15, move: 79 }]);
  const tackle = data.moves.find(move => move.id === 33)!;
  expect([tackle.power, tackle.accuracy, tackle.pp]).toEqual([35, 95, 35]);
  const potion = data.items.find(item => item.id === 13)!;
  expect(potion.price).toBe(300);
  expect(potion.description).toMatch(/20 points/);
  expect(data.growthRates.find(rate => rate.id === 3)!.experience.filter((_, level) => [0, 1, 2, 5, 100].includes(level)))
    .toEqual([0, 1, 9, 135, 1_059_860]);
  const encounters = data.encounters.find(encounter => encounter.mapId === 'MAP_ROUTE1')!;
  expect(encounters.entries).toEqual([
    { species: 16, chance: 50, minLevel: 2, maxLevel: 5 },
    { species: 19, chance: 50, minLevel: 2, maxLevel: 4 },
  ]);
  const publicText = JSON.stringify(data);
  expect(publicText).not.toMatch(/"(?:effect|flags|effectBindings|slots|encounterRate|sourceSymbol|sourcePath)"|EFFECT_HIT|BattleUseFunc_|FieldUseFunc_|ITEM4_HEAL_HP/);
  const privateResponse = await page.request.get('/content/server/gameplay.json', { headers: { Accept: 'application/json' } });
  expect(privateResponse.status()).toBe(404);

  await page.getByRole('button', { name: 'Field guide', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Field guide', exact: true });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText(/reference|preview/i);
  await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('1');
  await expect(page.locator('#guide-stats')).toContainText('45');
  await expect(page.locator('#guide-stats')).toContainText('49');
  await expect(page.locator('#guide-stats')).toContainText('65');
  await expect(guide).toContainText(/IVYSAUR/i);
  await page.locator('#guide-level').fill('1.5');
  await page.locator('#guide-level').press('Tab');
  await expect(page.locator('#guide-level')).toHaveValue('1');
  await expect(page.locator('#guide-growth')).toContainText('1 total experience at level 1');
  await page.locator('#guide-level').fill('101');
  await page.locator('#guide-level').press('Tab');
  await expect(page.locator('#guide-level')).toHaveValue('100');
  await expect(page.locator('#guide-growth')).toContainText('1,059,860 total experience at level 100');
  await page.locator('#guide-level').fill('5');
  await page.locator('#guide-level').press('Tab');
  await expect(page.locator('#guide-growth')).toContainText('135 total experience at level 5');
  const powderRows = page.locator('#guide-learnset tr').filter({ hasText: /POISONPOWDER|SLEEP POWDER/i });
  await expect(powderRows).toHaveCount(2);
  await expect(powderRows.nth(0)).toContainText(/15.*POISONPOWDER/i);
  await expect(powderRows.nth(1)).toContainText(/15.*SLEEP POWDER/i);
  const tackleRow = page.locator('#guide-moves tr').filter({ has: page.getByRole('cell', { name: 'TACKLE', exact: true }) });
  await expect(tackleRow).toHaveCount(1);
  await expect(tackleRow.getByRole('cell')).toHaveText(['TACKLE', 'NORMAL', '35', '95', '35']);
  await expect(page.locator('#guide-encounters')).toContainText(/PIDGEY/i);
  await expect(page.locator('#guide-encounters')).toContainText(/RATTATA/i);
  await expect(page.locator('#guide-encounters')).toContainText('50%');
  await expect(page.locator('#guide-items')).toContainText('20 points');
  await expect(page.locator('#guide-items')).toContainText('300');
  await page.screenshot({ path: 'reports/field-guide-browser.png', fullPage: true });
});

test('field guide keeps keyboard focus and movement isolated, then restores deliberate walking', async ({ page }) => {
  await start(page);
  const screen = page.locator('#game');
  await screen.click();
  await page.keyboard.down('ArrowUp');
  await expect(screen).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Field guide', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Field guide', exact: true });
  await expect(guide).toBeVisible();
  await expect(screen).toHaveAttribute('data-moving', 'false');
  const resting = await coordinates(page);
  await page.waitForTimeout(400);
  expect(await coordinates(page)).toEqual(resting);
  await page.keyboard.up('ArrowUp');
  await page.getByRole('combobox', { name: 'Species', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('2');
  expect(await coordinates(page)).toEqual(resting);
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
    expect(await guide.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.down('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(screen).toBeFocused();
  await screen.dispatchEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', repeat: true, bubbles: true });
  await page.waitForTimeout(400);
  expect(await coordinates(page)).toEqual(resting);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(screen).toHaveAttribute('data-tile-y', String(Number(resting.y) + 1));
  await expect(screen).toHaveAttribute('data-moving', 'false');
  await expect(screen).toHaveAttribute('data-movement-mode', 'walk');

  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: 'Field guide', exact: true }).click();
  await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(760);
  await page.screenshot({ path: 'reports/field-guide-small-browser.png', fullPage: true });
  await page.getByRole('button', { name: 'Close field guide', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(screen).toBeFocused();
});

test('missing or invalid field guide data fails with rebuild guidance before the preview is ready', async ({ page }) => {
  await page.route('**/content/field-guide.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  await expect(page.locator('#game')).toContainText(/field guide/i);
  await expect(page.locator('#game')).toContainText('content:build');
  await expect(page.locator('#game')).not.toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#game > canvas')).toHaveCount(0);
  await page.unroute('**/content/field-guide.json');
  await page.route('**/content/field-guide.json', route => route.fulfill({ json: { schemaVersion: 1, species: [] } }));
  await page.reload();
  await expect(page.locator('#game')).toContainText(/field guide/i);
  await expect(page.locator('#game')).toContainText('content:build');
  await expect(page.locator('#game')).not.toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#game > canvas')).toHaveCount(0);
});
