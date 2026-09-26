import worker from '../upload-worker/src/index.js';

const password = 'qa-password';
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
const passwordHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
const env = {
  PUBLIC_ACCESS_PASSWORD_HASH: passwordHash,
  ALLOWED_ORIGIN: 'https://indigo-dm.github.io',
  ALLOWED_PROJECTS: 'novyy-gorizont',
  GITHUB_REPOSITORY: 'indigo-dm/novyy-gorizont-feed',
  GITHUB_FRONTEND_REPOSITORY: 'indigo-dm/feed-studio',
  GITHUB_DATA_BRANCH: 'feed-data',
  GITHUB_TOKEN: 'qa-token'
};

let issueState = 'open';
let createdBody = '';
let materialUploadCreated = false;
let frontendDeployDispatched = false;
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.includes('/contents/published/projects/novyy-gorizont/avito.xml?ref=feed-data')) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Ads />', {
      status: 200,
      headers: { ETag: '"qa-etag"' }
    });
  }
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
    material_settings: { logo: 'logo-gold.svg', key_render: 'selected-render.jpg' },
    pending_upload_deletions: [{ lot: '9301142', id: 'add-test', path: 'uploads/novyy-gorizont/9301142/add-test.jpg' }]
  })
}), env);
const accepted = await settingsResponse.json();

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

const result = {
  ok: settingsResponse.status === 202 && accepted.request === 17 && createdBody.includes('pending_upload_deletions') && createdBody.includes('material_settings') && createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"') &&
    materialUploadResponse.status === 201 && materialUploadCreated && /^uploads\//.test(materialUpload.filename) && materialListResponse.status === 200 && materialList.items.length === 1 &&
    building.status === 'building' && published.status === 'published' && frontendDeployDispatched &&
    dataResponse.status === 200 && dataXml.includes('<Ads />') && headResponse.status === 200,
  settings_status: settingsResponse.status,
  building_status: building.status,
  published_status: published.status,
  frontend_deploy_dispatched: frontendDeployDispatched,
  deletion_forwarded: createdBody.includes('uploads/novyy-gorizont/9301142/add-test.jpg'),
  excluded_lot_forwarded: createdBody.includes('"excluded_lot_ids"') && createdBody.includes('"9301142"'),
  material_settings_forwarded: createdBody.includes('material_settings'),
  material_upload_status: materialUploadResponse.status,
  material_list_status: materialListResponse.status,
  public_data_status: dataResponse.status,
  public_data_head_status: headResponse.status
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
