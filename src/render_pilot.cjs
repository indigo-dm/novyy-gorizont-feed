const fs = require('fs');
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('C:/Users/vdovi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const { chromium } = playwright;
const { optionalElements, visibility } = require('./card_layout.cjs');

const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
const projectSlug = process.env.PROJECT_SLUG || registry.default_project;
const projectDir = path.join(root, 'projects', projectSlug);
const workDir = path.join(root, 'work', projectSlug);
const manifest = JSON.parse(fs.readFileSync(path.join(workDir, 'output', 'full-manifest.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf8'));
const outputDir = path.join(workDir, 'output', 'images');
const previewDir = path.join(workDir, 'output', 'previews');
const thumbnailDir = path.join(workDir, 'output', 'thumbnails');
const renderCacheRoot = String(process.env.RENDER_CACHE_DIR || '').trim();
const renderCacheProject = renderCacheRoot ? path.join(path.resolve(renderCacheRoot), projectSlug) : '';
for (const [folder, destination] of [['images', outputDir], ['previews', previewDir], ['thumbnails', thumbnailDir]]) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const cached = renderCacheProject ? path.join(renderCacheProject, folder) : '';
  if (cached && fs.existsSync(cached)) fs.cpSync(cached, destination, { recursive: true });
}

const requestedRenderIds = String(process.env.RENDER_IDS || '').trim();
const renderEveryItem = !requestedRenderIds || requestedRenderIds.toLowerCase() === 'all';
const changedOnly = requestedRenderIds.toLowerCase() === 'changed';
const renderIdSet = new Set(changedOnly
  ? []
  : requestedRenderIds.split(',').map((value) => value.trim()).filter(Boolean));
const publishedDataDir = String(process.env.PUBLISHED_DATA_DIR || '').trim();
const previousInventoryPath = publishedDataDir
  ? path.join(path.resolve(publishedDataDir), 'projects', projectSlug, 'inventory.json')
  : '';
const previousInventory = previousInventoryPath && fs.existsSync(previousInventoryPath)
  ? JSON.parse(fs.readFileSync(previousInventoryPath, 'utf8'))
  : { items: [] };
const previousItems = new Map((previousInventory.items || []).map((item) => [String(item.id), item]));
const sourceImageUrl = (item) => {
  if (item.plan_url) return String(item.plan_url);
  const images = item.source_image_items || item.source_images || [];
  const first = images[0];
  return String(first && typeof first === 'object' ? first.url : first || '');
};
const cardSignature = (item) => JSON.stringify({
  house: String(item.house || ''),
  rooms: String(item.feed_parameters?.Rooms ?? item.rooms ?? ''),
  area: String(item.area || ''),
  floor: String(item.floor || ''),
  floors: String(item.floors || ''),
  price: String(item.price || ''),
  decoration: String(item.decoration || ''),
  plan_url: sourceImageUrl(item),
  promotion: item.promotion || null
});
const sourceCardChanged = (item) => {
  const previous = previousItems.get(String(item.id));
  return previous ? cardSignature(previous) !== cardSignature(item) : false;
};
const manifestIds = new Set(manifest.items.map((item) => String(item.id)));
for (const [directory, extension] of [[outputDir, '.png'], [previewDir, '.webp'], [thumbnailDir, '.webp']]) {
  for (const filename of fs.readdirSync(directory)) {
    if (path.extname(filename).toLowerCase() === extension && !manifestIds.has(path.basename(filename, extension))) {
      fs.rmSync(path.join(directory, filename), { force: true });
    }
  }
}
const hasCompleteRender = (item) => fs.existsSync(path.join(outputDir, `${item.id}.png`)) &&
  fs.existsSync(path.join(previewDir, `${item.id}.webp`)) &&
  fs.existsSync(path.join(thumbnailDir, `${item.id}.webp`));
const changedSourceIds = new Set(manifest.items.filter(sourceCardChanged).map((item) => String(item.id)));
const itemsToRender = manifest.items.filter((item) => renderEveryItem ||
  renderIdSet.has(String(item.id)) ||
  changedSourceIds.has(String(item.id)) ||
  !hasCompleteRender(item));

const mimeByExt = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/truetype' };
const dataUrl = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return `data:${mimeByExt[ext] || 'application/octet-stream'};base64,${fs.readFileSync(filePath).toString('base64')}`;
};
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const formatNumber = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value));
const formatPrice = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value)) + ' ₽';
const isStudio = (rooms) => String(rooms || '').trim().toLocaleLowerCase('ru-RU') === 'студия';
const roomTitle = (rooms) => isStudio(rooms) ? 'Квартира-студия' : `${rooms}-комнатная квартира`;

async function ensurePlanFile(item) {
  const destination = path.join(workDir, item.plan_file);
  if (fs.existsSync(destination) && fs.statSync(destination).size) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(item.plan_url, { headers: { 'User-Agent': 'feed-studio-renderer/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${item.plan_url}`);
      const temporary = `${destination}.part`;
      fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
      fs.rmSync(destination, { force: true });
      fs.renameSync(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
    }
  }
  throw lastError;
}

async function createWebpVariants(page, sourceBuffer) {
  const source = `data:image/png;base64,${sourceBuffer.toString('base64')}`;
  const encoded = await page.evaluate(async ({ sourceUrl }) => {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = sourceUrl;
    });
    const render = (width, height, quality) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL('image/webp', quality).split(',')[1];
    };
    return {
      preview: render(960, 720, 0.8),
      thumbnail: render(480, 360, 0.76)
    };
  }, { sourceUrl: source });
  return {
    preview: Buffer.from(encoded.preview, 'base64'),
    thumbnail: Buffer.from(encoded.thumbnail, 'base64')
  };
}

const fontUrl = dataUrl(path.join(root, 'assets', 'Manrope-Variable.ttf'));
const logoPath = path.join(projectDir, 'assets', config.brand.logo);
const renderPath = path.join(projectDir, 'assets', config.brand.key_render);
const backgroundRenderPath = config.brand.background_render
  ? path.join(projectDir, 'assets', config.brand.background_render)
  : '';
const logoUrl = fs.existsSync(logoPath) ? dataUrl(logoPath) : '';
const renderUrl = fs.existsSync(renderPath) ? dataUrl(renderPath) : '';
const backgroundRenderUrl = backgroundRenderPath && fs.existsSync(backgroundRenderPath) ? dataUrl(backgroundRenderPath) : '';
const cardVisibility = visibility(config.brand);
const logoClass = cardVisibility.showLogoPanel ? 'logo logo-light-panel' : 'logo';
const renderPosition = {
  left: 'left center',
  right: 'right center',
}[config.brand.key_render_align] || 'center';
const darkenHex = (value, factor = 0.72) => {
  const normalized = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#000000';
  const channels = [1, 3, 5].map((offset) => Math.max(0, Math.min(255, Math.round(parseInt(normalized.slice(offset, offset + 2), 16) * factor))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

function htmlFor(item, includePromotion = true) {
  const effectiveRooms = item.feed_parameters && item.feed_parameters.Rooms != null
    ? item.feed_parameters.Rooms
    : item.rooms;
  const planUrl = dataUrl(path.join(workDir, item.plan_file));
  const logo = logoUrl
    ? `<img class="${logoClass}" src="${logoUrl}">`
    : `<div class="logo logo-fallback">${esc(config.project.replace(/^ЖК\s+/i, ''))}<small>жилой комплекс</small></div>`;
  const keyRender = renderUrl
    ? `<img src="${renderUrl}">`
    : `<div class="render-fallback"><span>Жилой комплекс</span><strong>${esc(config.project.replace(/^ЖК\s+/i, ''))}</strong></div>`;
  const backgroundRender = backgroundRenderUrl ? `<img class="background-render" src="${backgroundRenderUrl}">` : '';
  const promo = includePromotion && item.promotion
    ? `<div class="promo"><span>${esc(item.promotion.label)}</span>${esc(item.promotion.text)}</div>`
    : '';
  const { houseBadge, decoration } = optionalElements(config.brand, item, esc);
  const render = cardVisibility.showKeyRender ? `<div class="render">${keyRender}</div>` : '';
  const primary = config.brand.green || '#00605C';
  const background = config.brand.background_color || primary;
  const textColor = config.brand.text_color || config.brand.white || '#FFFFFF';
  const subtitleColor = config.brand.subtitle_color || config.brand.gray || '#9B9B9B';
  const promotionFrameColor = config.brand.promotion_frame_color || primary;
  const promotionTextColor = config.brand.promotion_text_color || textColor;
  const darkBackground = darkenHex(background);
  const roomsMetricClass = isStudio(effectiveRooms) ? 'value value-studio' : 'value';
  const roomsMetricLabel = isStudio(effectiveRooms) ? 'Тип' : 'Комнат';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  @font-face{font-family:Manrope;src:url('${fontUrl}') format('truetype');font-weight:200 800;font-style:normal}
  :root{--primary:${primary};--bg:${background};--bg-dark:${darkBackground};--text:${textColor};--subtitle:${subtitleColor};--promo-frame:${promotionFrameColor};--promo-text:${promotionTextColor};--ink:${config.brand.green_dark || primary}}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;height:900px;overflow:hidden;font-family:Manrope,Arial,sans-serif;background:var(--bg)}
  .canvas{position:relative;width:1200px;height:900px;color:var(--text);background:linear-gradient(145deg,var(--bg),var(--bg-dark))}.canvas:after{content:'';position:absolute;inset:0;background:var(--bg);opacity:.6}.background-render{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.46}
  .left,.card{z-index:1}.left{position:absolute;left:56px;top:54px;width:470px;height:792px}.logo{width:350px;height:111px;object-fit:contain;object-position:left top}.logo-light-panel{padding:12px 18px;border-radius:14px;background:#fff}.logo-fallback{display:flex;flex-direction:column;justify-content:center;color:var(--primary);font-size:35px;line-height:1;font-weight:800;letter-spacing:.035em;text-transform:uppercase}.logo-fallback small{margin-top:11px;color:var(--subtitle);font-size:14px;font-weight:700;letter-spacing:.26em}
  .house{position:absolute;top:126px;left:0;height:42px;display:flex;align-items:center;padding:0 18px;border:1px solid currentColor;border-radius:100px;font-size:19px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
  .promo{position:absolute;top:117px;right:0;height:60px;max-width:470px;display:flex;align-items:center;padding:0 19px;border-radius:100px;background:var(--promo-frame);color:var(--promo-text);font-size:34px;line-height:1;font-weight:800;white-space:nowrap;overflow:hidden}.promo span{flex:0 0 auto;margin-right:10px;font-size:34px;line-height:1;letter-spacing:.035em;text-transform:uppercase}
  .render{position:absolute;top:181px;width:470px;height:405px;padding:8px;border:2px solid var(--primary);background:rgba(255,255,255,.1)}.render img{width:100%;height:100%;display:block;object-fit:cover;object-position:${renderPosition}}.render-fallback{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:44px;text-align:center;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(0,0,0,.08))}.render-fallback:before{content:'◆';margin-bottom:28px;color:var(--primary);font-size:54px}.render-fallback span{margin-bottom:13px;color:var(--subtitle);font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}.render-fallback strong{font-size:34px;line-height:1.12;text-transform:uppercase}
  .lot{position:absolute;top:616px;width:470px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:.035em;text-transform:uppercase}.finish{position:absolute;top:660px;font-size:18px;color:var(--subtitle)}
  .price{position:absolute;left:0;bottom:0;width:405px;height:92px;display:flex;align-items:center;justify-content:center;background:var(--primary);color:var(--text);font-size:36px;font-weight:800;letter-spacing:-.02em}
  .card{position:absolute;top:54px;right:56px;width:560px;height:792px;background:#fff;color:var(--ink);box-shadow:0 20px 55px rgba(0,33,31,.2)}
  .plan{position:absolute;top:24px;left:30px;width:500px;height:606px;display:flex;align-items:center;justify-content:center;overflow:hidden}.plan img{max-width:100%;max-height:100%;object-fit:contain;display:block}
  .rule{position:absolute;left:30px;right:30px;top:644px;height:1px;background:#dfe5e3}.metrics{position:absolute;left:28px;right:28px;bottom:26px;height:106px;display:grid;grid-template-columns:.85fr 1.35fr 1fr;align-items:center}
  .metric{text-align:center;min-width:0}.metric+.metric{border-left:1px solid #dfe5e3}.label{margin-bottom:6px;font-size:16px;line-height:1;font-weight:600;color:var(--subtitle);letter-spacing:.035em;text-transform:uppercase;white-space:nowrap}.value{font-size:43px;line-height:1;font-weight:800;color:var(--primary);white-space:nowrap}.value-studio{font-size:27px}.value small{font-size:23px;font-weight:700}
  </style></head><body><main class="canvas">${backgroundRender}<section class="left">${logo}${houseBadge}${promo}${render}<div class="lot">${esc(roomTitle(effectiveRooms))}</div>${decoration}<div class="price">${esc(formatPrice(item.price))}</div></section><section class="card"><div class="plan"><img src="${planUrl}"></div><div class="rule"></div><div class="metrics"><div class="metric"><div class="label">${roomsMetricLabel}</div><div class="${roomsMetricClass}">${esc(effectiveRooms)}</div></div><div class="metric"><div class="label">Площадь</div><div class="value">${esc(formatNumber(item.area))} <small>м²</small></div></div><div class="metric"><div class="label">Этаж</div><div class="value">${esc(item.floor)}<small>/${esc(item.floors)}</small></div></div></div></section></main></body></html>`;
}

async function fitPromotionBadge(page) {
  await page.evaluate(() => {
    const badge = document.querySelector('.promo');
    if (!badge) return;
    const label = badge.querySelector('span');
    const house = document.querySelector('.house');
    const availableWidth = house
      ? Math.max(140, 470 - house.offsetWidth - 12)
      : 470;
    badge.style.maxWidth = `${availableWidth}px`;
    let valueSize = 34;
    let labelSize = 34;
    const applySizes = () => {
      badge.style.fontSize = `${valueSize}px`;
      if (label) label.style.fontSize = `${labelSize}px`;
    };
    applySizes();
    while (badge.scrollWidth > badge.clientWidth + 1 && valueSize > 18) {
      valueSize -= 1;
      labelSize = valueSize;
      applySizes();
    }
  });
}

(async () => {
  const requestedConcurrency = Number(process.env.RENDER_CONCURRENCY || 4);
  const concurrency = Math.max(1, Math.min(6, Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : 4));
  let nextIndex = 0;
  let browser;

  async function renderItem(page, item) {
    await ensurePlanFile(item);
    await page.setContent(htmlFor(item, false), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const previewSource = await page.screenshot({ type: 'png' });
    const webp = await createWebpVariants(page, previewSource);
    fs.writeFileSync(path.join(previewDir, `${item.id}.webp`), webp.preview);
    fs.writeFileSync(path.join(thumbnailDir, `${item.id}.webp`), webp.thumbnail);
    if (item.promotion) {
      await page.setContent(htmlFor(item, true), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await fitPromotionBadge(page);
    }
    await page.screenshot({ path: path.join(outputDir, `${item.id}.png`), type: 'png' });
  }

  async function renderWorker() {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    try {
      while (nextIndex < itemsToRender.length) {
        const item = itemsToRender[nextIndex++];
        await renderItem(page, item);
      }
    } finally {
      await page.close();
    }
  }

  if (itemsToRender.length) {
    const launchOptions = { headless: true };
    if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
    else if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    browser = await chromium.launch(launchOptions);
    await Promise.all(Array.from(
      { length: Math.min(concurrency, itemsToRender.length) },
      () => renderWorker()
    ));
    await browser.close();
  }
  if (renderCacheProject) {
    fs.rmSync(renderCacheProject, { recursive: true, force: true });
    for (const [folder, source] of [['images', outputDir], ['previews', previewDir], ['thumbnails', thumbnailDir]]) {
      fs.cpSync(source, path.join(renderCacheProject, folder), { recursive: true });
    }
  }
  console.log(JSON.stringify({
    project: projectSlug,
    total_ads: manifest.items.length,
    rendered_ads: itemsToRender.length,
    reused_ads: manifest.items.length - itemsToRender.length,
    requested_ids: renderEveryItem ? 'all' : (changedOnly ? 'changed' : renderIdSet.size),
    changed_source_ids: changedSourceIds.size,
    final_images: manifest.items.length,
    preview_images: manifest.items.length,
    thumbnail_images: manifest.items.length,
    concurrency
  }));
})();
