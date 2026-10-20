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
      async arrayBuffer() { return record.bytes.slice().buffer; },
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
      objects: Array.from(this.objects.values()).filter((item) => item.key.startsWith(prefix)).map((item) => ({
        key: item.key,
        uploaded: item.uploaded,
        size: item.bytes.length,
        customMetadata: item.options.customMetadata || {}
      })),
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
await feedStorage.put('published/projects/novyy-gorizont/settings.json', JSON.stringify({
  image_settings: {
    lot_overrides: {},
    bulk_rules: [{ action: 'add', images: [{ path: 'uploads/novyy-gorizont/bulk/bulk-qa-referenced.jpg' }] }]
  },
  material_settings: {
    logo: 'logo-gold.svg',
    key_render: 'selected-render.jpg',
    background_render: 'uploads/mat-qa-active.png'
  }
}), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
await feedStorage.put('media/projects/novyy-gorizont/images/qa-generated.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
  httpMetadata: { contentType: 'image/png' }
});
feedStorage.seed('uploads/novyy-gorizont/9301142/add-test.jpg', 'delete-me', '2026-09-01T00:00:00Z');
feedStorage.seed('uploads/novyy-gorizont/9301142/add-orphan.jpg', 'orphan', '2026-09-01T00:00:00Z');
feedStorage.seed('uploads/novyy-gorizont/bulk/bulk-qa-referenced.jpg', 'keep-me', '2026-09-01T00:00:00Z');
feedStorage.seed('uploads/novyy-gorizont/9301142/add-migrate-a.jpg', 'same-image', '2026-10-19T00:00:00Z');
feedStorage.seed('uploads/novyy-gorizont/9301143/add-migrate-b.jpg', 'same-image', '2026-10-19T00:00:00Z');
feedStorage.seed('operations/999.json', '{}', '2026-09-01T00:00:00Z');
feedStorage.seed('refresh-operations/refresh-stale-marker.json', '{}', '2026-09-01T00:00:00Z');
const env = {
  PUBLIC_ACCESS_PASSWORD_HASH: passwordHash,
  ALLOWED_ORIGIN: 'https://indigo-dm.github.io',
  ALLOWED_PROJECTS: 'novyy-gorizont',
  GITHUB_REPOSITORY: 'indigo-dm/novyy-gorizont-feed',
  GITHUB_FRONTEND_REPOSITORY: 'indigo-dm/feed-studio',
  GITHUB_DATA_BRANCH: 'feed-data',
  GITHUB_TOKEN: 'qa-token',
  PUBLIC_BASE_URL: 'https://worker.example',
  FRONTEND_FEED_ROOT: 'https://frontend.example/feeds',
  ORPHAN_RETENTION_DAYS: '7',
  FEED_STORAGE: feedStorage
};

let issueState = 'open';
let createdBody = '';
let materialUploadCreated = false;
let materialUploadAttempts = 0;
let materialDeleteRequests = 0;
let projectConfigUpdates = 0;
const materialFiles = new Map([
  ['mat-qa-demo-render.png', { type: 'file', name: 'mat-qa-demo-render.png', size: 64, sha: '1111111111111111111111111111111111111111' }],
  ['mat-qa-active.png', { type: 'file', name: 'mat-qa-active.png', size: 64, sha: '2222222222222222222222222222222222222222' }]
]);
const rootMaterialFiles = new Map([
  ['logo-gold.svg', { type: 'file', name: 'logo-gold.svg', size: 64, sha: '3333333333333333333333333333333333333333' }],
  ['selected-render.jpg', { type: 'file', name: 'selected-render.jpg', size: 64, sha: '4444444444444444444444444444444444444444' }],
  ['unused-render.jpg', { type: 'file', name: 'unused-render.jpg', size: 64, sha: '5555555555555555555555555555555555555555' }]
]);
let projectConfigSha = '6666666666666666666666666666666666666666';
let projectConfig = {
  project: 'ЖК Новый Горизонт',
  brand: {
    green: '#00605C', background_color: '#00605C', text_color: '#FFFFFF', subtitle_color: '#9B9B9B', green_dark: '#004C49', gold: '#CEAD75', gray: '#9B9B9B', white: '#FFFFFF', font: 'Manrope',
    logo: 'logo-gold.svg', key_render: 'selected-render.jpg', background_render: '',
    additional_renders: [{ name: 'Неиспользуемый рендер', filename: 'unused-render.jpg' }],
    palette: [{ name: 'Основной', value: '#00605C' }, { name: 'Белый', value: '#FFFFFF' }, { name: 'Серый', value: '#9B9B9B' }]
  }
};
let frontendDeployDispatched = false;
let frontendFeedPublished = false;
let refreshDispatchInputs = null;
let refreshRequestId = '';
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.endsWith('/issues') && options.method === 'POST') {
    createdBody = JSON.parse(options.body).body;
    return Response.json({ number: 17, created_at: '2026-09-26T10:00:00Z' }, { status: 201 });
  }
  if (value.includes('/contents/projects/novyy-gorizont/assets/uploads/') && options.method === 'PUT') {
    materialUploadAttempts += 1;
    if (materialUploadAttempts === 1) return Response.json({ message: 'temporary failure' }, { status: 503 });
    materialUploadCreated = true;
    return Response.json({ content: { sha: 'qa-material-sha' } }, { status: 201 });
  }
  const materialFileMatch = value.match(/\/contents\/projects\/novyy-gorizont\/assets\/uploads\/([^?]+)(?:\?ref=main)?$/);
  if (materialFileMatch && (!options.method || options.method === 'GET')) {
    const entry = materialFiles.get(decodeURIComponent(materialFileMatch[1]));
    return entry ? Response.json(entry) : Response.json({ message: 'Not Found' }, { status: 404 });
  }
  if (materialFileMatch && options.method === 'DELETE') {
    const name = decodeURIComponent(materialFileMatch[1]);
    const payload = JSON.parse(options.body);
    const entry = materialFiles.get(name);
    if (!entry || payload.sha !== entry.sha) return Response.json({ message: 'Conflict' }, { status: 409 });
    materialFiles.delete(name);
    materialDeleteRequests += 1;
    return Response.json({ commit: { sha: 'qa-delete-commit' } }, { status: 200 });
  }
  if (value.includes('/contents/projects/novyy-gorizont/assets/uploads?ref=main')) {
    return Response.json(Array.from(materialFiles.values()));
  }
  const rootMaterialMatch = value.match(/\/contents\/projects\/novyy-gorizont\/assets\/([^/?]+)(?:\?ref=main)?$/);
  if (rootMaterialMatch && (!options.method || options.method === 'GET')) {
    const entry = rootMaterialFiles.get(decodeURIComponent(rootMaterialMatch[1]));
    return entry ? Response.json(entry) : Response.json({ message: 'Not Found' }, { status: 404 });
  }
  if (rootMaterialMatch && options.method === 'DELETE') {
    const name = decodeURIComponent(rootMaterialMatch[1]);
    const payload = JSON.parse(options.body);
    const entry = rootMaterialFiles.get(name);
    if (!entry || payload.sha !== entry.sha) return Response.json({ message: 'Conflict' }, { status: 409 });
    rootMaterialFiles.delete(name);
    materialDeleteRequests += 1;
    return Response.json({ commit: { sha: 'qa-root-delete-commit' } }, { status: 200 });
  }
  if (value.includes('/contents/projects/novyy-gorizont/config.json?ref=main')) {
    const accept = String(options.headers && (options.headers.Accept || options.headers.accept) || '');
    if (accept.includes('raw')) return Response.json(projectConfig);
    return Response.json({ sha: projectConfigSha, encoding: 'base64', content: Buffer.from(JSON.stringify(projectConfig), 'utf8').toString('base64') });
  }
  if (value.endsWith('/contents/projects/novyy-gorizont/config.json') && options.method === 'PUT') {
    const payload = JSON.parse(options.body);
    if (payload.sha !== projectConfigSha) return Response.json({ message: 'Conflict' }, { status: 409 });
    projectConfig = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));
    projectConfigSha = '7777777777777777777777777777777777777777';
    projectConfigUpdates += 1;
    return Response.json({ content: { sha: projectConfigSha } });
  }
  if (value.includes('/contents/projects/novyy-gorizont/promotion-rules.json?ref=main')) {
    return Response.json({ version: 2, rules: [], image_settings: { lot_overrides: {}, bulk_rules: [] }, parameter_settings: { lot_values: {}, bulk_rules: [] } });
  }
  if (value.includes('/contents/projects/novyy-gorizont/assets?ref=main')) {
    return Response.json(Array.from(rootMaterialFiles.values()));
  }
  if (value.endsWith('/repos/indigo-dm/feed-studio/dispatches') && options.method === 'POST') {
    frontendDeployDispatched = JSON.parse(options.body).event_type === 'feed-data-updated';
    frontendFeedPublished = frontendDeployDispatched;
    return new Response(null, { status: 204 });
  }
  if (value.endsWith('/repos/indigo-dm/novyy-gorizont-feed/dispatches') && options.method === 'POST') {
    const payload = JSON.parse(options.body);
    if (payload.event_type !== 'profitbase-refresh') return Response.json({ message: 'wrong event' }, { status: 422 });
    refreshDispatchInputs = payload.client_payload;
    refreshRequestId = refreshDispatchInputs.request_id;
    return new Response(null, { status: 204 });
  }
  if (value.startsWith('https://frontend.example/feeds/novyy-gorizont/avito.xml')) {
    return new Response(frontendFeedPublished ? '<?xml version="1.0" encoding="UTF-8"?><Ads />' : '<?xml version="1.0"?><Ads><Ad /></Ads>', {
      status: 200,
      headers: { 'Content-Type': 'application/xml' }
    });
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
    version: 4,
    project: 'novyy-gorizont',
    rules: [],
    excluded_lot_ids: ['9301142'],
    image_settings: { lot_overrides: {}, bulk_rules: [] },
    parameter_settings: { lot_values: {}, bulk_rules: [] },
    card_settings: { show_key_render: false, show_house_badge: false, show_decoration: true, show_logo_panel: false },
    material_settings: {
      logo: 'logo-gold.svg',
      key_render: 'selected-render.jpg',
      background_render: 'selected-render.jpg',
      primary_color: '#123ABC',
      background_color: '#00605C',
      text_color: '#FFFFFF',
      subtitle_color: '#9B9B9B',
      palette: [{ name: 'Основной', value: '#123ABC' }, { name: 'Фон', value: '#00605C' }, { name: 'Белый', value: '#FFFFFF' }, { name: 'Серый', value: '#9B9B9B' }]
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
const bulkImageBody = new FormData();
bulkImageBody.append('project', 'novyy-gorizont');
bulkImageBody.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], 'shared.jpg', { type: 'image/jpeg' }));
const bulkImageUploadResponse = await worker.fetch(new Request('https://worker.example/bulk-upload', {
  method: 'POST',
  headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` },
  body: bulkImageBody
}), env);
const bulkImageUpload = await bulkImageUploadResponse.json();
const bulkMediaResponse = await worker.fetch(new Request(bulkImageUpload.url), env);
const libraryBody = new FormData();
libraryBody.append('project', 'novyy-gorizont');
libraryBody.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01])], 'library.jpg', { type: 'image/jpeg' }));
libraryBody.append('width', '1200');
libraryBody.append('height', '800');
libraryBody.append('perceptual_hash', '0123456789abcdef');
const libraryUploadResponse = await worker.fetch(new Request('https://worker.example/image-library/upload', {
  method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` }, body: libraryBody
}), env);
const libraryUpload = await libraryUploadResponse.json();
const duplicateBody = new FormData();
duplicateBody.append('project', 'novyy-gorizont');
duplicateBody.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01])], 'library-copy.jpg', { type: 'image/jpeg' }));
duplicateBody.append('width', '1200');
duplicateBody.append('height', '800');
duplicateBody.append('perceptual_hash', '0123456789abcdef');
const libraryDuplicateResponse = await worker.fetch(new Request('https://worker.example/image-library/upload', {
  method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` }, body: duplicateBody
}), env);
const libraryDuplicate = await libraryDuplicateResponse.json();
const similarBody = new FormData();
similarBody.append('project', 'novyy-gorizont');
similarBody.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x02])], 'library-similar.jpg', { type: 'image/jpeg' }));
similarBody.append('width', '1210');
similarBody.append('height', '805');
similarBody.append('perceptual_hash', '0123456789abcdee');
const librarySimilarResponse = await worker.fetch(new Request('https://worker.example/image-library/upload', {
  method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Authorization: `Bearer ${password}` }, body: similarBody
}), env);
const librarySimilar = await librarySimilarResponse.json();
const libraryListResponse = await worker.fetch(new Request('https://worker.example/image-library?project=novyy-gorizont', { headers }), env);
const libraryList = await libraryListResponse.json();
const libraryMigrationResponse = await worker.fetch(new Request('https://worker.example/image-library/migrate', {
  method: 'POST', headers, body: JSON.stringify({ project: 'novyy-gorizont', publish: false })
}), env);
const libraryMigration = await libraryMigrationResponse.json();
const generatedMediaResponse = await worker.fetch(new Request('https://worker.example/media/projects/novyy-gorizont/images/qa-generated.png'), env);

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
const materialDeleteResponse = await worker.fetch(new Request('https://worker.example/materials', {
  method: 'DELETE',
  headers,
  body: JSON.stringify({ project: 'novyy-gorizont', filename: 'uploads/mat-qa-demo-render.png' })
}), env);
const materialDeleted = await materialDeleteResponse.json();
const activeMaterialDeleteResponse = await worker.fetch(new Request('https://worker.example/materials', {
  method: 'DELETE',
  headers,
  body: JSON.stringify({ project: 'novyy-gorizont', filename: 'uploads/mat-qa-active.png' })
}), env);
const rootMaterialDeleteResponse = await worker.fetch(new Request('https://worker.example/materials', {
  method: 'DELETE',
  headers,
  body: JSON.stringify({ project: 'novyy-gorizont', filename: 'unused-render.jpg' })
}), env);
const rootMaterialDeleted = await rootMaterialDeleteResponse.json();
const materialListAfterDeleteResponse = await worker.fetch(new Request('https://worker.example/materials?project=novyy-gorizont', { headers }), env);
const materialListAfterDelete = await materialListAfterDeleteResponse.json();

const setupResponse = await worker.fetch(new Request('https://worker.example/project/setup?project=novyy-gorizont', { headers }), env);
const setup = await setupResponse.json();

const sourceEmptyResponse = await worker.fetch(new Request('https://worker.example/source-feed?project=novyy-gorizont', { headers }), env);
const sourceEmpty = await sourceEmptyResponse.json();
const sourceSaveResponse = await worker.fetch(new Request('https://worker.example/source-feed', {
  method: 'POST',
  headers,
  body: JSON.stringify({ project: 'novyy-gorizont', url: 'https://profitbase.example/private-feed?token=qa-secret' })
}), env);
const sourceSaved = await sourceSaveResponse.json();
const sourceStatusResponse = await worker.fetch(new Request('https://worker.example/source-feed?project=novyy-gorizont', { headers }), env);
const sourceStatus = await sourceStatusResponse.json();

const buildingResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const building = await buildingResponse.json();
issueState = 'closed';
const publishedResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const published = await publishedResponse.json();
const settingsFrontendDeployDispatched = frontendDeployDispatched;
const dataResponse = await worker.fetch(new Request('https://worker.example/data/projects/novyy-gorizont/avito.xml'), env);
const dataXml = await dataResponse.text();
const headResponse = await worker.fetch(new Request('https://worker.example/data/projects/novyy-gorizont/avito.xml', { method: 'HEAD' }), env);

frontendDeployDispatched = false;
frontendFeedPublished = false;
const refreshResponse = await worker.fetch(new Request('https://worker.example/refresh', {
  method: 'POST',
  headers,
  body: JSON.stringify({ project: 'novyy-gorizont' })
}), env);
const refreshAccepted = await refreshResponse.json();
await feedStorage.put('published/projects/novyy-gorizont/status.json', JSON.stringify({
  checked_at: new Date(Date.now() + 1000).toISOString(),
  source_ads: 1
}));
const refreshDeployingResponse = await worker.fetch(new Request(`https://worker.example/refresh/status?request=${encodeURIComponent(refreshAccepted.request)}`, { headers }), env);
const refreshDeploying = await refreshDeployingResponse.json();
const refreshPublishedResponse = await worker.fetch(new Request(`https://worker.example/refresh/status?request=${encodeURIComponent(refreshAccepted.request)}`, { headers }), env);
const refreshPublished = await refreshPublishedResponse.json();

let cleanupPromise;
await worker.scheduled({}, env, { waitUntil(promise) { cleanupPromise = promise; } });
await cleanupPromise;

const result = {
  ok: settingsResponse.status === 202 && accepted.request === 17 && createdBody.includes('pending_upload_deletions') && createdBody.includes('material_settings') && createdBody.includes('"primary_color": "#123ABC"') && createdBody.includes('"background_render": "selected-render.jpg"') && createdBody.includes('"card_settings"') && createdBody.includes('"show_key_render": false') && createdBody.includes('"show_house_badge": false') && createdBody.includes('"show_logo_panel": false') && createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"') &&
    materialUploadResponse.status === 201 && materialUploadCreated && materialUploadAttempts === 2 && /^uploads\//.test(materialUpload.filename) && materialListResponse.status === 200 && materialList.items.length === 5 &&
    materialDeleteResponse.status === 200 && materialDeleted.deleted === true && activeMaterialDeleteResponse.status === 409 && rootMaterialDeleteResponse.status === 200 && rootMaterialDeleted.deleted === true && materialDeleteRequests === 2 && projectConfigUpdates === 1 && !projectConfig.brand.additional_renders.some((item) => item.filename === 'unused-render.jpg') && materialListAfterDelete.items.length === 3 &&
    setupResponse.status === 200 && setup.assets.items.length === 2 && setup.assets.brand.green === '#00605C' && setup.assets.brand.background_color === '#00605C' &&
    sourceEmptyResponse.status === 200 && sourceEmpty.configured === false && sourceSaveResponse.status === 200 && sourceSaved.hostname === 'profitbase.example' &&
    sourceStatusResponse.status === 200 && sourceStatus.configured === true && sourceStatus.hostname === 'profitbase.example' && !JSON.stringify(sourceStatus).includes('qa-secret') &&
    feedStorage.objects.has('private/source-feeds/novyy-gorizont.json') &&
    imageUploadResponse.status === 201 && imageUpload.storage === 'r2' && imageUpload.url.startsWith('https://worker.example/media/uploads/') && mediaResponse.status === 200 &&
    bulkImageUploadResponse.status === 201 && bulkImageUpload.storage === 'r2' && /^bulk-/.test(bulkImageUpload.id) && bulkImageUpload.path.startsWith('uploads/novyy-gorizont/bulk/') && bulkMediaResponse.status === 200 &&
    libraryUploadResponse.status === 201 && /^lib-/.test(libraryUpload.id) && libraryUpload.path.includes('/library/') &&
    libraryDuplicateResponse.status === 409 && libraryDuplicate.code === 'duplicate' && libraryDuplicate.match.id === libraryUpload.id &&
    librarySimilarResponse.status === 409 && librarySimilar.code === 'similar_confirmation_required' && librarySimilar.matches.length === 1 &&
    libraryListResponse.status === 200 && libraryList.items.length === 1 &&
    libraryMigrationResponse.status === 200 && libraryMigration.exact_duplicate_files >= 1 &&
    libraryMigration.mappings.filter((item) => item.old_path.includes('add-migrate-')).every((item, index, matches) => item.id === matches[0].id) &&
    generatedMediaResponse.status === 200 && generatedMediaResponse.headers.get('X-Feed-Storage') === 'r2' &&
    building.status === 'building' && published.status === 'published' && settingsFrontendDeployDispatched &&
    dataResponse.status === 200 && dataXml.includes('<Ads />') && headResponse.status === 200 &&
    refreshResponse.status === 202 && refreshDispatchInputs?.project === 'novyy-gorizont' && refreshDispatchInputs?.render_ids === 'changed' && refreshDispatchInputs?.request_id === refreshAccepted.request &&
    refreshDeploying.status === 'deploying' && refreshPublished.status === 'published' && frontendDeployDispatched &&
    !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-test.jpg') &&
    !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-orphan.jpg') &&
    feedStorage.objects.has('uploads/novyy-gorizont/bulk/bulk-qa-referenced.jpg') &&
    !feedStorage.objects.has('operations/999.json') &&
    !feedStorage.objects.has('refresh-operations/refresh-stale-marker.json'),
  settings_status: settingsResponse.status,
  building_status: building.status,
  published_status: published.status,
  frontend_deploy_dispatched: frontendDeployDispatched,
  deletion_forwarded: createdBody.includes('uploads/novyy-gorizont/9301142/add-test.jpg'),
  excluded_lot_forwarded: createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"'),
  material_settings_forwarded: createdBody.includes('material_settings') && createdBody.includes('"primary_color": "#123ABC"'),
  card_settings_forwarded: createdBody.includes('"card_settings"') && createdBody.includes('"show_house_badge": false'),
  material_upload_status: materialUploadResponse.status,
  material_list_status: materialListResponse.status,
  material_delete_statuses: [materialDeleteResponse.status, activeMaterialDeleteResponse.status, rootMaterialDeleteResponse.status],
  material_config_cleaned: projectConfigUpdates === 1 && !projectConfig.brand.additional_renders.some((item) => item.filename === 'unused-render.jpg'),
  material_list_after_delete: materialListAfterDelete.items.length,
  setup_status: setupResponse.status,
  source_feed_statuses: [sourceEmptyResponse.status, sourceSaveResponse.status, sourceStatusResponse.status],
  source_feed_masked: !JSON.stringify(sourceStatus).includes('qa-secret'),
  image_upload_status: imageUploadResponse.status,
  image_storage: imageUpload.storage,
  bulk_image_upload_status: bulkImageUploadResponse.status,
  bulk_image_storage: bulkImageUpload.storage,
  library_statuses: [libraryUploadResponse.status, libraryDuplicateResponse.status, librarySimilarResponse.status, libraryListResponse.status],
  library_duplicate_blocked: libraryDuplicate.code === 'duplicate',
  library_similar_needs_confirmation: librarySimilar.code === 'similar_confirmation_required',
  library_migration: { status: libraryMigrationResponse.status, scanned: libraryMigration.scanned, exact_duplicates: libraryMigration.exact_duplicate_files },
  bulk_image_reference_kept: feedStorage.objects.has('uploads/novyy-gorizont/bulk/bulk-qa-referenced.jpg'),
  media_status: mediaResponse.status,
  generated_media_status: generatedMediaResponse.status,
  generated_media_storage: generatedMediaResponse.headers.get('X-Feed-Storage'),
  public_data_status: dataResponse.status,
  public_data_head_status: headResponse.status,
  refresh_statuses: [refreshDeploying.status, refreshPublished.status],
  refresh_changed_only: refreshDispatchInputs?.render_ids === 'changed',
  orphan_cleanup: !feedStorage.objects.has('uploads/novyy-gorizont/9301142/add-orphan.jpg'),
  operation_cleanup: !feedStorage.objects.has('operations/999.json') && !feedStorage.objects.has('refresh-operations/refresh-stale-marker.json')
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
