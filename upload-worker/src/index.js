const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const PUBLIC_ACCESS_PASSWORD_HASH = '8dce592bb594f861bf4b21de5955aa5b64a5547763b0b7ee97cb159572c628a3';

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(payload, status, origin, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin, env.ALLOWED_ORIGIN) }
  });
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function validMagic(bytes, mime) {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === 'image/webp') {
    return String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  }
  if (mime === 'image/svg+xml') {
    const source = new TextDecoder().decode(bytes).trim();
    return /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source) &&
      !/<(?:script|foreignObject|iframe|object|embed)\b/i.test(source) &&
      !/\son[a-z]+\s*=/i.test(source) &&
      !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:text\/html)/i.test(source);
  }
  return false;
}

async function github(env, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'indigo-feed-studio-upload',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response.json();
}

async function githubRaw(env, path, branch) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'indigo-feed-studio-upload',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response;
}

async function dispatchFrontendDeploy(env) {
  const repository = String(env.GITHUB_FRONTEND_REPOSITORY || 'indigo-dm/feed-studio');
  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'indigo-feed-studio-upload',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ event_type: 'feed-data-updated' })
  });
  if (!response.ok) throw new Error(`GitHub frontend deploy dispatch failed: ${response.status}`);
}

async function ensureMediaBranch(env) {
  const branch = env.GITHUB_MEDIA_BRANCH || 'media';
  const refResponse = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'indigo-feed-studio-upload',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (refResponse.ok) return branch;
  if (refResponse.status !== 404) throw new Error(`GitHub branch check failed: ${refResponse.status}`);
  const sourceBranch = env.GITHUB_SOURCE_BRANCH || 'main';
  const source = await github(env, `/git/ref/heads/${encodeURIComponent(sourceBranch)}`);
  await github(env, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: source.object.sha })
  });
  return branch;
}

async function authorize(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = String(env.PUBLIC_ACCESS_PASSWORD_HASH || PUBLIC_ACCESS_PASSWORD_HASH).toLowerCase();
  if (!token || !/^[0-9a-f]{64}$/.test(expected)) return false;
  return (await sha256Hex(token)) === expected;
}

async function upload(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль загрузки.' }, 401, origin, env);
  const form = await request.formData();
  const project = String(form.get('project') || '').trim();
  const lot = String(form.get('lot') || '').trim();
  const file = form.get('file');
  const allowedProjects = new Set(String(env.ALLOWED_PROJECTS || '').split(',').map((value) => value.trim()).filter(Boolean));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects.size && !allowedProjects.has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  if (!/^\d{1,20}$/.test(lot)) return json({ error: 'Некорректный ID квартиры.' }, 400, origin, env);
  if (!(file instanceof File)) return json({ error: 'Файл не найден.' }, 400, origin, env);
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const maxBytes = Number(env.MAX_FILE_BYTES || 10485760);
  if (!allowedTypes.has(file.type) || file.size < 1 || file.size > maxBytes) {
    return json({ error: 'Допустимы JPG, PNG и WebP размером до 10 МБ.' }, 400, origin, env);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validMagic(bytes, file.type)) return json({ error: 'Содержимое файла не соответствует формату изображения.' }, 400, origin, env);
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const digest = await sha256Hex(bytes);
  const stamp = Date.now().toString(36);
  const imageId = `add-${stamp}-${digest.slice(0, 10)}`;
  const path = `uploads/${project}/${lot}/${imageId}.${extension}`;
  const branch = await ensureMediaBranch(env);
  await github(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Upload image for ${project} lot ${lot}`,
      content: bytesToBase64(bytes),
      branch
    })
  });
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/${encodeURIComponent(branch)}/${encodedPath}`;
  return json({ id: imageId, url, path, size: file.size }, 201, origin, env);
}

function cleanMaterialName(value) {
  const source = String(value || 'material').replace(/\.[^.]+$/, '');
  const alphabet = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: ''
  };
  const transliterated = source.toLowerCase().split('').map((character) => alphabet[character] ?? character).join('');
  return transliterated.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'material';
}

function rawGithubUrl(env, branch, path) {
  return `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function materialUpload(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const form = await request.formData();
  const project = String(form.get('project') || '').trim();
  const file = form.get('file');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects(env).size && !allowedProjects(env).has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  if (!(file instanceof File)) return json({ error: 'Файл не найден.' }, 400, origin, env);
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
  const maxBytes = Number(env.MAX_FILE_BYTES || 10485760);
  if (!allowedTypes.has(file.type) || file.size < 1 || file.size > maxBytes) {
    return json({ error: 'Допустимы JPG, PNG, WebP и безопасный SVG размером до 10 МБ.' }, 400, origin, env);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validMagic(bytes, file.type)) return json({ error: 'Файл повреждён или содержит небезопасный SVG.' }, 400, origin, env);
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/svg+xml' ? 'svg' : 'jpg';
  const digest = await sha256Hex(bytes);
  const assetId = `mat-${Date.now().toString(36)}-${digest.slice(0, 10)}`;
  const filename = `${assetId}-${cleanMaterialName(file.name)}.${extension}`;
  const relative = `uploads/${filename}`;
  const path = `projects/${project}/assets/${relative}`;
  const branch = env.GITHUB_SOURCE_BRANCH || 'main';
  await github(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Upload brand material for ${project}`,
      content: bytesToBase64(bytes),
      branch
    })
  });
  return json({
    id: assetId,
    name: String(file.name || filename).replace(/\.[^.]+$/, ''),
    filename: relative,
    url: rawGithubUrl(env, branch, path),
    size: file.size,
    uploaded: true,
    active_for: []
  }, 201, origin, env);
}

async function listMaterials(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const project = String(new URL(request.url).searchParams.get('project') || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects(env).size && !allowedProjects(env).has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  const branch = env.GITHUB_SOURCE_BRANCH || 'main';
  const directory = `projects/${project}/assets/uploads`;
  const encoded = directory.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'indigo-feed-studio-upload',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );
  if (response.status === 404) return json({ items: [] }, 200, origin, env);
  if (!response.ok) throw new Error(`GitHub material list failed: ${response.status}`);
  const entries = await response.json();
  const items = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.type === 'file' && /\.(?:jpe?g|png|webp|svg)$/i.test(entry.name))
    .map((entry) => ({
      id: String(entry.name).replace(/\.[^.]+$/, ''),
      name: String(entry.name).replace(/^mat-[^-]+-[^-]+-/, '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      filename: `uploads/${entry.name}`,
      url: rawGithubUrl(env, branch, `${directory}/${entry.name}`),
      size: Number(entry.size || 0),
      uploaded: true,
      active_for: []
    }));
  return json({ items }, 200, origin, env);
}

function allowedProjects(env) {
  return new Set(String(env.ALLOWED_PROJECTS || '').split(',').map((value) => value.trim()).filter(Boolean));
}

async function createSettingsRequest(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const payload = await request.json();
  const project = String(payload && payload.project || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects(env).size && !allowedProjects(env).has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  if (!payload || ![2, 3].includes(payload.version) || !Array.isArray(payload.rules) || !Array.isArray(payload.excluded_lot_ids || []) || typeof payload.image_settings !== 'object' || typeof payload.parameter_settings !== 'object' || (payload.version >= 3 && typeof payload.material_settings !== 'object')) {
    return json({ error: 'Некорректный формат настроек.' }, 400, origin, env);
  }
  const settings = JSON.stringify(payload, null, 2);
  if (settings.length > 58000) return json({ error: 'Настройки слишком объёмные для автоматической обработки.' }, 413, origin, env);
  const body = 'Запрос на автоматическое обновление настроек фида.\n\n' +
    'FEED_SETTINGS_JSON_START\n' + settings + '\nFEED_SETTINGS_JSON_END\n\n' +
    'Запрос создан Feed Studio автоматически. Ручное подтверждение не требуется.';
  const issue = await github(env, '/issues', {
    method: 'POST',
    body: JSON.stringify({
      title: `[feed-settings] ${project}: обновить настройки фида`,
      body
    })
  });
  return json({ request: issue.number, status: 'queued', createdAt: issue.created_at }, 202, origin, env);
}

async function settingsStatus(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const requestNumber = new URL(request.url).searchParams.get('request') || '';
  if (!/^\d{1,12}$/.test(requestNumber)) return json({ error: 'Некорректный номер операции.' }, 400, origin, env);
  const issue = await github(env, `/issues/${requestNumber}`);
  if (!String(issue.title || '').startsWith('[feed-settings]')) return json({ error: 'Операция не относится к настройкам фида.' }, 404, origin, env);
  if (issue.state === 'closed') {
    try {
      await dispatchFrontendDeploy(env);
    } catch (error) {
      console.error(error);
    }
    return json({ request: issue.number, status: 'published', completedAt: issue.closed_at || issue.updated_at }, 200, origin, env);
  }
  const comments = await github(env, `/issues/${requestNumber}/comments?per_page=30`);
  const failure = comments.find((comment) => /не применены|завершилась ошибкой/i.test(String(comment.body || '')));
  if (failure) {
    return json({ request: issue.number, status: 'failed', message: String(failure.body || 'Сборка завершилась ошибкой.') }, 200, origin, env);
  }
  return json({ request: issue.number, status: 'building', updatedAt: issue.updated_at }, 200, origin, env);
}

const PUBLIC_DATA_FILES = new Set([
  'inventory.json',
  'settings.json',
  'status.json',
  'assets.json',
  'source-profitbase.xml',
  'avito.xml',
  'pilot-avito.xml'
]);

function publicDataTarget(path, env) {
  if (path === '/data/projects.json') return 'published/projects.json';
  const match = path.match(/^\/data\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([^/]+)$/);
  if (!match || !PUBLIC_DATA_FILES.has(match[2])) return '';
  if (allowedProjects(env).size && !allowedProjects(env).has(match[1])) return '';
  return `published/projects/${match[1]}/${match[2]}`;
}

async function publicData(request, env, path) {
  const target = publicDataTarget(path, env);
  if (!target) {
    return new Response(JSON.stringify({ error: 'Файл не найден.' }), {
      status: 404,
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Origin': '*' }
    });
  }
  const source = await githubRaw(env, target, env.GITHUB_DATA_BRANCH || 'feed-data');
  const isXml = target.endsWith('.xml');
  const headers = {
    'Content-Type': isXml ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  };
  const etag = source.headers.get('ETag');
  if (etag) headers.ETag = etag;
  return new Response(request.method === 'HEAD' ? null : source.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/data/')) {
      try {
        return await publicData(request, env, path);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Данные фида временно недоступны.' }), {
          status: 502,
          headers: { ...JSON_HEADERS, 'Access-Control-Allow-Origin': '*' }
        });
      }
    }
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'Источник запроса не разрешён.' }, 403, origin, env);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
    try {
      if (request.method === 'POST' && (path === '/' || path === '/upload')) return await upload(request, env, origin);
      if (request.method === 'POST' && path === '/materials/upload') return await materialUpload(request, env, origin);
      if (request.method === 'GET' && path === '/materials') return await listMaterials(request, env, origin);
      if (request.method === 'POST' && path === '/settings') return await createSettingsRequest(request, env, origin);
      if (request.method === 'GET' && path === '/status') return await settingsStatus(request, env, origin);
      return json({ error: 'Метод или адрес не поддерживается.' }, 405, origin, env);
    } catch (error) {
      console.error(error);
      return json({ error: 'Сервис временно недоступен. Повторите попытку.' }, 502, origin, env);
    }
  }
};
