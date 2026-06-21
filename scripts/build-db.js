const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKDOWN_FILE = path.join(ROOT, 'data', 'physics_quiz_db.md');
const DATA_JSON_FILE = path.join(ROOT, 'data', 'physics_quiz_db.json');
const PUBLIC_JSON_FILE = path.join(ROOT, 'public', 'data', 'physics_quiz_db.json');

function fail(lineNo, message) {
  const prefix = lineNo ? `Line ${lineNo}: ` : '';
  throw new Error(prefix + message);
}

function parseMarkdownDb(markdown) {
  const db = {};
  const lines = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let currentChapter = null;
  let currentQuestion = null;
  let currentField = null;

  function finishQuestion(lineNo) {
    if (!currentQuestion) return;
    if (!currentChapter) fail(lineNo, 'Question appears before any chapter');
    const question = {
      q: (currentQuestion.q || '').trim(),
      opts: {
        A: (currentQuestion.opts.A || '').trim(),
        B: (currentQuestion.opts.B || '').trim(),
        C: (currentQuestion.opts.C || '').trim(),
        D: (currentQuestion.opts.D || '').trim(),
      },
      ans: (currentQuestion.ans || '').trim().toUpperCase(),
    };
    currentChapter.questions.push(question);
    currentQuestion = null;
    currentField = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed === '---' || trimmed.startsWith('<!--')) continue;
    if (trimmed.startsWith('# ') || trimmed.startsWith('> ')) continue;

    const chapterMatch = /^##\s+([^\s.]+)\.\s*(.+)$/.exec(trimmed);
    if (chapterMatch) {
      finishQuestion(lineNo);
      const chapterId = chapterMatch[1];
      if (db[chapterId]) fail(lineNo, `Duplicate chapter id: ${chapterId}`);
      currentChapter = { name: chapterMatch[2].trim(), questions: [] };
      db[chapterId] = currentChapter;
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      finishQuestion(lineNo);
      if (!currentChapter) fail(lineNo, 'Question appears before any chapter');
      currentQuestion = { q: '', opts: {}, ans: '' };
      currentField = null;
      continue;
    }

    if (!currentQuestion) fail(lineNo, 'Expected a chapter heading or question heading');

    const questionMatch = /^Q:\s*(.*)$/.exec(line);
    if (questionMatch) {
      currentQuestion.q = questionMatch[1];
      currentField = 'q';
      continue;
    }

    const optionMatch = /^([A-D])\.\s*(.*)$/.exec(line);
    if (optionMatch) {
      currentQuestion.opts[optionMatch[1]] = optionMatch[2];
      currentField = optionMatch[1];
      continue;
    }

    const answerMatch = /^Answer:\s*([A-Da-d])\s*$/.exec(trimmed);
    if (answerMatch) {
      currentQuestion.ans = answerMatch[1].toUpperCase();
      currentField = 'ans';
      continue;
    }

    if (currentField && currentField !== 'ans') {
      if (currentField === 'q') currentQuestion.q += `\n${line}`;
      else currentQuestion.opts[currentField] += `\n${line}`;
      continue;
    }

    fail(lineNo, 'Unrecognized question line');
  }

  finishQuestion(lines.length);
  validateDb(db);
  return db;
}

function validateDb(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) fail(null, 'DB must be an object');
  for (const [chapterId, chapter] of Object.entries(db)) {
    if (!chapter || typeof chapter !== 'object') fail(null, `Chapter ${chapterId} must be an object`);
    if (!chapter.name) fail(null, `Chapter ${chapterId} name is required`);
    if (!Array.isArray(chapter.questions)) fail(null, `Chapter ${chapterId} questions must be an array`);
    chapter.questions.forEach((question, index) => {
      const label = `${chapterId}.${index + 1}`;
      if (!question.q) fail(null, `${label}.q is required`);
      validateText(question.q, `${label}.q`);
      for (const key of ['A', 'B', 'C', 'D']) {
        if (!question.opts[key]) fail(null, `${label}.opts.${key} is required`);
        validateText(question.opts[key], `${label}.opts.${key}`);
      }
      if (!['A', 'B', 'C', 'D'].includes(question.ans)) fail(null, `${label}.ans must be A, B, C, or D`);
    });
  }
}

function validateText(text, label) {
  if (/[\u25a1\ufffd\ufffc]/u.test(text)) fail(null, `${label} contains an OCR placeholder character`);
  if (/[锛绗]/u.test(text)) fail(null, `${label} looks like mojibake, not UTF-8 text`);
  assertBalanced(text, label, /\\\(/g, /\\\)/g, 'inline LaTeX delimiters');
  assertBalanced(text, label, /\\\[/g, /\\\]/g, 'display LaTeX delimiters');
  const dollars = (text.match(/(?<!\\)\$\$/g) || []).length;
  if (dollars % 2 !== 0) fail(null, `${label} has unbalanced $$ display LaTeX delimiters`);
}

function assertBalanced(text, label, openPattern, closePattern, description) {
  const open = (text.match(openPattern) || []).length;
  const close = (text.match(closePattern) || []).length;
  if (open !== close) fail(null, `${label} has unbalanced ${description}`);
}

async function main() {
  const markdown = await fs.readFile(MARKDOWN_FILE, 'utf8');
  const db = parseMarkdownDb(markdown);
  const json = `${JSON.stringify(db, null, 2)}\n`;
  JSON.parse(json);

  await fs.mkdir(path.dirname(PUBLIC_JSON_FILE), { recursive: true });
  await fs.writeFile(DATA_JSON_FILE, json, 'utf8');
  await fs.writeFile(PUBLIC_JSON_FILE, json, 'utf8');

  const chapterCount = Object.keys(db).length;
  const questionCount = Object.values(db).reduce((sum, chapter) => sum + chapter.questions.length, 0);
  console.log(`Built ${questionCount} questions in ${chapterCount} chapter(s).`);
  console.log(`Wrote ${path.relative(ROOT, DATA_JSON_FILE)}`);
  console.log(`Wrote ${path.relative(ROOT, PUBLIC_JSON_FILE)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
