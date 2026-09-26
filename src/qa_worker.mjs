import worker from '../upload-worker/src/index.js';

const password = 'qa-password';
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
const passwordHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
const env = {
  ACCESS_PASSWORD_HASH: passwordHash,
  ALLOWED_ORIGIN: 'https://indigo-dm.github.io',
  ALLOWED_PROJECTS: 'novyy-gorizont',
  GITHUB_REPOSITORY: 'indigo-dm/novyy-gorizont-feed',
  GITHUB_TOKEN: 'qa-token'
};

let issueState = 'open';
let createdBody = '';
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.endsWith('/issues') && options.method === 'POST') {
    createdBody = JSON.parse(options.body).body;
    return Response.json({ number: 17, created_at: '2026-09-26T10:00:00Z' }, { status: 201 });
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
    version: 2,
    project: 'novyy-gorizont',
    rules: [],
    image_settings: { lot_overrides: {}, bulk_rules: [] },
    parameter_settings: { lot_values: {}, bulk_rules: [] },
    pending_upload_deletions: [{ lot: '9301142', id: 'add-test', path: 'uploads/novyy-gorizont/9301142/add-test.jpg' }]
  })
}), env);
const accepted = await settingsResponse.json();

const buildingResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const building = await buildingResponse.json();
issueState = 'closed';
const publishedResponse = await worker.fetch(new Request('https://worker.example/status?request=17', { headers }), env);
const published = await publishedResponse.json();

const result = {
  ok: settingsResponse.status === 202 && accepted.request === 17 && createdBody.includes('pending_upload_deletions') &&
    building.status === 'building' && published.status === 'published',
  settings_status: settingsResponse.status,
  building_status: building.status,
  published_status: published.status,
  deletion_forwarded: createdBody.includes('uploads/novyy-gorizont/9301142/add-test.jpg')
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
