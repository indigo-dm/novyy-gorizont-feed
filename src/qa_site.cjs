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
const registryFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'));
const qaOutput = path.join(__dirname, '..', 'work', registryFile.default_project, 'output');
fs.mkdirSync(qaOutput, { recursive: true });
const baseUrl = process.env.SITE_URL || 'http://feed.local/';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
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
  const projectData = await page.evaluate(() => fetch('projects.json').then((response) => response.json()));
  const activeProject = projectData.projects.find((project) => project.slug === projectData.default_project);
  const inventoryData = await page.evaluate((base) => fetch(base + '/inventory.json').then((response) => response.json()), activeProject.base);
  const sourceAds = await page.locator('#stat-source').textContent();
  const fullAds = await page.locator('#stat-plans').textContent();
  await page.click('[data-view="lots"]');
  const lotCards = await page.locator('.lot-card').count();
  const paginationVisible = inventoryData.items.length <= 24 || await page.locator('#lots-pagination button').count() > 0;
  const firstPageFirstId = await page.locator('.lot-card .lot-title span').first().textContent();
  let paginationWorks = true;
  if (inventoryData.items.length > 24) {
    await page.getByRole('button', { name: '2', exact: true }).click();
    const secondPageFirstId = await page.locator('.lot-card .lot-title span').first().textContent();
    paginationWorks = Boolean(secondPageFirstId && secondPageFirstId !== firstPageFirstId);
  }
  await page.screenshot({ path: path.join(qaOutput, 'admin-lots.png'), fullPage: true });
  await page.click('[data-view="promotions"]');
  await page.locator('[data-field="enabled"]').check();
  const matchingId = await page.evaluate(async (base) => {
    const [inventory, settings] = await Promise.all([
      fetch(base + '/inventory.json').then((response) => response.json()),
      fetch(base + '/settings.json').then((response) => response.json())
    ]);
    const rule = settings.rules[0];
    const today = new Date().toISOString().slice(0, 10);
    const matches = (item) => {
      if (rule.starts_at && today < rule.starts_at) return false;
      if (rule.ends_at && today > rule.ends_at) return false;
      if ((rule.exclude_ids || []).map(String).includes(String(item.id))) return false;
      if ((rule.include_ids || []).length && !(rule.include_ids || []).map(String).includes(String(item.id))) return false;
      if ((rule.house_ids || []).length && !(rule.house_ids || []).map(String).includes(String(item.house_id))) return false;
      if ((rule.rooms || []).length && !(rule.rooms || []).map(String).includes(String(item.rooms))) return false;
      if (rule.area_min != null && Number(item.area) < Number(rule.area_min)) return false;
      if (rule.area_max != null && Number(item.area) > Number(rule.area_max)) return false;
      return true;
    };
    return inventory.items.find(matches)?.id || inventory.items[0]?.id;
  }, activeProject.base);
  await page.click('[data-view="preview"]');
  await page.locator('#preview-lot').selectOption(String(matchingId));
  const promoVisible = await page.locator('#live-promo').isVisible();
  await page.screenshot({ path: path.join(qaOutput, 'admin-preview.png'), fullPage: true });
  await page.click('[data-view="assets"]');
  const assetCards = await page.locator('.asset-card').count();
  const assetsReady = await page.locator('.asset-status.ready').count();
  const uploadTargetsGitHub = (await page.locator('#upload-assets').getAttribute('href') || '').startsWith('https://github.com/indigo-dm/');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(qaOutput, 'admin-assets.png'), fullPage: true });
  await page.click('#add-project');
  const projectModalVisible = await page.locator('#project-modal').isVisible();
  await page.fill('#new-project-name', 'ЖК Тестовый');
  const generatedSlug = await page.locator('#new-project-slug').inputValue();
  await page.click('#cancel-project');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="dashboard"]');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.click('#publish-settings');
  const publishModalVisible = await page.locator('#publish-modal').isVisible();
  await page.screenshot({ path: path.join(qaOutput, 'admin-mobile.png'), fullPage: true });
  const result = {
    ok: response && response.ok() && errors.length === 0 && projectData.projects.length >= 1 && sourceAds === String(inventoryData.source_ads) && fullAds === String(inventoryData.full_ads) && lotCards === Math.min(24, inventoryData.items.length) && paginationVisible && paginationWorks && promoVisible && assetCards >= 2 && assetsReady >= 2 && uploadTargetsGitHub && projectModalVisible && generatedSlug === 'zhk-testovyy' && !mobileOverflow && publishModalVisible,
    http_status: response ? response.status() : null,
    source_ads: sourceAds,
    full_demo_ads: fullAds,
    displayed_lot_cards: lotCards,
    pagination_visible: paginationVisible,
    pagination_works: paginationWorks,
    live_promotion_preview: promoVisible,
    registered_projects: projectData.projects.length,
    asset_cards: assetCards,
    assets_ready: assetsReady,
    github_upload_link: uploadTargetsGitHub,
    project_create_modal: projectModalVisible,
    generated_project_slug: generatedSlug,
    publish_confirmation: publishModalVisible,
    mobile_horizontal_overflow: mobileOverflow,
    browser_errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.ok) process.exit(1);
})();
