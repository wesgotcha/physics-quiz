const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'physics_quiz_db.json');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readDb() {
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

async function writeDb(db) {
  validateDb(db);
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, DATA_FILE);
}

function validateDb(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw Object.assign(new Error('DB must be an object'), { status: 400 });
  for (const [chapterId, chapter] of Object.entries(db)) {
    if (!chapter || typeof chapter !== 'object') throw Object.assign(new Error(`Chapter ${chapterId} must be an object`), { status: 400 });
    if (typeof chapter.name !== 'string') throw Object.assign(new Error(`Chapter ${chapterId} name must be a string`), { status: 400 });
    if (!Array.isArray(chapter.questions)) throw Object.assign(new Error(`Chapter ${chapterId} questions must be an array`), { status: 400 });
    chapter.questions.forEach((question, index) => validateQuestion(question, `${chapterId}.${index + 1}`));
  }
}

function validateQuestion(question, label = 'question') {
  if (!question || typeof question !== 'object') throw Object.assign(new Error(`${label} must be an object`), { status: 400 });
  if (typeof question.q !== 'string') throw Object.assign(new Error(`${label}.q must be a string`), { status: 400 });
  if (!question.opts || typeof question.opts !== 'object') throw Object.assign(new Error(`${label}.opts must be an object`), { status: 400 });
  for (const key of ['A', 'B', 'C', 'D']) {
    if (typeof question.opts[key] !== 'string') throw Object.assign(new Error(`${label}.opts.${key} must be a string`), { status: 400 });
  }
  if (!['A', 'B', 'C', 'D'].includes(question.ans)) throw Object.assign(new Error(`${label}.ans must be A, B, C, or D`), { status: 400 });
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/api/db') {
    return sendJson(res, 200, await readDb());
  }

  if (req.method === 'PUT' && url.pathname === '/api/db') {
    const db = JSON.parse(await readBody(req));
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/chapters') {
    const db = await readDb();
    return sendJson(res, 200, Object.entries(db).map(([id, chapter]) => ({
      id,
      name: chapter.name,
      questionCount: chapter.questions.length,
    })));
  }

  if (segments[0] === 'api' && segments[1] === 'chapters' && segments[3] === 'questions') {
    const chapterId = segments[2];
    const questionNo = segments[4] ? Number(segments[4]) : null;
    const db = await readDb();
    const chapter = db[chapterId];
    if (!chapter) return sendJson(res, 404, { error: 'Chapter not found' });

    if (req.method === 'GET' && !questionNo) {
      return sendJson(res, 200, chapter.questions);
    }

    if (req.method === 'POST' && !questionNo) {
      const question = JSON.parse(await readBody(req));
      validateQuestion(question);
      chapter.questions.push(question);
      await writeDb(db);
      return sendJson(res, 201, { ok: true, questionNo: chapter.questions.length });
    }

    if (!Number.isInteger(questionNo) || questionNo < 1 || questionNo > chapter.questions.length) {
      return sendJson(res, 404, { error: 'Question not found' });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, chapter.questions[questionNo - 1]);
    }

    if (req.method === 'PUT') {
      const question = JSON.parse(await readBody(req));
      validateQuestion(question);
      chapter.questions[questionNo - 1] = question;
      await writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      chapter.questions.splice(questionNo - 1, 1);
      await writeDb(db);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'API route not found' });
}

async function serveStatic(req, res, url) {
  const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');

  try {
    const file = await fs.readFile(filePath);
    send(res, 200, file, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Physics quiz server running at http://localhost:${PORT}`);
  console.log(`Database file: ${DATA_FILE}`);
});
