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
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'output', 'pilot-manifest.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const outputDir = path.join(root, 'output', 'images');
fs.mkdirSync(outputDir, { recursive: true });

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
const logoUrl = dataUrl(path.join(root, 'assets', 'logo-gold.svg'));
const renderUrl = dataUrl(path.join(root, 'assets', 'selected-render.jpg'));

function htmlFor(item) {
  const planUrl = dataUrl(path.join(root, item.plan_file));
  const promo = item.promotion
    ? `<div class="promo"><span>${esc(item.promotion.label)}</span>${esc(item.promotion.text)}</div>`
    : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  @font-face{font-family:Manrope;src:url('${fontUrl}') format('truetype');font-weight:200 800;font-style:normal}
  :root{--g:${config.brand.green};--gd:${config.brand.green_dark};--gold:${config.brand.gold};--w:#fff;--ink:#063b39;--muted:#6b7775}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;height:900px;overflow:hidden;font-family:Manrope,Arial,sans-serif;background:var(--g)}
  .canvas{position:relative;width:1200px;height:900px;color:var(--w);background:radial-gradient(circle at 4% 100%,rgba(206,173,117,.18),transparent 27%),linear-gradient(145deg,var(--g),var(--gd))}
  .left{position:absolute;left:56px;top:54px;width:470px;height:792px}.logo{width:350px;height:111px;object-fit:contain;object-position:left top}
  .house{position:absolute;top:116px;left:0;height:42px;display:flex;align-items:center;padding:0 18px;border:1px solid rgba(255,255,255,.52);border-radius:100px;font-size:19px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
  .promo{position:absolute;top:116px;right:0;height:42px;display:flex;align-items:center;padding:0 17px;border-radius:100px;background:var(--gold);color:var(--ink);font-size:18px;font-weight:800;white-space:nowrap}.promo span{margin-right:8px;font-size:14px;letter-spacing:.08em;text-transform:uppercase}
  .render{position:absolute;top:181px;width:470px;height:405px;padding:8px;border:2px solid var(--gold);background:rgba(255,255,255,.1)}.render img{width:100%;height:100%;display:block;object-fit:cover;object-position:center}
  .lot{position:absolute;top:616px;width:470px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:.035em;text-transform:uppercase}.finish{position:absolute;top:660px;font-size:18px;color:rgba(255,255,255,.78)}
  .price{position:absolute;left:0;bottom:0;width:405px;height:92px;display:flex;align-items:center;justify-content:center;background:var(--gold);color:var(--ink);font-size:36px;font-weight:800;letter-spacing:-.02em}
  .card{position:absolute;top:54px;right:56px;width:560px;height:792px;background:#fff;color:var(--ink);box-shadow:0 20px 55px rgba(0,33,31,.2)}
  .plan{position:absolute;top:24px;left:30px;width:500px;height:606px;display:flex;align-items:center;justify-content:center;overflow:hidden}.plan img{max-width:100%;max-height:100%;object-fit:contain;display:block}
  .rule{position:absolute;left:30px;right:30px;top:644px;height:1px;background:#dfe5e3}.metrics{position:absolute;left:28px;right:28px;bottom:26px;height:106px;display:grid;grid-template-columns:.85fr 1.35fr 1fr;align-items:center}
  .metric{text-align:center;min-width:0}.metric+.metric{border-left:1px solid #dfe5e3}.label{margin-bottom:6px;font-size:16px;line-height:1;font-weight:600;color:var(--muted);letter-spacing:.035em;text-transform:uppercase;white-space:nowrap}.value{font-size:43px;line-height:1;font-weight:800;color:var(--g);white-space:nowrap}.value small{font-size:23px;font-weight:700}
  </style></head><body><main class="canvas"><section class="left"><img class="logo" src="${logoUrl}"><div class="house">${esc(item.house)}</div>${promo}<div class="render"><img src="${renderUrl}"></div><div class="lot">${esc(roomTitle(item.rooms))}</div><div class="finish">${esc(item.decoration)}</div><div class="price">${esc(formatPrice(item.price))}</div></section><section class="card"><div class="plan"><img src="${planUrl}"></div><div class="rule"></div><div class="metrics"><div class="metric"><div class="label">Комнат</div><div class="value">${esc(item.rooms)}</div></div><div class="metric"><div class="label">Площадь</div><div class="value">${esc(formatNumber(item.area))} <small>м²</small></div></div><div class="metric"><div class="label">Этаж</div><div class="value">${esc(item.floor)}<small>/${esc(item.floors)}</small></div></div></div></section></main></body></html>`;
}

(async () => {
  const launchOptions = { headless: true };
  if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
  else if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  for (const item of manifest.items) {
    await page.setContent(htmlFor(item), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outputDir, `${item.id}.png`), type: 'png' });
    console.log(`${item.id}\t${item.house}\t${item.rooms}к\t${item.area} м²`);
  }
  await browser.close();
})();
