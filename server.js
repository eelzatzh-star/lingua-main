'use strict';

// The server uses Node.js built-ins. Nodemailer is optional and used only for SMTP notifications.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* Website/API still works; email notification stays disabled. */ }

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
  } catch { /* .env is optional. Environment variables can be provided by the host. */ }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
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
    return sendJSON(res, 200, { ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), emailNotificationsConfigured: smtpReady() });
  }

  if (pathname === '/api/reviews' && method === 'GET') {
    const reviews = await readStore('reviews.json');
    const visible = reviews.filter((review) => !review.hidden).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, { reviews: visible.map(({ id, name, rating, text, createdAt }) => ({ id, name, rating, text, createdAt })) });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 60 * 60 * 1000, max: 8, message: 'Слишком много попыток. Попробуйте позже.' }, pathname)) return;
    const body = await readBody(req);
    if (trimmed(body.website, 200)) return sendJSON(res, 400, { error: 'Не удалось принять отзыв.' });
    const name = trimmed(body.name, 50);
    const text = trimmed(body.text, 1200);
    const rating = Number(body.rating);
    if (name.length < 2) return sendJSON(res, 400, { error: 'Введите имя или роль (не менее 2 символов).' });
    if (text.length < 8) return sendJSON(res, 400, { error: 'Отзыв должен содержать не менее 8 символов.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return sendJSON(res, 400, { error: 'Выберите оценку от 1 до 5.' });
    const review = { id: crypto.randomUUID(), name, text, rating, createdAt: nowISO(), hidden: false };
    await mutateStore('reviews.json', (reviews) => { reviews.push(review); return { value: null }; });
    return sendJSON(res, 201, { ok: true, review: { id: review.id, name, text, rating, createdAt: review.createdAt } });
  }

  if (pathname === '/api/psych-requests' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 60 * 60 * 1000, max: 5, message: 'Слишком много заявок с этого подключения. Попробуйте позже.' }, pathname)) return;
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
      ok: true, notified,
      message: notified
        ? 'Заявка сохранена, и администратор проекта получил уведомление. Запись к психологу ещё нужно подтвердить.'
        : 'Заявка сохранена на сервере. Координатору нужно обработать её в административном разделе; запись к психологу пока не подтверждена.'
    });
  }

  if (pathname === '/api/chat' && method === 'POST') {
    if (!setRateLimit(req, res, { windowMs: 10 * 60 * 1000, max: 18, message: 'Слишком много сообщений за короткое время. Попробуйте немного позже.' }, pathname)) return;
    const body = await readBody(req);
    const message = trimmed(body.message, 4000);
    if (!message) return sendJSON(res, 400, { error: 'Напишите вопрос.' });
    if (!process.env.OPENAI_API_KEY) return sendJSON(res, 503, { error: 'ИИ-помощник не подключён: администратору нужно настроить OPENAI_API_KEY на сервере.' });
    const history = Array.isArray(body.history)
      ? body.history.slice(-12).filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item) => ({ role: item.role, content: trimmed(item.content, 4000) })).filter((item) => item.content)
      : [];
    const input = history.length && history[history.length - 1].role === 'user' ? history : [...history, { role: 'user', content: message }].slice(-12);
    const instructions = [
      'Ты — AI-помощник образовательного проекта Lingua Bridge Family. Помогаешь родителям и подросткам лучше понимать друг друга.',
      'Отвечай на русском языке, спокойно, уважительно, понятно и практически. Не принимай сторону родителя или подростка автоматически.',
      'Сначала кратко отрази суть ситуации. Затем предложи 2–4 конкретные фразы, которые можно произнести, и один или два открытых вопроса.',
      'Не ставь диагнозы, не представляй себя лицензированным психологом, не обещай конфиденциальность сверх настроек сервиса. Ответ — общая поддержка, а не замена профессиональной помощи.',
      'Не поддерживай насилие, унижение, слежку или принуждение. Учитывай возраст и безопасность подростка. При непосредственной угрозе жизни, насилии или риске самоповреждения предложи немедленно обратиться к местным экстренным службам и доверенному взрослому/специалисту.',
      'Не проси сообщать фамилии, адреса, телефоны, пароли или другие лишние персональные данные. Если информации мало, задай один уточняющий вопрос, но всё равно дай полезный первый шаг.',
      'Не выдумывай факты о семье и не утверждай, что действия/запись уже произошли. Форматируй ответ обычным текстом с короткими абзацами и нумерованными шагами, если уместно.'
    ].join('\n');
    let providerResponse;
    try {
      providerResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AI_MODEL, instructions, input, max_output_tokens: 750, store: false }),
        signal: AbortSignal.timeout(50000)
      });
    } catch (error) {
      console.error('AI connection failed:', error.name, error.message);
      return sendJSON(res, 502, { error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Ответ занял слишком много времени. Попробуйте ещё раз.' : 'Не удалось подключиться к сервису ИИ. Проверьте соединение и настройки сервера.' });
    }
    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      console.error(`AI provider returned ${providerResponse.status}:`, payload?.error?.message || 'Unknown provider error');
      if (providerResponse.status === 401 || providerResponse.status === 403) return sendJSON(res, 502, { error: 'ИИ-помощник недоступен: проверьте API-ключ и права доступа на сервере.' });
      if (providerResponse.status === 429) return sendJSON(res, 503, { error: 'Сервис ИИ временно ограничил запросы. Попробуйте позже.' });
      return sendJSON(res, 502, { error: 'Сервис ИИ не смог обработать запрос. Проверьте выбранную модель в настройках сервера.' });
    }
    let reply = typeof payload.output_text === 'string' ? payload.output_text.trim() : '';
    if (!reply && Array.isArray(payload.output)) {
      reply = payload.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).filter((part) => part.type === 'output_text' && typeof part.text === 'string').map((part) => part.text).join('\n').trim();
    }
    if (!reply) return sendJSON(res, 502, { error: 'ИИ вернул пустой ответ. Попробуйте переформулировать вопрос.' });
    return sendJSON(res, 200, { reply });
  }

  if (pathname === '/api/admin/data' && method === 'GET') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const [requests, reviews] = await Promise.all([readStore('requests.json'), readStore('reviews.json')]);
    return sendJSON(res, 200, { requests: requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), reviews: reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  }

  const requestMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (requestMatch && method === 'PATCH') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    if (!['new', 'contacted', 'closed'].includes(body.status)) return sendJSON(res, 400, { error: 'Недопустимый статус заявки.' });
    let found = false;
    await mutateStore('requests.json', (requests) => {
      const item = requests.find((entry) => entry.id === decodeURIComponent(requestMatch[1]));
      if (item) { item.status = body.status; item.updatedAt = nowISO(); found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Заявка не найдена.' });
  }

  const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'PATCH') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    const body = await readBody(req);
    if (typeof body.hidden !== 'boolean') return sendJSON(res, 400, { error: 'Укажите hidden: true или false.' });
    let found = false;
    await mutateStore('reviews.json', (reviews) => {
      const item = reviews.find((entry) => entry.id === decodeURIComponent(reviewMatch[1]));
      if (item) { item.hidden = body.hidden; found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Отзыв не найден.' });
  }

  if (reviewMatch && method === 'DELETE') {
    const auth = adminAuthorized(req); if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });
    let found = false;
    await mutateStore('reviews.json', (reviews) => {
      const idx = reviews.findIndex((entry) => entry.id === decodeURIComponent(reviewMatch[1]));
      if (idx >= 0) { reviews.splice(idx, 1); found = true; }
      return { value: null };
    });
    return found ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'Отзыв не найден.' });
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': process.env.NODE_ENV === 'production' ? 'public, max-age=3600' : 'no-store', 'Content-Length': body.length });
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
  await ensureFile('reviews.json', []);
  await ensureFile('requests.json', []);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Lingua Bridge Family is running at http://localhost:${PORT}`);
    if (!process.env.OPENAI_API_KEY) console.warn('OPENAI_API_KEY is not set. Add it to .env to enable real AI replies.');
    if (!process.env.ADMIN_TOKEN) console.warn('ADMIN_TOKEN is not set. Configure it to use /admin.html.');
    if (!smtpReady()) console.warn('Email notifications are not configured. Requests will remain available in /admin.html.');
  });
}

start().catch((error) => { console.error('Failed to start server:', error); process.exit(1); });
