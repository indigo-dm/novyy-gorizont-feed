const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('C:/Users/vdovi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const { chromium } = playwright;

const fs = require('fs');
const siteRoot = path.join(__dirname, '..', 'site');
const baseUrl = process.env.SITE_URL || 'http://feed.local/';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/truetype',
  '.xml': 'application/xml; charset=utf-8'
};

(async () => {
  const errors = [];
  const launchOptions = { headless: true };
  if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
  else if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  if (!process.env.SITE_URL) {
    await page.route('http://feed.local/**', async (route) => {
      const url = new URL(route.request().url());
      const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
      const filePath = path.resolve(siteRoot, relativePath);
      if (!filePath.startsWith(path.resolve(siteRoot)) || !fs.existsSync(filePath)) {
        await route.fulfill({ status: 404, body: 'Not found' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        body: fs.readFileSync(filePath)
      });
    });
  }
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (resourceResponse) => {
    if (resourceResponse.status() >= 400) errors.push(`${resourceResponse.status()} ${resourceResponse.url()}`);
  });
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#stat-source')?.textContent !== '—');
  const sourceAds = await page.locator('#stat-source').textContent();
  const plans = await page.locator('#stat-plans').textContent();
  await page.click('[data-view="lots"]');
  const lotCards = await page.locator('.lot-card').count();
  await page.click('[data-view="promotions"]');
  await page.locator('[data-field="enabled"]').check();
  while (await page.locator('[data-array="house_ids"]:checked').count()) {
    await page.locator('[data-array="house_ids"]:checked').first().uncheck();
  }
  while (await page.locator('[data-array="rooms"]:checked').count()) {
    await page.locator('[data-array="rooms"]:checked').first().uncheck();
  }
  await page.click('[data-view="preview"]');
  const promoVisible = await page.locator('#live-promo').isVisible();
  await page.screenshot({ path: path.join(__dirname, '..', 'output', 'admin-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="dashboard"]');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.click('#publish-settings');
  const publishModalVisible = await page.locator('#publish-modal').isVisible();
  await page.screenshot({ path: path.join(__dirname, '..', 'output', 'admin-mobile.png'), fullPage: true });
  const result = {
    ok: response && response.ok() && errors.length === 0 && sourceAds === '218' && plans === '13' && lotCards === 13 && promoVisible && !mobileOverflow && publishModalVisible,
    http_status: response ? response.status() : null,
    source_ads: sourceAds,
    pilot_plans: plans,
    lot_cards: lotCards,
    live_promotion_preview: promoVisible,
    publish_confirmation: publishModalVisible,
    mobile_horizontal_overflow: mobileOverflow,
    browser_errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.ok) process.exit(1);
})();
