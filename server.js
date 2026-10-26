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

// ХЕШИРОВАНИЕ ПАРОЛЕЙ И ТОКЕНЫ СЕССИЙ
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
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30 // 30 дней
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

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, { ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  }

  // РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ В БАЗУ users.json
  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 15 * 60 * 1000, max: 15, message: 'Слишком много попыток регистрации. Попробуйте позже.' }, pathname)) return;
    const body = await readBody(req);
    const name = trimmed(body.name, 60);
    const email = trimmed(body.email, 120).toLowerCase();
    const password = String(body.password || '');
    const role = ['parent', 'teen'].includes(body.role) ? body.role : 'parent';

    if (name.length < 2) return sendJSON(res, 400, { error: 'Имя должно содержать минимум 2 символа.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 400, { error: 'Введите корректный E-mail.' });
    if (password.length < 6) return sendJSON(res, 400, { error: 'Пароль должен быть не менее 6 символов.' });

    const result = await mutateStore('users.json', (users) => {
      if (users.some((u) => u.email === email)) {
        return { skipSave: true, value: { error: 'Пользователь с таким E-mail уже зарегистрирован.' } };
      }
      const newUser = {
        id: crypto.randomUUID(),
        name,
        email,
        role,
        passwordHash: hashPassword(password),
        createdAt: nowISO()
      };
      users.push(newUser);
      return { value: { user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } } };
    });

    if (result.error) return sendJSON(res, 409, { error: result.error });
    const token = createAuthToken(result.user);
    return sendJSON(res, 201, { ok: true, token, user: result.user });
  }

  // ВХОД В АККАУНТ
  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 15 * 60 * 1000, max: 20, message: 'Слишком много попыток входа. Подождите немного.' }, pathname)) return;
    const body = await readBody(req);
    const email = trimmed(body.email, 120).toLowerCase();
    const password = String(body.password || '');

    const users = await readStore('users.json');
    const found = users.find((u) => u.email === email);
    if (!found || !verifyPassword(password, found.passwordHash)) {
      return sendJSON(res, 401, { error: 'Неверный E-mail или пароль.' });
    }

    const safeUser = { id: found.id, name: found.name, email: found.email, role: found.role || 'parent' };
    const token = createAuthToken(safeUser);
    return sendJSON(res, 200, { ok: true, token, user: safeUser });
  }

  // ПРОВЕРКА ТЕКУЩЕЙ СЕССИИ АККАУНТА
  if (pathname === '/api/auth/me' && method === 'GET') {
    const tokenData = verifyAuthToken(req);
    if (!tokenData) return sendJSON(res, 401, { error: 'Не авторизован' });
    const users = await readStore('users.json');
    const found = users.find((u) => u.id === tokenData.id);
    if (!found) {
      return sendJSON(res, 200, { user: { id: tokenData.id, name: tokenData.name, email: tokenData.email, role: tokenData.role } });
    }
    return sendJSON(res, 200, { user: { id: found.id, name: found.name, email: found.email, role: found.role || 'parent' } });
  }

  // ОТЗЫВЫ
  if (pathname === '/api/reviews' && method === 'GET') {
    const reviews = await readStore('reviews.json');
    const visible = reviews.filter((r) => !r.hidden).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, { reviews: visible });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    const body = await readBody(req);
    const name = trimmed(body.name, 60);
    const email = trimmed(body.email, 100);
    const text = trimmed(body.text, 1200);
    const rating = Number(body.rating) || 5;
    if (name.length < 2 || text.length < 5) return sendJSON(res, 400, { error: 'Заполните имя и текст отзыва.' });
    const review = { id: crypto.randomUUID(), name, email, text, rating, createdAt: nowISO(), hidden: false };
    await mutateStore('reviews.json', (reviews) => { reviews.push(review); return { value: null }; });
    return sendJSON(res, 201, { ok: true, review });
  }

  // ЗАЯВКИ К ПСИХОЛОГУ
  if (pathname === '/api/psych-requests' && method === 'POST') {
    const body = await readBody(req);
    const name = trimmed(body.name, 60);
    const contact = trimmed(body.contact, 160);
    const note = trimmed(body.note, 1600);
    const specialty = trimmed(body.specialty, 100) || 'Психологическая поддержка';
    const purpose = ['appointment', 'message'].includes(body.purpose) ? body.purpose : 'appointment';
    if (name.length < 2 || contact.length < 4) return sendJSON(res, 400, { error: 'Укажите имя и контакт для связи.' });
    const requestItem = { id: crypto.randomUUID(), name, contact, note, specialty, purpose, createdAt: nowISO(), status: 'new' };
    await mutateStore('requests.json', (requests) => { requests.push(requestItem); return { value: null }; });
    return sendJSON(res, 201, { ok: true, message: 'Заявка успешно сохранена в базе! Специалист свяжется с вами.' });
  }

  // ИИ-ЧАТ С АВТОМАТИЧЕСКИМ ПЕРЕКЛЮЧЕНИЕМ МОДЕЛЕЙ ПРИ ПЕРЕГРУЗКЕ 503
  if (pathname === '/api/chat' && method === 'POST') {
    const body = await readBody(req);
    const message = trimmed(body.message, 4000);
    const mode = trimmed(body.mode, 100) || 'slang';
    if (!message) return sendJSON(res, 400, { error: 'Напишите вопрос.' });

    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey) {
      return sendJSON(res, 503, { error: 'GEMINI_API_KEY не найден в настройках Environment на Render.' });
    }

    const systemInstruction = [
      'Ты — живой, умный семейный ИИ-медиатор и переводчик молодёжного сленга платформы LinguaBridge Family («Мост поколений»).',
      'Твоя задача — помогать родителям и подросткам понимать друг друга.',
      'Если спрашивают про сленг (пивозавр, скуф, имба, кринж и т.д.): объясни смысл, обидно ли это, и дай 2-3 готовые фразы для ответа с добрым юмором.',
      'Если вопрос о семейной психологии — дай тёплый практический совет и готовые фразы для диалога.',
      `Текущий режим: ${mode}. Отвечай на русском языке, живо, дружелюбно и по делу.`
    ].join('\n');

    const history = Array.isArray(body.history)
      ? body.history.slice(-8).filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      : [];

    const contents = history.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: trimmed(item.content, 3000) }]
    }));

    if (!contents.length || contents[contents.length - 1].parts[0].text !== message) {
      contents.push({ role: 'user', parts: [{ text: message }] });
    }

    // Список резервных моделей на случай перегрузки 503 одной из них
    const modelsToTry = Array.from(new Set([
      GEMINI_MODEL,
      'gemini-3.8-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash'
    ]));

    let lastError = 'Сервер ИИ временно перегружен.';
    for (const modelName of modelsToTry) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const providerResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
          }),
          signal: AbortSignal.timeout(35000)
        });

        const payload = await providerResponse.json().catch(() => ({}));
        if (providerResponse.ok) {
          const reply = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() || '';
          if (reply) return sendJSON(res, 200, { reply, modelUsed: modelName });
        } else {
          lastError = `Ошибка API (${providerResponse.status}): ${payload?.error?.message || 'попробуйте ещё раз'}`;
          // Если ошибка не 503 и не 404 — прекращаем перебор
          if (providerResponse.status !== 503 && providerResponse.status !== 404 && providerResponse.status !== 429) break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    return sendJSON(res, 502, { error: lastError });
  }

  return sendJSON(res, 404, { error: 'API-метод не найден.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Метод не поддерживается.' }, { Allow: 'GET, HEAD' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return sendJSON(res, 400, { error: 'Некорректный путь.' }); }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return sendJSON(res, 403, { error: 'Доступ запрещён.' });
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return sendJSON(res, 404, { error: 'Страница не найдена.' });
    const body = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJSON(res, 404, { error: 'Страница не найдена.' });
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    if (error.status === 413) return sendJSON(res, 413, { error: 'Запрос слишком большой.' });
    if (error.status === 400) return sendJSON(res, 400, { error: 'Некорректный JSON в запросе.' });
    console.error('Server error:', error.name, error.message);
    if (!res.headersSent) return sendJSON(res, 500, { error: 'Внутренняя ошибка сервера.' });
    res.end();
  }
});

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureFile('users.json', []);
  await ensureFile('reviews.json', []);
  await ensureFile('requests.json', []);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Lingua Bridge Family is running at http://localhost:${PORT}`);
  });
}

start().catch((error) => { console.error('Failed to start server:', error); process.exit(1); });
