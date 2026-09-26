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
const baseUrl = process.env.SITE_URL || 'http://localhost/';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
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
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYGD4z8DAwMDAxAADAAwBAQDJxQ8AAAAASUVORK5CYII=', 'base64');
  await page.route('https://uploads.example.test/**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'add-qa-upload', url: 'https://uploads.example.test/media/qa-upload.jpg' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
  });
  if (!process.env.SITE_URL) {
    await page.route('http://localhost/**', async (route) => {
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
  const passwordGate = await page.locator('#access-gate').isVisible();
  let passwordRejectsInvalid = false;
  if (passwordGate) {
    const password = process.env.FEED_STUDIO_PASSWORD || '';
    if (!password) throw new Error('FEED_STUDIO_PASSWORD is required for protected-site QA');
    await page.fill('#access-password', 'definitely-wrong-password');
    await page.click('#access-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#access-error')?.textContent === 'Неверный пароль.');
    passwordRejectsInvalid = true;
    await page.fill('#access-password', password);
    await page.click('#access-form button[type="submit"]');
    await page.waitForFunction(() => !document.body.classList.contains('access-locked'));
  }
  await page.waitForFunction(() => document.querySelector('#stat-source')?.textContent !== '—');
  const projectData = await page.evaluate(() => fetch('projects.json').then((response) => response.json()));
  const activeProject = projectData.projects.find((project) => project.slug === projectData.default_project);
  const inventoryData = await page.evaluate((base) => fetch(base + '/inventory.json').then((response) => response.json()), activeProject.base);
  const sourceAds = await page.locator('#stat-source').textContent();
  const fullAds = await page.locator('#stat-plans').textContent();
  const sourceFeedHref = await page.locator('#source-feed-link').getAttribute('href');
  const fullFeedLabel = await page.locator('#full-feed-link').textContent();
  const pilotFeedLabel = await page.locator('#pilot-feed-link').textContent();
  const sourceFeedSnapshot = await page.evaluate(async (href) => {
    const response = await fetch(href);
    const documentNode = new DOMParser().parseFromString(await response.text(), 'application/xml');
    return { ok: response.ok, ads: documentNode.querySelectorAll('Ad').length };
  }, sourceFeedHref);
  const sourceFeedAvailable = sourceFeedSnapshot.ok && sourceFeedSnapshot.ads === inventoryData.source_ads;
  const feedLabelsClear = fullFeedLabel === `Полный фид · ${inventoryData.full_ads} квартир ↗` &&
    pilotFeedLabel === `Тестовый фид · ${await page.evaluate((base) => fetch(base + '/status.json').then((response) => response.json()).then((status) => status.unique_plans), activeProject.base)} планировок ↗`;
  await page.click('[data-view="lots"]');
  const lotCards = await page.locator('.lot-card').count();
  const paginationVisible = inventoryData.items.length <= 12 || await page.locator('#lots-pagination button').count() > 0;
  const firstPageFirstId = await page.locator('.lot-card .lot-title span').first().textContent();
  const thumbnailImage = page.locator('.lot-card .lot-image img').first();
  const optimizedThumbnail = (await thumbnailImage.getAttribute('src') || '').includes('/thumbnails/') &&
    (await thumbnailImage.getAttribute('loading')) === 'lazy' &&
    (await thumbnailImage.getAttribute('decoding')) === 'async';
  let paginationWorks = true;
  if (inventoryData.items.length > 12) {
    await page.getByRole('button', { name: '2', exact: true }).click();
    const secondPageFirstId = await page.locator('.lot-card .lot-title span').first().textContent();
    paginationWorks = Boolean(secondPageFirstId && secondPageFirstId !== firstPageFirstId);
  }
  const firstFloor = String(inventoryData.items[0].floor);
  await page.locator('#filter-floor').selectOption(firstFloor);
  const floorLotCount = await page.locator('.lot-card').count();
  const expectedFloorCount = inventoryData.items.filter((item) => String(item.floor) === firstFloor).length;
  const lotFloorFilterWorks = floorLotCount === Math.min(12, expectedFloorCount);
  await page.locator('#filter-floor').selectOption('');
  await page.screenshot({ path: path.join(qaOutput, 'admin-lots.png'), fullPage: true });
  await page.click('[data-view="images"]');
  const firstInventoryItem = inventoryData.items[0];
  await page.locator('#image-filter-floor').selectOption(firstFloor);
  const imageFloorCount = Number(await page.locator('#image-filter-count').textContent());
  const imageFloorFilterWorks = imageFloorCount === expectedFloorCount;
  await page.locator('#image-lot').selectOption(String(firstInventoryItem.id));
  const imageCards = await page.locator('.image-item').count();
  const allSourceImagesVisible = imageCards === (firstInventoryItem.source_images || []).length + 1;
  const brandCardProtected = await page.locator('[data-remove-image="brand-card"]').isDisabled();
  const firstSourceImageId = String(firstInventoryItem.source_images[0].id);
  await page.locator(`[data-remove-image="${firstSourceImageId}"]`).click();
  const sourceImageExcluded = await page.locator('.image-item').count() === imageCards - 1 &&
    await page.locator(`[data-restore-image="${firstSourceImageId}"]`).isVisible();
  await page.locator(`[data-restore-image="${firstSourceImageId}"]`).click();
  const sourceImageRestored = await page.locator('.image-item').count() === imageCards;
  const uploadDropZoneAvailable = !(await page.locator('#choose-image-file').isDisabled());
  const uploadFixture = fs.readFileSync(path.join(siteRoot, firstInventoryItem.thumbnail));
  await page.locator('#image-file-input').setInputFiles({ name: 'qa-upload.webp', mimeType: 'image/webp', buffer: uploadFixture });
  await page.waitForFunction(() => document.querySelector('#image-upload-status')?.textContent.includes('загружено'));
  const uploadedImageVisible = await page.locator('.image-item').count() === imageCards + 1;
  await page.locator('[data-remove-image="add-qa-upload"]').click();
  await page.click('#save-draft');
  const uploadedImageExcludedWithoutDeletion = await page.evaluate((lotId) => {
    const draftKey = Object.keys(localStorage).find((key) => key.indexOf('feed-studio-rules-v1-') === 0);
    if (!draftKey) return false;
    const draft = JSON.parse(localStorage.getItem(draftKey));
    const override = draft.image_settings.lot_overrides[String(lotId)];
    return override.added.some((image) => image.id === 'add-qa-upload') && override.hidden.includes('add-qa-upload');
  }, firstInventoryItem.id);
  const uploadedImageShownAsExcluded = await page.locator('[data-restore-image="add-qa-upload"]').isVisible();
  await page.locator('[data-restore-image="add-qa-upload"]').click();
  const uploadedImageRestored = await page.locator('.image-item').count() === imageCards + 1;
  await page.fill('#bulk-image-from', '3');
  await page.fill('#bulk-image-to', '1');
  await page.click('#apply-image-bulk');
  const imageBulkRuleCreated = await page.locator('#image-bulk-rules .bulk-rule').count() === 1;
  await page.screenshot({ path: path.join(qaOutput, 'admin-images.png'), fullPage: true });
  await page.click('[data-view="parameters"]');
  await page.locator('#parameter-filter-floor').selectOption(firstFloor);
  const parameterFloorCount = Number(await page.locator('#parameter-filter-count').textContent());
  const parameterFloorFilterWorks = parameterFloorCount === expectedFloorCount;
  const sourceTagsVisible = await page.locator('#source-tags .tag-chip').count() > 10;
  const supportedParameterCount = await page.locator('#new-parameter-tag option').count();
  await page.locator('#parameter-lot').selectOption(String(firstInventoryItem.id));
  await page.click('#add-parameter');
  const individualParameterAdded = await page.locator('#parameter-list .parameter-row').count() === 1;
  await page.click('#apply-parameter-bulk');
  const parameterBulkRuleCreated = await page.locator('#parameter-bulk-rules .bulk-rule').count() === 1;
  await page.screenshot({ path: path.join(qaOutput, 'admin-parameters.png'), fullPage: true });
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
    ok: response && response.ok() && errors.length === 0 && passwordGate && passwordRejectsInvalid && projectData.projects.length >= 1 && sourceAds === String(inventoryData.source_ads) && fullAds === String(inventoryData.full_ads) && sourceFeedAvailable && feedLabelsClear && lotCards === Math.min(12, inventoryData.items.length) && paginationVisible && paginationWorks && lotFloorFilterWorks && imageFloorFilterWorks && parameterFloorFilterWorks && optimizedThumbnail && allSourceImagesVisible && brandCardProtected && sourceImageExcluded && sourceImageRestored && uploadDropZoneAvailable && uploadedImageVisible && uploadedImageExcludedWithoutDeletion && uploadedImageShownAsExcluded && uploadedImageRestored && imageBulkRuleCreated && sourceTagsVisible && supportedParameterCount === 8 && individualParameterAdded && parameterBulkRuleCreated && promoVisible && assetCards >= 2 && assetsReady >= 2 && uploadTargetsGitHub && projectModalVisible && generatedSlug === 'zhk-testovyy' && !mobileOverflow && publishModalVisible,
    http_status: response ? response.status() : null,
    password_gate: passwordGate,
    invalid_password_rejected: passwordRejectsInvalid,
    source_ads: sourceAds,
    full_demo_ads: fullAds,
    source_feed_available: sourceFeedAvailable,
    feed_labels_clear: feedLabelsClear,
    displayed_lot_cards: lotCards,
    pagination_visible: paginationVisible,
    pagination_works: paginationWorks,
    lot_floor_filter: lotFloorFilterWorks,
    lot_floor_filter_displayed: floorLotCount,
    lot_floor_filter_expected: Math.min(12, expectedFloorCount),
    image_floor_filter: imageFloorFilterWorks,
    parameter_floor_filter: parameterFloorFilterWorks,
    optimized_thumbnail: optimizedThumbnail,
    source_images_visible: allSourceImagesVisible,
    brand_card_protected: brandCardProtected,
    source_image_excluded: sourceImageExcluded,
    source_image_restored: sourceImageRestored,
    upload_drop_zone: uploadDropZoneAvailable,
    uploaded_image_visible: uploadedImageVisible,
    uploaded_image_excluded_without_deletion: uploadedImageExcludedWithoutDeletion,
    uploaded_image_shown_as_excluded: uploadedImageShownAsExcluded,
    uploaded_image_restored: uploadedImageRestored,
    image_bulk_rule: imageBulkRuleCreated,
    source_tags_visible: sourceTagsVisible,
    supported_parameters: supportedParameterCount,
    individual_parameter: individualParameterAdded,
    parameter_bulk_rule: parameterBulkRuleCreated,
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
