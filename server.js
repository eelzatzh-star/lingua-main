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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.ADMIN_TOKEN || process.env.GEMINI_API_KEY || 'linguabridge-secret-key-2026';
const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || '').trim().replace(/\/+$/, '');

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

// ЧТЕНИЕ ИЗ ОБЛАЧНОЙ БАЗЫ FIREBASE (ИЛИ ЛОКАЛЬНОГО ФАЙЛА, ЕСЛИ FIREBASE НЕ ПОДКЛЮЧЁН)
async function readStore(filename) {
  if (FIREBASE_DB_URL) {
    const key = filename.replace(/\.json$/i, '');
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/${encodeURIComponent(key)}.json`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const parsed = await res.json();
        if (!parsed) return [];
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
        if (typeof parsed === 'object') return Object.values(parsed).filter(Boolean);
        return [];
      }
    } catch (err) {
      console.error(`Firebase read error (${filename}):`, err.message);
    }
  }
  await ensureFile(filename, []);
  const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

// ЗАПИСЬ В ОБЛАЧНУЮ БАЗУ FIREBASE + ЛОКАЛЬНУЮ КОПИЮ
async function writeStore(filename, data) {
  const safeArray = Array.isArray(data) ? data : [];
  if (FIREBASE_DB_URL) {
    const key = filename.replace(/\.json$/i, '');
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/${encodeURIComponent(key)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safeArray),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        console.error(`Firebase write HTTP error (${filename}):`, res.status);
      }
    } catch (err) {
      console.error(`Firebase write failed (${filename}):`, err.message);
    }
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fullPath = path.join(DATA_DIR, filename);
  const tempPath = `${fullPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(safeArray, null, 2), { encoding: 'utf8', mode: 0o600 });
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

function adminAuthorized(req) {
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected) return { ok: false, status: 503, error: 'Административный доступ не настроен. Задайте ADMIN_TOKEN в Environment на Render.' };
  const auth = String(req.headers.authorization || '');
  const supplied = (auth.match(/^Bearer\s+(.+)$/i)?.[1] || '').trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  return valid ? { ok: true } : { ok: false, status: 401, error: 'Неверный административный токен.' };
}

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

const smtpReady = () => Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.CONTACT_NOTIFY_EMAIL && process.env.MAIL_FROM);

async function notifyAdmin(subject, text) {
  if (!smtpReady()) return false;
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM, to: process.env.CONTACT_NOTIFY_EMAIL, subject, text });
    return true;
  } finally { transporter.close(); }
}

async function handleAPI(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, {
      ok: true,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
      cloudDatabaseConfigured: Boolean(FIREBASE_DB_URL),
      emailNotificationsConfigured: smtpReady()
    });
  }

  // РЕГИСТРАЦИЯ
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

  // ВХОД
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

  // ПРОВЕРКА СЕССИИ
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

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return sendJSON(res, 200, { ok: true });
  }

  // ОТЗЫВЫ
  if (pathname === '/api/reviews' && method === 'GET') {
    const reviews = await readStore('reviews.json');
    const visible = reviews.filter((review) => !review.hidden).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, {
      reviews: visible.map(({ id, name, email, rating, text, createdAt }) => ({ id, name, email, rating, text, createdAt }))
    });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 60 * 60 * 1000, max: 12, message: 'Слишком много попыток. Попробуйте позже.' }, pathname)) return;
    const body = await readBody(req);
    if (trimmed(body.website, 200)) return sendJSON(res, 400, { error: 'Не удалось принять отзыв.' });
    const name = trimmed(body.name, 60);
    const email = trimmed(body.email, 100);
    const text = trimmed(body.text, 1200);
    const rating = Number(body.rating) || 5;
    if (name.length < 2) return sendJSON(res, 400, { error: 'Введите имя или роль (не менее 2 символов).' });
    if (text.length < 5) return sendJSON(res, 400, { error: 'Отзыв должен содержать не менее 5 символов.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return sendJSON(res, 400, { error: 'Выберите оценку от 1 до 5.' });
    const review = { id: crypto.randomUUID(), name, email, text, rating, createdAt: nowISO(), hidden: false };
    await mutateStore('reviews.json', (reviews) => { reviews.push(review); return { value: null }; });
    return sendJSON(res, 201, { ok: true, review: { id: review.id, name, email, text, rating, createdAt: review.createdAt } });
  }

  // ЗАЯВКИ К ПСИХОЛОГАМ
  if (pathname === '/api/psych-requests' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 60 * 60 * 1000, max: 10, message: 'Слишком много заявок с этого подключения. Попробуйте позже.' }, pathname)) return;
    const body = await readBody(req);
    if (trimmed(body.website, 200)) return sendJSON(res, 400, { error: 'Не удалось принять заявку.' });
    const name = trimmed(body.name, 60);
    const contact = trimmed(body.contact, 160);
    const note = trimmed(body.note, 1600);
    const specialty = trimmed(body.specialty, 100) || 'Психологическая поддержка';
    const purpose = ['appointment', 'message', 'details'].includes(body.purpose) ? body.purpose : 'appointment';
    if (name.length < 2) return sendJSON(res, 400, { error: 'Укажите имя (не менее 2 символов).' });
    if (contact.length < 4) return sendJSON(res, 400, { error: 'Укажите телефон, e-mail или Telegram для ответа.' });
    const requestItem = { id: crypto.randomUUID(), name, contact, note, specialty, purpose, createdAt: nowISO(), status: 'new' };
    await mutateStore('requests.json', (requests) => { requests.push(requestItem); return { value: null }; });
    let notified = false;
    try {
      const kind = purpose === 'message' ? 'Запрос на обратную связь' : 'Заявка на консультационную поддержку';
      notified = await notifyAdmin(`Lingua Bridge Family: ${kind}`, [kind, `Имя: ${name}`, `Контакт: ${contact}`, `Направление: ${specialty}`, `Время: ${requestItem.createdAt}`, `Сообщение: ${note || '(не указано)'}`, `ID заявки: ${requestItem.id}`].join('\n'));
    } catch (mailError) { console.error('Request saved, but email notification failed:', mailError.message); }
    return sendJSON(res, 201, {
      ok: true,
      notified,
      message: 'Заявка успешно сохранена! Специалист свяжется с вами по указанному контакту.'
    });
  }

  // ИИ-ЧАТ
  if (pathname === '/api/chat' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 10 * 60 * 1000, max: 30, message: 'Слишком много сообщений за короткое время. Попробуйте немного позже.' }, pathname)) return;
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
      'Если пользователь спрашивает значение сленгового слова или фразы (например, «пивозавр», «скуф», «имба», «нормис», «вайб» и т.д.):',
      '1) Сначала чётко и с добрым юмором объясни точное значение этого слова в молодёжной интернет-культуре и откуда оно пошло.',
      '2) Объясни, несёт ли оно обидный смысл или это просто шутка/мем.',
      '3) Приведи 2-3 готовые фразы, как родителю можно отреагировать спокойно или с самоиронией, чтобы укрепить контакт с ребёнком.',
      'Если вопрос касается семейного конфликта или психологии — дай тёплый, практичный разбор ситуации и конкретные фразы для диалога без нотаций.',
      `Текущий режим консультации: ${mode}. Отвечай на русском языке, живо, конкретно по сути вопроса пользователя.`
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

    const modelsToTry = Array.from(new Set([
      GEMINI_MODEL,
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash'
    ]));

    let lastError = 'Сервер ИИ временно перегружен. Попробуйте повторить запрос через пару секунд.';
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
          if (providerResponse.status !== 503 && providerResponse.status !== 404 && providerResponse.status !== 429) break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    return sendJSON(res, 502, { error: lastError });
  }

  // АДМИН-ПАНЕЛЬ
  if (pathname === '/api/admin/data' && method === 'GET') {
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const [requests, reviews, users] = await Promise.all([
      readStore('requests.json'),
      readStore('reviews.json'),
      readStore('users.json')
    ]);
    return sendJSON(res, 200, {
      requests: requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      reviews: reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      users: users.map(({ id, name, email, role, createdAt }) => ({ id, name, email, role, createdAt })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  }

  const requestMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (requestMatch && method === 'PATCH') {
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    if (!['new', 'contacted', 'closed'].includes(body.status)) return sendJSON(res, 400, { error: 'Недопустимый статус заявки.' });
    let found = false;
    await mutateStore('requests.json', (requests) => {
      const item = requests.find((entry) => entry.id === decodeURIComponent(requestMatch[1]));
      if (item) {
        item.status = body.status;
        item.updatedAt = nowISO();
        found = true;
      }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Заявка не найдена.' });
  }

  const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'PATCH') {
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    if (typeof body.hidden !== 'boolean') return sendJSON(res, 400, { error: 'Укажите hidden: true или false.' });
    let found = false;
    await mutateStore('reviews.json', (reviews) => {
      const item = reviews.find((entry) => entry.id === decodeURIComponent(reviewMatch[1]));
      if (item) {
        item.hidden = body.hidden;
        found = true;
      }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Отзыв не найден.' });
  }

  if (reviewMatch && method === 'DELETE') {
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    let found = false;
    await mutateStore('reviews.json', (reviews) => {
      const idx = reviews.findIndex((entry) => entry.id === decodeURIComponent(reviewMatch[1]));
      if (idx >= 0) {
        reviews.splice(idx, 1);
        found = true;
      }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Отзыв не найден.' });
  }

  return sendJSON(res, 404, { error: 'API-метод не найден.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { error: 'Метод не поддерживается.' }, { Allow: 'GET, HEAD' });
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return sendJSON(res, 400, { error: 'Некорректный путь.' }); }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJSON(res, 403, { error: 'Доступ запрещён.' });
  }
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
    if (FIREBASE_DB_URL) console.log('Connected to permanent Firebase Realtime Database.');
    else console.warn('FIREBASE_DB_URL is not set. Using temporary local storage.');
  });
}

start().catch((error) => { console.error('Failed to start server:', error); process.exit(1); });
