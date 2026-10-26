'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* Optional */ }

function loadEnvFile() {
  try {
    const raw = require('node:fs').readFileSync(path.join(__dirname, '.env'), 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith('#') || process.env[match[1]] !== undefined) return;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    });
  } catch { /* Optional */ }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.GEMINI_API_KEY || 'linguabridge-secret-key-2026';

const rateBuckets = new Map();
const storeQueues = new Map();

function nowISO() { return new Date().toISOString(); }
function trimmed(value, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function clientId(req) { return req.socket?.remoteAddress || 'unknown'; }

function setRateLimit(req, res, { windowMs, max, message }, routeKey) {
  const now = Date.now();
  const key = `${routeKey}:${clientId(req)}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [oldKey, oldValue] of rateBuckets) if (oldValue.resetAt <= now) rateBuckets.delete(oldKey);
  }
  if (bucket.count > max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    sendJSON(res, 429, { error: message });
    return false;
  }
  return true;
}

function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

async function readBody(req, maxBytes = 20 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('REQUEST_TOO_LARGE');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    try { return JSON.parse(raw); }
    catch { const error = new Error('INVALID_JSON'); error.status = 400; throw error; }
  }
  return {};
}

async function ensureFile(filename, initialValue = []) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fullPath = path.join(DATA_DIR, filename);
  try { await fs.access(fullPath); }
  catch { await fs.writeFile(fullPath, JSON.stringify(initialValue, null, 2), { encoding: 'utf8', mode: 0o600 }); }
}

async function readStore(filename) {
  await ensureFile(filename, []);
  const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeStore(filename, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fullPath = path.join(DATA_DIR, filename);
  const tempPath = `${fullPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, fullPath);
}

async function mutateStore(filename, mutator) {
  const previous = storeQueues.get(filename) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const data = await readStore(filename);
    const result = await mutator(data);
    if (result?.skipSave) return result.value;
    await writeStore(filename, data);
    return result?.value;
  });
  storeQueues.set(filename, task);
  try { return await task; }
  finally { if (storeQueues.get(filename) === task) storeQueues.delete(filename); }
}

// ПРОВЕРКА ПАРОЛЯ АДМИНА
function adminAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return { ok: false, status: 503, error: 'Административный доступ не настроен. Задайте ADMIN_TOKEN в .env.' };
  const auth = String(req.headers.authorization || '');
  const supplied = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  return valid ? { ok: true } : { ok: false, status: 401, error: 'Неверный административный токен.' };
}

// ХЕШИРОВАНИЕ И ТОКЕНЫ СЕССИЙ (Для пользователей)
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || '').split(':');
  if (!salt || !key) return false;
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  return hashBuffer.length === keyBuffer.length && crypto.timingSafeEqual(hashBuffer, keyBuffer);
}

function createAuthToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'parent',
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAuthToken(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

async function handleAPI(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // РЕГИСТРАЦИЯ И ВХОД
  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 15 * 60 * 1000, max: 15, message: 'Слишком много попыток.' }, pathname)) return;
    const body = await readBody(req);
    const name = trimmed(body.name, 60);
    const email = trimmed(body.email, 120).toLowerCase();
    const password = String(body.password || '');
    const role = ['parent', 'teen'].includes(body.role) ? body.role : 'parent';
    if (name.length < 2) return sendJSON(res, 400, { error: 'Имя должно содержать минимум 2 символа.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 400, { error: 'Введите корректный E-mail.' });
    if (password.length < 6) return sendJSON(res, 400, { error: 'Пароль должен быть не менее 6 символов.' });

    const result = await mutateStore('users.json', (users) => {
      if (users.some((u) => u.email === email)) return { skipSave: true, value: { error: 'Этот E-mail уже занят.' } };
      const newUser = { id: crypto.randomUUID(), name, email, role, passwordHash: hashPassword(password), createdAt: nowISO() };
      users.push(newUser);
      return { value: { user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } } };
    });
    if (result.error) return sendJSON(res, 409, { error: result.error });
    return sendJSON(res, 201, { ok: true, token: createAuthToken(result.user), user: result.user });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 15 * 60 * 1000, max: 20, message: 'Подождите немного.' }, pathname)) return;
    const body = await readBody(req);
    const email = trimmed(body.email, 120).toLowerCase();
    const users = await readStore('users.json');
    const found = users.find((u) => u.email === email);
    if (!found || !verifyPassword(String(body.password || ''), found.passwordHash)) return sendJSON(res, 401, { error: 'Неверный E-mail или пароль.' });
    const safeUser = { id: found.id, name: found.name, email: found.email, role: found.role || 'parent' };
    return sendJSON(res, 200, { ok: true, token: createAuthToken(safeUser), user: safeUser });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const tokenData = verifyAuthToken(req);
    if (!tokenData) return sendJSON(res, 401, { error: 'Не авторизован' });
    const users = await readStore('users.json');
    const found = users.find((u) => u.id === tokenData.id);
    return found ? sendJSON(res, 200, { user: { id: found.id, name: found.name, email: found.email, role: found.role } }) : sendJSON(res, 401, { error: 'Пользователь не найден' });
  }

  // ОТЗЫВЫ И ЗАЯВКИ ПУБЛИЧНЫЕ
  if (pathname === '/api/reviews' && method === 'GET') {
    const reviews = await readStore('reviews.json');
    const visible = reviews.filter((r) => !r.hidden).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, { reviews: visible });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    const body = await readBody(req);
    const review = { id: crypto.randomUUID(), name: trimmed(body.name, 60), email: trimmed(body.email, 100), text: trimmed(body.text, 1200), rating: Number(body.rating) || 5, createdAt: nowISO(), hidden: false };
    if (review.name.length < 2 || review.text.length < 5) return sendJSON(res, 400, { error: 'Заполните поля' });
    await mutateStore('reviews.json', (reviews) => { reviews.push(review); return { value: null }; });
    return sendJSON(res, 201, { ok: true, review });
  }

  if (pathname === '/api/psych-requests' && method === 'POST') {
    const body = await readBody(req);
    const reqItem = { id: crypto.randomUUID(), name: trimmed(body.name, 60), contact: trimmed(body.contact, 160), note: trimmed(body.note, 1600), specialty: trimmed(body.specialty, 100), purpose: body.purpose || 'appointment', createdAt: nowISO(), status: 'new' };
    if (reqItem.name.length < 2 || reqItem.contact.length < 4) return sendJSON(res, 400, { error: 'Укажите контакт' });
    await mutateStore('requests.json', (requests) => { requests.push(reqItem); return { value: null }; });
    return sendJSON(res, 201, { ok: true, message: 'Заявка сохранена!' });
  }

  // ИИ ЧАТ
  if (pathname === '/api/chat' && method === 'POST') {
    const body = await readBody(req);
    const message = trimmed(body.message, 4000);
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!message || !geminiKey) return sendJSON(res, 400, { error: 'Ошибка ключа или запроса' });
    const sys = 'Ты семейный ИИ-медиатор LinguaBridge. Помогай родителям и подросткам.';
    const contents = Array.isArray(body.history) ? body.history.map(i => ({ role: i.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(i.content) }] })) : [];
    contents.push({ role: 'user', parts: [{ text: message }] });

    const models = [GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.7 } }) });
        const p = await r.json().catch(() => ({}));
        if (r.ok && p?.candidates?.[0]?.content?.parts?.[0]?.text) return sendJSON(res, 200, { reply: p.candidates[0].content.parts[0].text.trim() });
      } catch { continue; }
    }
    return sendJSON(res, 502, { error: 'Сервер ИИ перегружен.' });
  }

  // ========== АДМИН ПАНЕЛЬ ==========
  if (pathname === '/api/admin/data' && method === 'GET') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const [requests, reviews] = await Promise.all([readStore('requests.json'), readStore('reviews.json')]);
    return sendJSON(res, 200, { requests: requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), reviews: reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  }

  const reqMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (reqMatch && method === 'PATCH') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    let found = false;
    await mutateStore('requests.json', (reqs) => {
      const item = reqs.find(r => r.id === decodeURIComponent(reqMatch[1]));
      if (item) { item.status = body.status; found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Not found' });
  }

  const revMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
  if (revMatch && method === 'PATCH') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    let found = false;
    await mutateStore('reviews.json', (revs) => {
      const item = revs.find(r => r.id === decodeURIComponent(revMatch[1]));
      if (item) { item.hidden = body.hidden; found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Not found' });
  }

  if (revMatch && method === 'DELETE') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    let found = false;
    await mutateStore('reviews.json', (revs) => {
      const idx = revs.findIndex(r => r.id === decodeURIComponent(revMatch[1]));
      if (idx >= 0) { revs.splice(idx, 1); found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Not found' });
  }

  return sendJSON(res, 404, { error: 'API-метод не найден.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'
};

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJSON(res, 400, { error: 'Bad Request' }); }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return sendJSON(res, 403, { error: 'Forbidden' });
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    return sendJSON(res, 404, { error: 'Страница не найдена.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    return await serveStatic(req, res, url);
  } catch {
    res.writeHead(500).end();
  }
});

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureFile('users.json'); await ensureFile('reviews.json'); await ensureFile('requests.json');
  server.listen(PORT, '0.0.0.0', () => console.log(`Running on ${PORT}`));
}
start();
