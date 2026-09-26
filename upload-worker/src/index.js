const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (!token || !/^[0-9a-f]{64}$/i.test(String(env.ACCESS_PASSWORD_HASH || ''))) return false;
  return (await sha256Hex(token)) === String(env.ACCESS_PASSWORD_HASH).toLowerCase();
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'Источник запроса не разрешён.' }, 403, origin, env);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
    if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405, origin, env);
    try {
      return await upload(request, env, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Не удалось сохранить изображение. Повторите попытку.' }, 502, origin, env);
    }
  }
};
