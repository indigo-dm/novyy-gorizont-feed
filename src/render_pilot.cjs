const fs = require('fs');
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('C:/Users/vdovi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const { chromium } = playwright;

const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
const projectSlug = process.env.PROJECT_SLUG || registry.default_project;
const projectDir = path.join(root, 'projects', projectSlug);
const workDir = path.join(root, 'work', projectSlug);
const manifest = JSON.parse(fs.readFileSync(path.join(workDir, 'output', 'full-manifest.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf8'));
const outputDir = path.join(workDir, 'output', 'images');
const previewDir = path.join(workDir, 'output', 'previews');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.rmSync(previewDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

const mimeByExt = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/truetype' };
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
const roomTitle = (rooms) => `${rooms}-комнатная квартира`;

const fontUrl = dataUrl(path.join(root, 'assets', 'Manrope-Variable.ttf'));
const logoPath = path.join(projectDir, 'assets', config.brand.logo);
const renderPath = path.join(projectDir, 'assets', config.brand.key_render);
const logoUrl = fs.existsSync(logoPath) ? dataUrl(logoPath) : '';
const renderUrl = fs.existsSync(renderPath) ? dataUrl(renderPath) : '';

function htmlFor(item, includePromotion = true) {
  const planUrl = dataUrl(path.join(workDir, item.plan_file));
  const logo = logoUrl
    ? `<img class="logo" src="${logoUrl}">`
    : `<div class="logo logo-fallback">${esc(config.project.replace(/^ЖК\s+/i, ''))}<small>жилой комплекс</small></div>`;
  const keyRender = renderUrl
    ? `<img src="${renderUrl}">`
    : `<div class="render-fallback"><span>Жилой комплекс</span><strong>${esc(config.project.replace(/^ЖК\s+/i, ''))}</strong></div>`;
  const promo = includePromotion && item.promotion
    ? `<div class="promo"><span>${esc(item.promotion.label)}</span>${esc(item.promotion.text)}</div>`
    : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  @font-face{font-family:Manrope;src:url('${fontUrl}') format('truetype');font-weight:200 800;font-style:normal}
  :root{--g:${config.brand.green};--gd:${config.brand.green_dark};--gold:${config.brand.gold};--w:#fff;--ink:#063b39;--muted:#6b7775}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;height:900px;overflow:hidden;font-family:Manrope,Arial,sans-serif;background:var(--g)}
  .canvas{position:relative;width:1200px;height:900px;color:var(--w);background:radial-gradient(circle at 4% 100%,rgba(206,173,117,.18),transparent 27%),linear-gradient(145deg,var(--g),var(--gd))}
  .left{position:absolute;left:56px;top:54px;width:470px;height:792px}.logo{width:350px;height:111px;object-fit:contain;object-position:left top}.logo-fallback{display:flex;flex-direction:column;justify-content:center;color:var(--gold);font-size:35px;line-height:1;font-weight:800;letter-spacing:.035em;text-transform:uppercase}.logo-fallback small{margin-top:11px;color:rgba(255,255,255,.76);font-size:14px;font-weight:700;letter-spacing:.26em}
  .house{position:absolute;top:126px;left:0;height:42px;display:flex;align-items:center;padding:0 18px;border:1px solid rgba(255,255,255,.52);border-radius:100px;font-size:19px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
  .promo{position:absolute;top:126px;right:0;height:42px;display:flex;align-items:center;padding:0 17px;border-radius:100px;background:var(--gold);color:var(--ink);font-size:18px;font-weight:800;white-space:nowrap}.promo span{margin-right:8px;font-size:14px;letter-spacing:.08em;text-transform:uppercase}
  .render{position:absolute;top:181px;width:470px;height:405px;padding:8px;border:2px solid var(--gold);background:rgba(255,255,255,.1)}.render img{width:100%;height:100%;display:block;object-fit:cover;object-position:center}.render-fallback{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:44px;text-align:center;background:radial-gradient(circle at 50% 35%,rgba(206,173,117,.28),transparent 34%),linear-gradient(145deg,rgba(255,255,255,.08),rgba(0,0,0,.08))}.render-fallback:before{content:'◆';margin-bottom:28px;color:var(--gold);font-size:54px}.render-fallback span{margin-bottom:13px;color:rgba(255,255,255,.7);font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}.render-fallback strong{font-size:34px;line-height:1.12;text-transform:uppercase}
  .lot{position:absolute;top:616px;width:470px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:.035em;text-transform:uppercase}.finish{position:absolute;top:660px;font-size:18px;color:rgba(255,255,255,.78)}
  .price{position:absolute;left:0;bottom:0;width:405px;height:92px;display:flex;align-items:center;justify-content:center;background:var(--gold);color:var(--ink);font-size:36px;font-weight:800;letter-spacing:-.02em}
  .card{position:absolute;top:54px;right:56px;width:560px;height:792px;background:#fff;color:var(--ink);box-shadow:0 20px 55px rgba(0,33,31,.2)}
  .plan{position:absolute;top:24px;left:30px;width:500px;height:606px;display:flex;align-items:center;justify-content:center;overflow:hidden}.plan img{max-width:100%;max-height:100%;object-fit:contain;display:block}
  .rule{position:absolute;left:30px;right:30px;top:644px;height:1px;background:#dfe5e3}.metrics{position:absolute;left:28px;right:28px;bottom:26px;height:106px;display:grid;grid-template-columns:.85fr 1.35fr 1fr;align-items:center}
  .metric{text-align:center;min-width:0}.metric+.metric{border-left:1px solid #dfe5e3}.label{margin-bottom:6px;font-size:16px;line-height:1;font-weight:600;color:var(--muted);letter-spacing:.035em;text-transform:uppercase;white-space:nowrap}.value{font-size:43px;line-height:1;font-weight:800;color:var(--g);white-space:nowrap}.value small{font-size:23px;font-weight:700}
  </style></head><body><main class="canvas"><section class="left">${logo}<div class="house">${esc(item.house)}</div>${promo}<div class="render">${keyRender}</div><div class="lot">${esc(roomTitle(item.rooms))}</div><div class="finish">${esc(item.decoration)}</div><div class="price">${esc(formatPrice(item.price))}</div></section><section class="card"><div class="plan"><img src="${planUrl}"></div><div class="rule"></div><div class="metrics"><div class="metric"><div class="label">Комнат</div><div class="value">${esc(item.rooms)}</div></div><div class="metric"><div class="label">Площадь</div><div class="value">${esc(formatNumber(item.area))} <small>м²</small></div></div><div class="metric"><div class="label">Этаж</div><div class="value">${esc(item.floor)}<small>/${esc(item.floors)}</small></div></div></div></section></main></body></html>`;
}

(async () => {
  const launchOptions = { headless: true };
  if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
  else if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  for (const item of manifest.items) {
    await page.setContent(htmlFor(item, false), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(previewDir, `${item.id}.jpg`), type: 'jpeg', quality: 82 });
    if (item.promotion) {
      await page.setContent(htmlFor(item, true), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
    }
    await page.screenshot({ path: path.join(outputDir, `${item.id}.png`), type: 'png' });
  }
  await browser.close();
  console.log(JSON.stringify({ rendered_ads: manifest.items.length, final_images: manifest.items.length, preview_images: manifest.items.length }));
})();
