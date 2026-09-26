import { test, expect } from '@playwright/test';

test('two browser contexts reach the real proxy handshake and render source content', async ({ browser, page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await expect(screen).toHaveAttribute('data-map-id', 'MAP_PALLET_TOWN');
  await expect(page.locator('#location-name')).toHaveText('Pallet Town');
  await expect(page.locator('#server-status')).toHaveText('Server connected');
  await expect(page.locator('#db-status')).toHaveText('Database ready');
  await expect(screen.locator(':scope > canvas')).toBeVisible();
  const canvas = await screen.locator(':scope > canvas').boundingBox();
  expect(canvas!.width % 240).toBe(0);
  expect(canvas!.height % 160).toBe(0);
  await expect(screen).not.toHaveAttribute('data-load-error');
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    await second.goto('/');
    await expect(second.locator('#server-status')).toHaveText('Server connected');
    const firstId = await page.locator('html').getAttribute('data-session-id');
    const secondId = await second.locator('html').getAttribute('data-session-id');
    expect(firstId).toBeTruthy(); expect(secondId).toBeTruthy(); expect(secondId).not.toBe(firstId);
  } finally { await secondContext.close(); }
  await page.screenshot({ path: 'reports/pallet-browser.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('walking obeys source collision, focus, reset, and integer resize', async ({ page }) => {
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-ready', 'true');
  await screen.click();
  await expect(screen).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(screen).toHaveAttribute('data-tile-x', '9');
  await expect(screen).toHaveAttribute('data-tile-y', '12');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowUp');
  await expect(screen).toHaveAttribute('data-tile-y', '12'); // source sign at (9,11)
  await page.getByRole('button', { name: 'Collision overlay' }).click();
  await expect(page.getByRole('button', { name: 'Collision overlay' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown'); // button has focus; must not move
  await expect(screen).toHaveAttribute('data-tile-y', '12');
  await page.getByRole('button', { name: 'Reset position' }).click();
  await expect(screen).toHaveAttribute('data-tile-x', '10');
  await page.setViewportSize({ width: 650, height: 720 });
  await expect(page.locator('#display-info')).toHaveText('240 × 160 · 2×');
  await expect(page.locator('#game > canvas')).toBeVisible();
  await page.screenshot({ path: 'reports/pallet-collision.png', fullPage: true });
});

test('missing content produces an actionable error instead of a blank canvas', async ({ page }) => {
  await page.route('**/content/maps/PalletTown.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  await expect(page.locator('#game')).toContainText('Map content has not been built.');
  await expect(page.locator('#game')).toContainText('content:build');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('missing world manifest explains the required rebuild', async ({ page }) => {
  await page.route('**/content/world.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  await expect(page.locator('#game')).toContainText('World content has not been built.');
  await expect(page.locator('#game')).toContainText('content:build');
  await expect(page.locator('#game')).not.toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('a missing destination map fails before the player can enter a broken transfer', async ({ page }) => {
  await page.route('**/content/maps/Route1.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  await expect(page.locator('#game')).toContainText('Map content has not been built.');
  await expect(page.locator('#game')).toContainText('content:build');
  await expect(page.locator('#game')).not.toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('missing required destination scenery prevents a false ready state', async ({ page }) => {
  await page.route('**/content/maps/Route1/top.png', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/');
  const screen = page.locator('#game');
  await expect(screen).toHaveAttribute('data-load-error', 'true');
  await expect(screen).toHaveAttribute('data-ready', 'false');
  await expect(page.getByRole('alert')).toContainText('Could not load scenery');
  await expect(page.getByRole('alert')).toContainText(/rebuild/i);
});
