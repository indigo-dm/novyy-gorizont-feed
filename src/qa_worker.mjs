import worker from '../upload-worker/src/index.js';

const password = 'qa-password';
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
const passwordHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

class FakeR2 {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, { key, bytes, uploaded: new Date(), options });
  }
  object(record, includeBody = true) {
    if (!record) return null;
    const response = new Response(record.bytes);
    return {
      key: record.key,
      body: includeBody ? response.body : undefined,
      uploaded: record.uploaded,
      httpEtag: `"qa-${record.bytes.length}"`,
      writeHttpMetadata(headers) {
        if (record.options.httpMetadata?.contentType) headers.set('Content-Type', record.options.httpMetadata.contentType);
        if (record.options.httpMetadata?.cacheControl) headers.set('Cache-Control', record.options.httpMetadata.cacheControl);
      },
      async text() { return new TextDecoder().decode(record.bytes); },
      async json() { return JSON.parse(new TextDecoder().decode(record.bytes)); }
    };
  }
  async get(key) { return this.object(this.objects.get(key), true); }
  async head(key) { return this.object(this.objects.get(key), false); }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
  async list({ prefix = '' } = {}) {
    return {
      objects: Array.from(this.objects.values()).filter((item) => item.key.startsWith(prefix)).map((item) => ({ key: item.key, uploaded: item.uploaded })),
      truncated: false
    };
  }
  seed(key, value, uploaded) {
    const bytes = new TextEncoder().encode(value);
    this.objects.set(key, { key, bytes, uploaded: new Date(uploaded), options: {} });
  }
}

const feedStorage = new FakeR2();
await feedStorage.put('published/projects/novyy-gorizont/avito.xml', '<?xml version="1.0" encoding="UTF-8"?><Ads />', {
  httpMetadata: { contentType: 'application/xml; charset=utf-8' }
});
feedStorage.seed('uploads/novyy-gorizont/9301142/add-test.jpg', 'delete-me', '2026-09-01T00:00:00Z');
feedStorage.seed('uploads/novyy-gorizont/9301142/add-orphan.jpg', 'orphan', '2026-09-01T00:00:00Z');
const env = {
  PUBLIC_ACCESS_PASSWORD_HASH: passwordHash,
  ALLOWED_ORIGIN: 'https://indigo-dm.github.io',
  ALLOWED_PROJECTS: 'novyy-gorizont',
  GITHUB_REPOSITORY: 'indigo-dm/novyy-gorizont-feed',
  GITHUB_FRONTEND_REPOSITORY: 'indigo-dm/feed-studio',
  GITHUB_DATA_BRANCH: 'feed-data',
  GITHUB_TOKEN: 'qa-token',
  PUBLIC_BASE_URL: 'https://worker.example',
  ORPHAN_RETENTION_DAYS: '7',
  FEED_STORAGE: feedStorage
};

let issueState = 'open';
let createdBody = '';
let materialUploadCreated = false;
let frontendDeployDispatched = false;
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.endsWith('/issues') && options.method === 'POST') {
    createdBody = JSON.parse(options.body).body;
    return Response.json({ number: 17, created_at: '2026-09-26T10:00:00Z' }, { status: 201 });
  }
  if (value.includes('/contents/projects/novyy-gorizont/assets/uploads/') && options.method === 'PUT') {
    materialUploadCreated = true;
    return Response.json({ content: { sha: 'qa-material-sha' } }, { status: 201 });
  }
  if (value.includes('/contents/projects/novyy-gorizont/assets/uploads?ref=main')) {
    return Response.json([{ type: 'file', name: 'mat-qa-demo-render.png', size: 64 }]);
  }
  if (value.endsWith('/repos/indigo-dm/feed-studio/dispatches') && options.method === 'POST') {
    frontendDeployDispatched = JSON.parse(options.body).event_type === 'feed-data-updated';
    return new Response(null, { status: 204 });
  }
  if (value.endsWith('/issues/17')) {
    return Response.json({ number: 17, state: issueState, title: '[feed-settings] novyy-gorizont: обновить настройки фида', closed_at: issueState === 'closed' ? '2026-09-26T10:30:00Z' : null });
  }
  if (value.includes('/issues/17/comments')) return Response.json([]);
  throw new Error(`Unexpected GitHub request: ${value}`);
};

const headers = { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' };
const settingsResponse = await worker.fetch(new Request('https://worker.example/settings', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    version: 3,
    project: 'novyy-gorizont',
    rules: [],
    excluded_lot_ids: ['9301142'],
    image_settings: { lot_overrides: {}, bulk_rules: [] },
    parameter_settings: { lot_values: {}, bulk_rules: [] },
    material_settings: {
      logo: 'logo-gold.svg',
      key_render: 'selected-render.jpg',
      primary_color: '#123ABC',
      palette: [{ name: 'Основной', value: '#123ABC' }, { name: 'Акцент', value: '#CEAD75' }]
    },
    pending_upload_deletions: [{ lot: '9301142', id: 'add-test', path: 'uploads/novyy-gorizont/9301142/add-test.jpg' }]
  })
}), env);
const accepted = await settingsResponse.json();

const imageBody = new FormData();
imageBody.append('project', 'novyy-gorizont');
imageBody.append('lot', '9301142');
imageBody.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], 'photo.jpg', { type: 'image/jpeg' }));
const imageUploadResponse = await worker.fetch(new Request('https://worker.example/upload', {
  method: 'POST',
  headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` },
  body: imageBody
}), env);
const imageUpload = await imageUploadResponse.json();
const mediaResponse = await worker.fetch(new Request(imageUpload.url), env);

const materialBody = new FormData();
materialBody.append('project', 'novyy-gorizont');
materialBody.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'Новый рендер.png', { type: 'image/png' }));
const materialUploadResponse = await worker.fetch(new Request('https://worker.example/materials/upload', {
  method: 'POST',
  headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` },
  body: materialBody
}), env);
const materialUpload = await materialUploadResponse.json();
const materialListResponse = await worker.fetch(new Request('https://worker.example/materials?project=novyy-gorizont', { headers }), env);
const materialList = await materialListResponse.json();

const buildingResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const building = await buildingResponse.json();
issueState = 'closed';
const publishedResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const published = await publishedResponse.json();
const dataResponse = await worker.fetch(new Request('https://worker.example/data/projects/novyy-gorizont/avito.xml'), env);
const dataXml = await dataResponse.text();
const headResponse = await worker.fetch(new Request('https://worker.example/data/projects/novyy-gorizont/avito.xml', { method: 'HEAD' }), env);

let cleanupPromise;
await worker.scheduled({}, env, { waitUntil(promise) { cleanupPromise = promise; } });
await cleanupPromise;

const result = {
  ok: settingsResponse.status === 202 && accepted.request === 17 && createdBody.includes('pending_upload_deletions') && createdBody.includes('material_settings') && createdBody.includes('"primary_color": "#123ABC"') && createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"') &&
    materialUploadResponse.status === 201 && materialUploadCreated && /^uploads\//.test(materialUpload.filename) && materialListResponse.status === 200 && materialList.items.length === 1 &&
    imageUploadResponse.status === 201 && imageUpload.storage === 'r2' && imageUpload.url.startsWith('https://worker.example/media/uploads/') && mediaResponse.status === 200 &&
    building.status === 'building' && published.status === 'published' && frontendDeployDispatched &&
    dataResponse.status === 200 && dataXml.includes('<Ads />') && headResponse.status === 200 &&
    !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-test.jpg') &&
    !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-orphan.jpg'),
  settings_status: settingsResponse.status,
  building_status: building.status,
  published_status: published.status,
  frontend_deploy_dispatched: frontendDeployDispatched,
  deletion_forwarded: createdBody.includes('uploads/novyy-gorizont/9301142/add-test.jpg'),
  excluded_lot_forwarded: createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"'),
  material_settings_forwarded: createdBody.includes('material_settings') && createdBody.includes('"primary_color": "#123ABC"'),
  material_upload_status: materialUploadResponse.status,
  material_list_status: materialListResponse.status,
  image_upload_status: imageUploadResponse.status,
  image_storage: imageUpload.storage,
  media_status: mediaResponse.status,
  public_data_status: dataResponse.status,
  public_data_head_status: headResponse.status,
  orphan_cleanup: !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-orphan.jpg')
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
