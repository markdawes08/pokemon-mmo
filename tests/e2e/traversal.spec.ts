import { test, expect, type Page } from '@playwright/test';

const PALLET = 'MAP_PALLET_TOWN';
const HOUSE = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F';
const ROUTE = 'MAP_ROUTE1';
type WalkKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

async function position(page: Page, map: string, x: number, y: number) {
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-map-id', map);
  await expect(screen).toHaveAttribute('data-tile-x', String(x));
  await expect(screen).toHaveAttribute('data-tile-y', String(y));
  await expect(screen).toHaveAttribute('data-elevation', '3');
  await expect(screen).toHaveAttribute('data-moving', 'false');
  await expect(screen).toHaveAttribute('data-transitioning', 'false');
}

// Exercise the same focused keyboard controls as a player. Completion markers
// synchronize animation/transfer timing; they never set state or move the avatar.
async function step(page: Page, key: WalkKey) {
  const screen = page.locator('#game');
  const before = Number(await screen.getAttribute('data-step-serial'));
  await page.keyboard.press(key);
  await expect.poll(async () => Number(await screen.getAttribute('data-step-serial'))).toBeGreaterThan(before);
  await expect(screen).toHaveAttribute('data-moving', 'false');
  await expect(screen).toHaveAttribute('data-transitioning', 'false');
}

async function walk(page: Page, key: WalkKey, count: number) {
  for (let index = 0; index < count; index++) await step(page, key);
}

async function start(page: Page) {
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await screen.click();
  await expect(screen).toBeFocused();
  await position(page, PALLET, 10, 12);
}

test('the home arrow exit returns to the correct door without bouncing', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await walk(page, 'ArrowUp', 4);
  await walk(page, 'ArrowLeft', 4);
  await position(page, PALLET, 6, 8);

  await step(page, 'ArrowUp');
  await position(page, HOUSE, 4, 8); // Source destination warp index 1.
  await expect(page.locator('#location-name')).toHaveText("Player's House \u00b7 1F");
  await page.waitForTimeout(400); // The arrival arrow must not immediately exit.
  await position(page, HOUSE, 4, 8);
  await page.screenshot({ path: 'reports/players-house-browser.png', fullPage: true });

  await walk(page, 'ArrowUp', 5);
  await step(page, 'ArrowRight');
  await position(page, HOUSE, 5, 3);
  await page.screenshot({ path: 'reports/players-house-interior-browser.png', fullPage: true });
  await step(page, 'ArrowLeft');
  await step(page, 'ArrowUp');
  await walk(page, 'ArrowRight', 6);
  await position(page, HOUSE, 10, 2);
  await step(page, 'ArrowRight'); // The upstairs destination is outside this pass.
  await position(page, HOUSE, 10, 2);
  await page.waitForTimeout(150);
  await walk(page, 'ArrowLeft', 6);
  await walk(page, 'ArrowDown', 6);
  await position(page, HOUSE, 4, 8);

  // The adjacent source event has a normal metatile, so it must not act as an
  // arrow warp merely because the map JSON contains a destination there.
  await step(page, 'ArrowRight');
  await position(page, HOUSE, 5, 8);
  await step(page, 'ArrowDown');
  await position(page, HOUSE, 5, 8);
  await page.waitForTimeout(150);
  await step(page, 'ArrowLeft');
  await step(page, 'ArrowDown');
  await position(page, PALLET, 6, 8); // Source door exit includes a south step.
  await expect(page.locator('#location-name')).toHaveText('Pallet Town');
  await page.waitForTimeout(400);
  await position(page, PALLET, 6, 8);

  await step(page, 'ArrowUp');
  await position(page, HOUSE, 4, 8);
  await step(page, 'ArrowDown');
  await position(page, PALLET, 6, 8);
  await step(page, 'ArrowUp');
  await position(page, HOUSE, 4, 8);
  await page.getByRole('button', { name: 'Reset position' }).click();
  await position(page, PALLET, 10, 12);
  await expect(page.locator('#game')).toBeFocused();
  expect(errors).toEqual([]);
});

test('Route 1 preserves boundary alignment, grass movement, and one-way ledges', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await walk(page, 'ArrowRight', 2);
  await walk(page, 'ArrowUp', 12);
  await position(page, PALLET, 12, 0);
  await step(page, 'ArrowUp');
  await position(page, ROUTE, 12, 39);
  await expect(page.locator('#location-name')).toHaveText('Route 1');
  await walk(page, 'ArrowUp', 7);
  await position(page, ROUTE, 12, 32);

  await step(page, 'ArrowUp'); // Cannot climb the source ledge at (12,31).
  await position(page, ROUTE, 12, 32);
  await page.waitForTimeout(150);
  await walk(page, 'ArrowLeft', 6);
  await walk(page, 'ArrowUp', 2);
  await walk(page, 'ArrowRight', 6);
  await position(page, ROUTE, 12, 30);
  await page.screenshot({ path: 'reports/route1-browser.png', fullPage: true });
  await step(page, 'ArrowDown'); // A legal jump crosses the ledge in one action.
  await position(page, ROUTE, 12, 32);
  await step(page, 'ArrowUp');
  await position(page, ROUTE, 12, 32);
  await page.waitForTimeout(150);

  await walk(page, 'ArrowDown', 7);
  await position(page, ROUTE, 12, 39);
  await step(page, 'ArrowDown');
  await position(page, PALLET, 12, 0);
  await step(page, 'ArrowRight');
  await step(page, 'ArrowUp');
  await position(page, ROUTE, 13, 39);
  await step(page, 'ArrowDown');
  await position(page, PALLET, 13, 0);

  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => ({
    map: await page.locator('#game').getAttribute('data-map-id'),
    y: await page.locator('#game').getAttribute('data-tile-y'),
  }), { intervals: [20] }).toEqual({ map: ROUTE, y: '38' });
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'false');
  await expect(page.locator('#game')).toHaveAttribute('data-map-id', ROUTE);
  await expect(page.locator('#game')).toHaveAttribute('data-tile-x', '13');
  // Key-up may arrive just after the next ordinary tile step has started.
  await expect(page.locator('#game')).toHaveAttribute('data-tile-y', /^(37|38)$/);
  await expect(page.locator('#game')).toHaveAttribute('data-transitioning', 'false');
  expect(errors).toEqual([]);
});

test('transfer input is suppressed and losing focus releases held movement', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  await walk(page, 'ArrowUp', 4);
  await walk(page, 'ArrowLeft', 4);
  await position(page, PALLET, 6, 8);

  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-transitioning', 'true');
  // Opposite input while a door transfer is in progress must not queue an exit.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('ArrowUp');
  await position(page, HOUSE, 4, 8);
  await page.waitForTimeout(500);
  await position(page, HOUSE, 4, 8);

  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Collision overlay' }).click();
  await page.keyboard.up('ArrowUp');
  await position(page, HOUSE, 4, 7);
  await page.waitForTimeout(500);
  await position(page, HOUSE, 4, 7);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  await position(page, HOUSE, 4, 7);
  await page.locator('#game').click();
  await step(page, 'ArrowDown');
  await position(page, HOUSE, 4, 8);
  await step(page, 'ArrowDown');
  await position(page, PALLET, 6, 8);

  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#game')).toHaveAttribute('data-transitioning', 'true');
  await page.getByRole('button', { name: 'Reset position' }).click();
  await position(page, PALLET, 10, 12);
  await page.waitForTimeout(1000); // Canceled door timers/fades must stay canceled.
  await position(page, PALLET, 10, 12);
});
