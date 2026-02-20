/**
 * Playwright test: Generate modal flow with sofa, table, tvstand, kitchen, bath.
 * Run: npx playwright test tests/generate-floorplan.spec.js --project=chromium
 * (Server must be running on http://127.0.0.1:8001)
 *
 * Screenshots saved to: top2pano-editor/screenshots/
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://127.0.0.1:8001';
const SCREENSHOT_DIR = path.join(__dirname, '../screenshots');

// Ensure screenshot dir exists
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('Generate floorplan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
    // Close welcome modal: click "new plan" (empty) to start fresh
    const newPlanBtn = page.locator('img[src*="newPlanEmpty"]').first();
    if (await newPlanBtn.isVisible()) {
      await newPlanBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test('Run 1: sofa,table,tvstand,countertop,fridge,sink,toilet (no bed, chair blank)', async ({ page }) => {
    await page.click('#generate_mode');
    await page.waitForSelector('#generateModal', { state: 'visible' });

    // Ensure Auto is OFF
    const autoCb = page.locator('#gen_auto');
    if (await autoCb.isChecked()) await autoCb.click();

    // Select none, then check desired objects (bed OFF so tv stays in living)
    await page.click('#gen_select_none');
    const ids = ['sofa', 'table', 'tvstand', 'countertop', 'fridge', 'sink', 'toilet'];
    for (const id of ids) {
      const cb = page.locator(`#gen_object_list input[data-obj-id="${id}"]`);
      await cb.check();
    }

    // Leave chair count blank
    await page.fill('#gen_chairs', '');

    await page.click('#gen_run');
    await page.waitForSelector('#generateModal', { state: 'hidden' });
    await page.waitForTimeout(800); // let plan render

    await page.mouse.move(10, 10);
    const canvas = page.locator('#lin, svg[id="lin"], .canvas-area').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const outDir = path.join(SCREENSHOT_DIR);
    await page.evaluate(() => {});
    await page.screenshot({
      path: path.join(outDir, 'floorplan_run1_no_chairs.png'),
      fullPage: false,
    });
  });

  test('Run 2: same objects + chair count 4', async ({ page }) => {
    await page.click('#generate_mode');
    await page.waitForSelector('#generateModal', { state: 'visible' });

    const autoCb = page.locator('#gen_auto');
    if (await autoCb.isChecked()) await autoCb.click();

    await page.click('#gen_select_none');
    const ids = ['sofa', 'table', 'tvstand', 'countertop', 'fridge', 'sink', 'toilet'];
    for (const id of ids) {
      await page.locator(`#gen_object_list input[data-obj-id="${id}"]`).check();
    }

    await page.fill('#gen_chairs', '4');
    await page.click('#gen_run');
    await page.waitForSelector('#generateModal', { state: 'hidden' });
    await page.waitForTimeout(800);

    const outDir = path.join(SCREENSHOT_DIR);
    await page.screenshot({
      path: path.join(outDir, 'floorplan_run2_chairs4.png'),
      fullPage: false,
    });
  });
});
