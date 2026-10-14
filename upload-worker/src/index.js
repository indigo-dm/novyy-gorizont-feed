const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const PUBLIC_ACCESS_PASSWORD_HASH = '8dce592bb594f861bf4b21de5955aa5b64a5547763b0b7ee97cb159572c628a3';

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function encodedPath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

function publicBase(request, env) {
  return String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

function r2Available(env) {
  return Boolean(env.FEED_STORAGE && typeof env.FEED_STORAGE.get === 'function');
}

function safeStorageKey(value) {
  const key = String(value || '').replace(/^\/+/, '');
  if (!key || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return key;
}

function mimeForKey(key) {
  if (/\.json$/i.test(key)) return 'application/json; charset=utf-8';
  if (/\.xml$/i.test(key)) return 'application/xml; charset=utf-8';
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
  if (/\.webp$/i.test(key)) return 'image/webp';
  if (/\.svg$/i.test(key)) return 'image/svg+xml';
  if (/\.ttf$/i.test(key)) return 'font/ttf';
  return 'application/octet-stream';
}

function objectResponse(object, request, cacheControl) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
    'X-Feed-Storage': 'r2'
  });
  if (object && typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', mimeForKey(object && object.key));
  if (object && object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
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

async function githubRepository(env, repository, path, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
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
    if (response.ok) {
      if (response.status === 204) return null;
      return response.json();
    }
    const detail = await response.text();
    lastError = new Error(`GitHub ${response.status}: ${detail.slice(0, 240)}`);
    if (![409, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error('GitHub request failed');
}

async function github(env, path, options = {}) {
  return githubRepository(env, env.GITHUB_REPOSITORY, path, options);
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
  if (r2Available(env)) {
    await env.FEED_STORAGE.put(path, bytes, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=300, must-revalidate'
      },
      customMetadata: {
        project,
        lot,
        imageId,
        uploadedAt: new Date().toISOString()
      }
    });
    return json({
      id: imageId,
      url: `${publicBase(request, env)}/media/${encodedPath(path)}`,
      path,
      size: file.size,
      storage: 'r2'
    }, 201, origin, env);
  }
  const branch = await ensureMediaBranch(env);
  await github(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Upload image for ${project} lot ${lot}`,
      content: bytesToBase64(bytes),
      branch
    })
  });
  const githubPath = encodedPath(path);
  const url = `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/${encodeURIComponent(branch)}/${githubPath}`;
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
  try {
    await github(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Upload brand material for ${project}`,
        content: bytesToBase64(bytes),
        branch
      })
    });
  } catch (error) {
    console.error('Material upload failed', { project, path, message: String(error && error.message || error) });
    const message = /GitHub (?:401|403):/.test(String(error && error.message || ''))
      ? 'Сервис загрузки потерял доступ к хранилищу. Сообщите администратору.'
      : 'Не удалось сохранить материал. Повторите загрузку через несколько секунд.';
    return json({ error: message }, 503, origin, env);
  }
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

function collectMaterialReferences(settings, references) {
  const materials = settings && typeof settings.material_settings === 'object' ? settings.material_settings : {};
  for (const role of ['logo', 'key_render', 'background_render']) {
    const filename = String(materials[role] || '');
    if (filename) references.add(filename);
  }
}

async function publishedMaterialReferences(env, project) {
  const references = new Set();
  if (r2Available(env)) {
    const stored = await env.FEED_STORAGE.get(`published/projects/${project}/settings.json`);
    if (stored) collectMaterialReferences(await stored.json(), references);
  }
  const branch = env.GITHUB_SOURCE_BRANCH || 'main';
  const response = await githubRaw(env, `projects/${project}/promotion-rules.json`, branch);
  collectMaterialReferences(await response.json(), references);
  return references;
}

async function deleteMaterial(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const payload = await request.json();
  const project = String(payload && payload.project || '').trim();
  const filename = String(payload && payload.filename || '').trim();
  if (!validProject(project, env)) return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  if (!/^uploads\/mat-[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/i.test(filename)) {
    return json({ error: 'Удалять можно только материалы, загруженные через интерфейс.' }, 400, origin, env);
  }
  const references = await publishedMaterialReferences(env, project);
  if (references.has(filename)) {
    return json({ error: 'Материал используется опубликованными настройками. Сначала назначьте другой материал и примените изменения к фиду.' }, 409, origin, env);
  }
  const branch = env.GITHUB_SOURCE_BRANCH || 'main';
  const path = `projects/${project}/assets/${filename}`;
  let entry;
  try {
    entry = await github(env, `/contents/${encodedPath(path)}?ref=${encodeURIComponent(branch)}`);
  } catch (error) {
    if (/GitHub 404:/.test(String(error && error.message || ''))) {
      return json({ error: 'Материал уже удалён или не найден.' }, 404, origin, env);
    }
    throw error;
  }
  if (!entry || !/^[0-9a-f]{40}$/i.test(String(entry.sha || ''))) {
    return json({ error: 'Не удалось подтвердить файл перед удалением.' }, 502, origin, env);
  }
  await github(env, `/contents/${encodedPath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Delete unused brand material for ${project}`,
      sha: entry.sha,
      branch
    })
  });
  return json({ deleted: true, project, filename }, 200, origin, env);
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

function validProject(project, env) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) &&
    (!allowedProjects(env).size || allowedProjects(env).has(project));
}

function sourceFeedKey(project) {
  return `private/source-feeds/${project}.json`;
}

async function sourceFeedStatus(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const project = String(new URL(request.url).searchParams.get('project') || '').trim();
  if (!validProject(project, env)) return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  if (!r2Available(env)) return json({ error: 'Защищённое хранилище временно недоступно.' }, 503, origin, env);
  const stored = await env.FEED_STORAGE.get(sourceFeedKey(project));
  if (!stored) return json({ project, configured: false }, 200, origin, env);
  const payload = await stored.json();
  let hostname = '';
  try { hostname = new URL(String(payload.url || '')).hostname; } catch (error) { hostname = ''; }
  return json({
    project,
    configured: Boolean(hostname),
    hostname,
    updatedAt: String(payload.updated_at || '')
  }, 200, origin, env);
}

async function saveSourceFeed(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  if (!r2Available(env)) return json({ error: 'Защищённое хранилище временно недоступно.' }, 503, origin, env);
  const payload = await request.json();
  const project = String(payload && payload.project || '').trim();
  const value = String(payload && payload.url || '').trim();
  if (!validProject(project, env)) return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  if (!value || value.length > 4096) return json({ error: 'Укажите адрес родительского фида.' }, 400, origin, env);
  let parsed;
  try { parsed = new URL(value); } catch (error) { return json({ error: 'Укажите корректную HTTPS-ссылку.' }, 400, origin, env); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    return json({ error: 'Допускается только HTTPS-ссылка без логина и пароля в адресе.' }, 400, origin, env);
  }
  const updatedAt = new Date().toISOString();
  await env.FEED_STORAGE.put(sourceFeedKey(project), JSON.stringify({
    version: 1,
    project,
    url: parsed.href,
    updated_at: updatedAt
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
  });
  return json({ project, configured: true, hostname: parsed.hostname, updatedAt }, 200, origin, env);
}

async function projectSetup(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const project = String(new URL(request.url).searchParams.get('project') || '').trim();
  if (!validProject(project, env)) return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  const branch = env.GITHUB_SOURCE_BRANCH || 'main';
  const [configResponse, settingsResponse, entries] = await Promise.all([
    githubRaw(env, `projects/${project}/config.json`, branch),
    githubRaw(env, `projects/${project}/promotion-rules.json`, branch),
    github(env, `/contents/${encodedPath(`projects/${project}/assets`)}?ref=${encodeURIComponent(branch)}`)
  ]);
  const config = await configResponse.json();
  const settings = await settingsResponse.json();
  const files = (Array.isArray(entries) ? entries : []).filter((entry) =>
    entry && entry.type === 'file' && /\.(?:jpe?g|png|webp|svg)$/i.test(String(entry.name || ''))
  );
  const brand = config && typeof config.brand === 'object' ? config.brand : {};
  const descriptions = new Map();
  descriptions.set(String(brand.logo || ''), ['Логотип', 'Основной логотип объекта для брендированных карточек.']);
  descriptions.set(String(brand.key_render || ''), ['Ключевой рендер', 'Главное изображение проекта в левой части макета.']);
  if (brand.background_render) descriptions.set(String(brand.background_render), ['Фоновый рендер', 'Изображение, используемое фоном брендированной карточки.']);
  for (const [index, item] of (Array.isArray(brand.additional_logos) ? brand.additional_logos : []).entries()) {
    if (item && item.filename) descriptions.set(String(item.filename), [String(item.name || `Дополнительный логотип ${index + 1}`), 'Дополнительный вариант фирменного логотипа объекта.']);
  }
  for (const [index, item] of (Array.isArray(brand.additional_renders) ? brand.additional_renders : []).entries()) {
    if (item && item.filename) descriptions.set(String(item.filename), [String(item.name || `Дополнительный рендер ${index + 1}`), 'Дополнительный фирменный рендер объекта.']);
  }
  const items = files.map((entry) => {
    const filename = String(entry.name);
    const details = descriptions.get(filename) || [filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), 'Фирменный материал объекта.'];
    const activeFor = [];
    if (filename === brand.logo) activeFor.push('logo');
    if (filename === brand.key_render) activeFor.push('key_render');
    if (filename === brand.background_render) activeFor.push('background_render');
    return {
      key: `asset-${filename.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
      name: details[0],
      description: details[1],
      filename,
      required: activeFor.length > 0,
      exists: true,
      url: rawGithubUrl(env, branch, `projects/${project}/assets/${filename}`),
      active_for: activeFor,
      uploaded: false
    };
  });
  for (const [filename, details] of descriptions.entries()) {
    if (!filename || items.some((item) => item.filename === filename)) continue;
    const activeFor = [];
    if (filename === brand.logo) activeFor.push('logo');
    if (filename === brand.key_render) activeFor.push('key_render');
    if (filename === brand.background_render) activeFor.push('background_render');
    items.push({
      key: `asset-${filename.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
      name: details[0],
      description: details[1],
      filename,
      required: activeFor.length > 0,
      exists: false,
      url: '',
      active_for: activeFor,
      uploaded: false
    });
  }
  return json({
    project,
    name: String(config.project || project),
    settings,
    assets: {
      project: String(config.project || project),
      slug: project,
      upload_service_url: publicBase(request, env),
      items,
      current: {
        logo: String(brand.logo || ''),
        key_render: String(brand.key_render || ''),
        background_render: String(brand.background_render || '')
      },
      brand: {
        green: String(brand.green || '#00605C'),
        background_color: String(brand.background_color || brand.green || '#00605C'),
        text_color: String(brand.text_color || brand.white || '#FFFFFF'),
        subtitle_color: String(brand.subtitle_color || brand.gray || '#9B9B9B'),
        green_dark: String(brand.green_dark || brand.green || '#004C49'),
        gold: String(brand.gold || '#CEAD75'),
        gray: String(brand.gray || '#9B9B9B'),
        white: String(brand.white || '#FFFFFF'),
        font: String(brand.font || 'Manrope'),
        palette: Array.isArray(brand.palette) ? brand.palette : []
      }
    }
  }, 200, origin, env);
}

function pendingDeletionPaths(payload, project) {
  const source = Array.isArray(payload && payload.pending_upload_deletions) ? payload.pending_upload_deletions : [];
  return source.slice(0, 50).map((item) => {
    const lot = String(item && item.lot || '');
    const id = String(item && item.id || '');
    const path = safeStorageKey(item && item.path);
    const expected = new RegExp(`^uploads/${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${lot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(?:jpg|jpeg|png|webp)$`, 'i');
    return /^\d{1,20}$/.test(lot) && /^add-[A-Za-z0-9_-]+$/.test(id) && expected.test(path) ? path : '';
  }).filter(Boolean);
}

async function rememberOperation(env, issueNumber, project, payload) {
  if (!r2Available(env)) return;
  const deletionPaths = pendingDeletionPaths(payload, project);
  if (!deletionPaths.length) return;
  await env.FEED_STORAGE.put(`operations/${issueNumber}.json`, JSON.stringify({
    project,
    deletionPaths,
    createdAt: new Date().toISOString()
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
  });
}

async function completeOperation(env, issueNumber) {
  if (!r2Available(env)) return 0;
  const markerKey = `operations/${issueNumber}.json`;
  const marker = await env.FEED_STORAGE.get(markerKey);
  if (!marker) return 0;
  const payload = await marker.json();
  const deletionPaths = Array.isArray(payload && payload.deletionPaths)
    ? payload.deletionPaths.map(safeStorageKey).filter((path) => /^uploads\//.test(path))
    : [];
  if (deletionPaths.length) await env.FEED_STORAGE.delete(deletionPaths);
  await env.FEED_STORAGE.delete(markerKey);
  return deletionPaths.length;
}

function collectReferencedUploads(settings, referenced) {
  const overrides = settings && settings.image_settings && settings.image_settings.lot_overrides;
  if (!overrides || typeof overrides !== 'object') return;
  for (const override of Object.values(overrides)) {
    for (const image of Array.isArray(override && override.added) ? override.added : []) {
      const path = safeStorageKey(image && image.path);
      if (/^uploads\//.test(path)) referenced.add(path);
    }
  }
}

async function cleanupOrphanUploads(env) {
  if (!r2Available(env)) return { scanned: 0, deleted: 0 };
  const referenced = new Set();
  for (const project of allowedProjects(env)) {
    const settings = await env.FEED_STORAGE.get(`published/projects/${project}/settings.json`);
    if (!settings) continue;
    try {
      collectReferencedUploads(await settings.json(), referenced);
    } catch (error) {
      console.error(`Cannot parse settings for ${project}`, error);
    }
  }
  const retentionDays = Math.max(1, Number(env.ORPHAN_RETENTION_DAYS || 7));
  const cutoff = Date.now() - retentionDays * 86400000;
  let cursor;
  let scanned = 0;
  let deleted = 0;
  do {
    const page = await env.FEED_STORAGE.list({ prefix: 'uploads/', cursor, limit: 1000 });
    const stale = [];
    for (const object of page.objects || []) {
      scanned += 1;
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : new Date(object.uploaded || 0).getTime();
      if (!referenced.has(object.key) && uploaded && uploaded < cutoff) stale.push(object.key);
    }
    if (stale.length) {
      await env.FEED_STORAGE.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  let markerScanned = 0;
  let markerDeleted = 0;
  for (const prefix of ['operations/', 'refresh-operations/']) {
    let markerCursor;
    do {
      const page = await env.FEED_STORAGE.list({ prefix, cursor: markerCursor, limit: 1000 });
      const stale = [];
      for (const object of page.objects || []) {
        markerScanned += 1;
        const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : new Date(object.uploaded || 0).getTime();
        if (uploaded && uploaded < cutoff) stale.push(object.key);
      }
      if (stale.length) {
        await env.FEED_STORAGE.delete(stale);
        markerDeleted += stale.length;
      }
      markerCursor = page.truncated ? page.cursor : undefined;
    } while (markerCursor);
  }
  return { scanned, deleted, markerScanned, markerDeleted };
}

async function createSettingsRequest(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const payload = await request.json();
  const project = String(payload && payload.project || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects(env).size && !allowedProjects(env).has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  if (!payload || ![2, 3, 4].includes(payload.version) || !Array.isArray(payload.rules) || !Array.isArray(payload.excluded_lot_ids || []) || typeof payload.image_settings !== 'object' || typeof payload.parameter_settings !== 'object' || (payload.version >= 3 && typeof payload.material_settings !== 'object')) {
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
  await rememberOperation(env, issue.number, project, payload);
  return json({ request: issue.number, status: 'queued', createdAt: issue.created_at }, 202, origin, env);
}

async function settingsStatus(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const requestNumber = new URL(request.url).searchParams.get('request') || '';
  if (!/^\d{1,12}$/.test(requestNumber)) return json({ error: 'Некорректный номер операции.' }, 400, origin, env);
  const issue = await github(env, `/issues/${requestNumber}`);
  if (!String(issue.title || '').startsWith('[feed-settings]')) return json({ error: 'Операция не относится к настройкам фида.' }, 404, origin, env);
  if (issue.state === 'closed') {
    const deletedUploads = await completeOperation(env, issue.number);
    try {
      await dispatchFrontendDeploy(env);
    } catch (error) {
      console.error(error);
    }
    return json({ request: issue.number, status: 'published', completedAt: issue.closed_at || issue.updated_at, deletedUploads }, 200, origin, env);
  }
  const comments = await github(env, `/issues/${requestNumber}/comments?per_page=30`);
  const failure = comments.find((comment) => /не применены|завершилась ошибкой/i.test(String(comment.body || '')));
  if (failure) {
    return json({ request: issue.number, status: 'failed', message: String(failure.body || 'Сборка завершилась ошибкой.') }, 200, origin, env);
  }
  return json({ request: issue.number, status: 'building', updatedAt: issue.updated_at }, 200, origin, env);
}

function refreshMarkerKey(requestId) {
  return `refresh-operations/${requestId}.json`;
}

const REFRESH_SOURCE_TIMEOUT_MS = 20 * 60 * 1000;
const REFRESH_FRONTEND_TIMEOUT_MS = 10 * 60 * 1000;

async function sourceRefreshState(env, operation) {
  const statusObject = await env.FEED_STORAGE.get(`published/projects/${operation.project}/status.json`);
  if (!statusObject) return null;
  const status = await statusObject.json();
  const checkedAt = String(status.checked_at || '');
  const checkedAtMs = Date.parse(checkedAt);
  const requestedAtMs = Date.parse(operation.requestedAt || '');
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(requestedAtMs) || checkedAtMs < requestedAtMs - 1000) return null;
  return { checkedAt, status };
}

async function digestHex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function frontendFeedMatches(env, operation) {
  const stored = await env.FEED_STORAGE.get(`published/projects/${operation.project}/avito.xml`);
  if (!stored) return false;
  const feedRoot = String(env.FRONTEND_FEED_ROOT || 'https://indigo-dm.github.io/feed-studio/feeds').replace(/\/+$/, '');
  const response = await fetch(`${feedRoot}/${encodeURIComponent(operation.project)}/avito.xml?v=${encodeURIComponent(operation.request)}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'indigo-feed-studio-status' }
  });
  if (!response.ok) return false;
  const [storedBytes, publicBytes] = await Promise.all([stored.arrayBuffer(), response.arrayBuffer()]);
  if (storedBytes.byteLength !== publicBytes.byteLength) return false;
  const [storedDigest, publicDigest] = await Promise.all([digestHex(storedBytes), digestHex(publicBytes)]);
  return storedDigest === publicDigest;
}

async function saveRefreshOperation(env, operation) {
  if (!r2Available(env)) throw new Error('R2 storage is unavailable');
  await env.FEED_STORAGE.put(refreshMarkerKey(operation.request), JSON.stringify(operation), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
  });
}

async function createFeedRefreshRequest(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  if (!r2Available(env)) return json({ error: 'Хранилище операций временно недоступно.' }, 503, origin, env);
  const payload = await request.json();
  const project = String(payload && payload.project || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || (allowedProjects(env).size && !allowedProjects(env).has(project))) {
    return json({ error: 'Неизвестный объект.' }, 400, origin, env);
  }
  const requestId = `refresh-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const requestedAt = new Date().toISOString();
  await github(env, '/dispatches', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'profitbase-refresh',
      client_payload: { project, render_ids: 'changed', request_id: requestId }
    })
  });
  await saveRefreshOperation(env, { request: requestId, project, requestedAt });
  return json({ request: requestId, project, status: 'queued', requestedAt }, 202, origin, env);
}

async function feedRefreshStatus(request, env, origin) {
  if (!(await authorize(request, env))) return json({ error: 'Неверный пароль Feed Studio.' }, 401, origin, env);
  const requestId = new URL(request.url).searchParams.get('request') || '';
  if (!/^refresh-[a-z0-9-]{8,80}$/.test(requestId)) return json({ error: 'Некорректный номер операции.' }, 400, origin, env);
  if (!r2Available(env)) return json({ error: 'Хранилище операций временно недоступно.' }, 503, origin, env);
  const marker = await env.FEED_STORAGE.get(refreshMarkerKey(requestId));
  if (!marker) return json({ error: 'Операция обновления не найдена или уже удалена.' }, 404, origin, env);
  const operation = await marker.json();
  const requestedAtMs = Date.parse(operation.requestedAt || '');
  const sourceState = await sourceRefreshState(env, operation);
  if (!sourceState) {
    if (Number.isFinite(requestedAtMs) && Date.now() - requestedAtMs > REFRESH_SOURCE_TIMEOUT_MS) {
      return json({ request: requestId, project: operation.project, status: 'failed', message: 'Обновление исходного фида не завершилось за 20 минут. Повторите попытку.' }, 200, origin, env);
    }
    return json({ request: requestId, project: operation.project, status: 'building', requestedAt: operation.requestedAt }, 200, origin, env);
  }

  if (await frontendFeedMatches(env, operation)) {
    operation.completedAt = operation.completedAt || new Date().toISOString();
    operation.sourceCompletedAt = sourceState.checkedAt;
    await saveRefreshOperation(env, operation);
    return json({ request: requestId, project: operation.project, status: 'published', completedAt: operation.completedAt }, 200, origin, env);
  }

  if (!operation.frontendDispatchedAt) {
    await dispatchFrontendDeploy(env);
    operation.frontendDispatchedAt = new Date().toISOString();
    operation.sourceCompletedAt = sourceState.checkedAt;
    await saveRefreshOperation(env, operation);
    return json({ request: requestId, project: operation.project, status: 'deploying', updatedAt: operation.frontendDispatchedAt }, 200, origin, env);
  }

  const frontendDispatchedAtMs = Date.parse(operation.frontendDispatchedAt);
  if (Number.isFinite(frontendDispatchedAtMs) && Date.now() - frontendDispatchedAtMs > REFRESH_FRONTEND_TIMEOUT_MS) {
    return json({ request: requestId, project: operation.project, status: 'failed', message: 'Данные обновлены, но публичный XML не появился за 10 минут. Повторите попытку.' }, 200, origin, env);
  }
  return json({ request: requestId, project: operation.project, status: 'deploying', updatedAt: operation.frontendDispatchedAt }, 200, origin, env);
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
  if (r2Available(env)) {
    const object = request.method === 'HEAD'
      ? await env.FEED_STORAGE.head(target)
      : await env.FEED_STORAGE.get(target);
    if (object) return objectResponse(object, request, 'no-store, max-age=0');
  }
  const source = await githubRaw(env, target, env.GITHUB_DATA_BRANCH || 'feed-data');
  const isXml = target.endsWith('.xml');
  const headers = {
    'Content-Type': isXml ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'X-Feed-Storage': 'github-feed-data'
  };
  const etag = source.headers.get('ETag');
  if (etag) headers.ETag = etag;
  return new Response(request.method === 'HEAD' ? null : source.body, { status: 200, headers });
}

async function publicMedia(request, env, path) {
  let decoded;
  try {
    decoded = decodeURIComponent(path.replace(/^\/media\//, ''));
  } catch {
    decoded = '';
  }
  const key = safeStorageKey(decoded);
  const allowed = /^(?:projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:images|previews|thumbnails|assets)\/|uploads\/)/.test(key);
  if (!allowed) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (r2Available(env)) {
    const storageKey = /^projects\//.test(key) ? `media/${key}` : key;
    const object = request.method === 'HEAD'
      ? await env.FEED_STORAGE.head(storageKey)
      : await env.FEED_STORAGE.get(storageKey);
    if (object) return objectResponse(object, request, 'public, max-age=300, must-revalidate');
  }
  if (/^projects\//.test(key) && env.LEGACY_MEDIA_ROOT) {
    const legacy = await fetch(`${String(env.LEGACY_MEDIA_ROOT).replace(/\/+$/, '')}/${encodedPath(key)}`);
    if (legacy.ok) {
      const headers = new Headers(legacy.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Feed-Storage', 'legacy-pages');
      return new Response(request.method === 'HEAD' ? null : legacy.body, { status: 200, headers });
    }
  }
  return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
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
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/media/')) {
      try {
        return await publicMedia(request, env, path);
      } catch (error) {
        console.error(error);
        return new Response('Media temporarily unavailable', {
          status: 502,
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
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
      if (request.method === 'DELETE' && path === '/materials') return await deleteMaterial(request, env, origin);
      if (request.method === 'GET' && path === '/materials') return await listMaterials(request, env, origin);
      if (request.method === 'GET' && path === '/project/setup') return await projectSetup(request, env, origin);
      if (request.method === 'GET' && path === '/source-feed') return await sourceFeedStatus(request, env, origin);
      if (request.method === 'POST' && path === '/source-feed') return await saveSourceFeed(request, env, origin);
      if (request.method === 'POST' && path === '/settings') return await createSettingsRequest(request, env, origin);
      if (request.method === 'GET' && path === '/status') return await settingsStatus(request, env, origin);
      if (request.method === 'POST' && path === '/refresh') return await createFeedRefreshRequest(request, env, origin);
      if (request.method === 'GET' && path === '/refresh/status') return await feedRefreshStatus(request, env, origin);
      return json({ error: 'Метод или адрес не поддерживается.' }, 405, origin, env);
    } catch (error) {
      console.error(error);
      return json({ error: 'Сервис временно недоступен. Повторите попытку.' }, 502, origin, env);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupOrphanUploads(env).then((result) => console.log(JSON.stringify({ event: 'r2-cleanup', ...result }))));
  }
};
