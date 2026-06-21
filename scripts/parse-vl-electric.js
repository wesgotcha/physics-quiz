const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_FILE = path.join(ROOT, 'tmp', 'paddleocr_vl', 'electric', 'raw_pages.json');
const OUT_MD = path.join(ROOT, 'data', 'physics_quiz_db_electric.md');
const OUT_JSON = path.join(ROOT, 'data', 'physics_quiz_db_electric.json');
const REPORT_FILE = path.join(ROOT, 'tmp', 'paddleocr_vl', 'electric', 'parse_report.json');
const IMAGE_NOTE = '（图题，以原 PDF 图为准）';

const SUPER = new Map(Object.entries({
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁻': '-', '⁺': '+',
}));
const SUB = new Map(Object.entries({
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₋': '-', '₊': '+',
}));

function fail(message) {
  throw new Error(message);
}

function normalizeMathGlyphs(text) {
  let out = String(text || '');
  out = out.replace(/<!--[\s\S]*?-->/g, '\n');
  out = out.replace(/<div[^>]*>/gi, '\n').replace(/<\/div>/gi, '\n');
  out = out.replace(/<img[^>]*>/gi, '（图题，以原 PDF 图为准）');
  out = out.replace(/&nbsp;/g, ' ');
  out = out.replace(/[Ａ-Ｄ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  out = out.replace(/([A-Za-z])\u20d7/g, (_, name) => `\\(\\vec ${name}\\)`);
  out = out.replace(/([A-Za-z])\s*→/g, (_, name) => `\\(\\vec ${name}\\)`);
  out = out.replace(/Φ\s*e/g, '\\(\\Phi_e\\)');
  out = out.replace(/Φ\s*m/g, '\\(\\Phi_m\\)');
  out = out.replace(/ε\s*0/g, '\\(\\varepsilon_0\\)');
  out = out.replace(/μ\s*0/g, '\\(\\mu_0\\)');
  out = out.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => `^{${[...m].map((c) => SUPER.get(c)).join('')}}`);
  out = out.replace(/[₀₁₂₃₄₅₆₇₈₉₋₊]+/g, (m) => `_{${[...m].map((c) => SUB.get(c)).join('')}}`);
  out = out.replace(/[－–—]/g, '-');
  out = out.replace(/[（(]\s*([A-D])\s*[）)]/g, '($1)');
  out = out.replace(/\r\n?/g, '\n');
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function extractChapter(rawPages) {
  const joined = rawPages.map((page) => `\n<!-- PDF page ${page.pdf_page} -->\n${page.markdown}`).join('\n');
  const normalized = normalizeMathGlyphs(joined);
  const start = normalized.search(/第七章\s*[：:]\s*静电场/);
  if (start < 0) fail('Cannot find chapter 7 heading: 第七章：静电场');
  const afterStart = normalized.slice(start);
  const end = afterStart.search(/\n\s*#{0,3}\s*第八章\s*[：:]/);
  return end >= 0 ? afterStart.slice(0, end) : afterStart;
}

function findQuestionMatches(text) {
  const matches = [];
  const re = /^(\d{1,2})\\?[.．、]\s*([\s\S]*?)(?=^\d{1,2}\\?[.．、]\s*|(?![\s\S]))/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({ number: Number(match[1]), chunk: `${match[1]}. ${match[2]}`.trim() });
  }
  return matches;
}

function findOptionMarkers(body) {
  const markers = [];
  const firstBreak = body.indexOf('\n');
  const offset = firstBreak >= 0 ? firstBreak : 0;
  const optionArea = body.slice(offset);
  const lineRe = /(^|[\s\n])\(([A-D])\)\s*/g;
  let match;
  while ((match = lineRe.exec(optionArea)) !== null) {
    let markerStart = offset + match.index + match[1].length;
    let contentStart = offset + match.index + match[0].length;
    const adjusted = adjustDisplayMathMarker(body, markerStart, contentStart);
    markerStart = adjusted.markerStart;
    contentStart = adjusted.contentStart;
    markers.push({
      key: match[2],
      markerStart,
      contentStart,
    });
  }
  if (markers.length >= 4) return markers;
  return inferFormulaOptionMarkers(body, markers);
}

function adjustDisplayMathMarker(body, markerStart, contentStart) {
  const before = body.slice(0, markerStart);
  const dollarCount = (before.match(/(?<!\\)\$\$/g) || []).length;
  if (dollarCount % 2 === 0) return { markerStart, contentStart };
  const open = before.lastIndexOf('$$');
  return { markerStart: open, contentStart: open };
}

function inferFormulaOptionMarkers(body, markers) {
  if (markers.length >= 4 || markers.length < 2) return markers;
  const last = markers[markers.length - 1];
  const tail = body.slice(last.contentStart);
  const formulaMatches = [...tail.matchAll(/\$\$[\s\S]*?\$\$/g)];
  const needed = 4 - markers.length;
  if (formulaMatches.length < needed + 1) return markers;

  const keys = ['A', 'B', 'C', 'D'];
  const inferred = [...markers];
  for (let i = 1; inferred.length < 4; i += 1) {
    const formula = formulaMatches[i];
    inferred.push({
      key: keys[inferred.length],
      markerStart: last.contentStart + formula.index,
      contentStart: last.contentStart + formula.index,
    });
  }
  return inferred;
}

function parseQuestion(match) {
  const body = match.chunk.replace(/^\d{1,2}\\?[.．、]\s*/, '').trim();
  const optionMarkers = findOptionMarkers(body);
  if (optionMarkers.length < 4) {
    return {
      error: `question ${match.number}: expected 4 options, got ${optionMarkers.length}`,
      fallbackAnswer: extractAnswer(body),
      fallbackStem: cleanAnswerBlank(body.replace(/\s+/g, ' ').trim()),
    };
  }

  let stem = body.slice(0, optionMarkers[0].markerStart).trim();
  const answer = extractAnswer(stem);
  stem = cleanAnswerBlank(stem).replace(/\s+/g, ' ').trim();

  const opts = {};
  for (let i = 0; i < 4; i += 1) {
    const marker = optionMarkers[i];
    const next = optionMarkers[i + 1];
    opts[marker.key] = body.slice(marker.contentStart, next ? next.markerStart : body.length)
      .trim()
      .replace(/\s+/g, ' ');
  }
  const cleanedOpts = {
    A: cleanField(opts.A),
    B: cleanField(opts.B),
    C: cleanField(opts.C),
    D: cleanField(opts.D),
  };
  const hasImageNote = Object.values(cleanedOpts).some((value) => value.includes(IMAGE_NOTE));
  for (const key of ['A', 'B', 'C', 'D']) {
    cleanedOpts[key] = stripImageTail(cleanedOpts[key]);
  }
  let questionText = cleanField(stem);
  if (hasImageNote && !questionText.includes(IMAGE_NOTE)) questionText += ` ${IMAGE_NOTE}`;

  return {
    number: match.number,
    question: {
      q: questionText,
      opts: cleanedOpts,
      ans: answer,
    },
  };
}

function extractAnswer(text) {
  const match = String(text || '').match(/\(([A-D])\)|\\text\{([A-D])\}/);
  return match ? (match[1] || match[2]) : '';
}

function cleanAnswerBlank(text) {
  return String(text || '')
    .replace(/\(\s*\\text\{[A-D]\}\s*\)/, '（ ）')
    .replace(/\(([A-D])\)/, '（ ）');
}

function cleanField(text) {
  return normalizeMathGlyphs(text)
    .replace(/^\$\$\s*\([A-D]\)\s*/, () => '$$ ')
    .replace(/^[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripImageTail(text) {
  return String(text || '').replace(new RegExp(`\\s*${escapeRegExp(IMAGE_NOTE)}[\\s\\S]*$`), '').trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateText(text, label, warnings) {
  if (/[\u25a1\ufffd\ufffc]/u.test(text)) fail(`${label} contains OCR placeholder characters`);
  if (/[锛绗]/u.test(text)) fail(`${label} looks like mojibake, not UTF-8 text`);
  assertBalanced(text, label, /\\\(/g, /\\\)/g, 'inline LaTeX delimiters');
  assertBalanced(text, label, /\\\[/g, /\\\]/g, 'display LaTeX delimiters');
  const dollars = (text.match(/(?<!\\)\$\$/g) || []).length;
  if (dollars % 2 !== 0) fail(`${label} has unbalanced $$ display LaTeX delimiters: ${text.slice(0, 160)}`);
  if (/[\u20d7→]/u.test(text)) warnings.push(`${label}: unresolved vector arrow glyph`);
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/u.test(text)) warnings.push(`${label}: unresolved unicode super/subscript`);
}

function assertBalanced(text, label, openPattern, closePattern, description) {
  const open = (text.match(openPattern) || []).length;
  const close = (text.match(closePattern) || []).length;
  if (open !== close) fail(`${label} has unbalanced ${description}`);
}

function validateChapter(chapter) {
  const warnings = [];
  if (chapter.questions.length !== 63) {
    warnings.push(`expected 63 questions for chapter 7, got ${chapter.questions.length}`);
  }
  chapter.questions.forEach((question, index) => {
    const label = `7.${index + 1}`;
    if (!question.q) fail(`${label}.q is empty`);
    validateText(question.q, `${label}.q`, warnings);
    for (const key of ['A', 'B', 'C', 'D']) {
      if (!question.opts[key]) fail(`${label}.opts.${key} is empty`);
      validateText(question.opts[key], `${label}.opts.${key}`, warnings);
    }
    if (!/^[A-D]$/.test(question.ans)) warnings.push(`${label}: missing answer from OCR text`);
  });
  return warnings;
}

function toMarkdown(chapter) {
  const lines = [
    '# Physics Quiz Database - Electric Draft',
    '',
    '> Source: PaddleOCR-VL-1.6 extraction from tmp/试题库：_大学物理C—选择.pdf, PDF pages 36-49.',
    '> Formula style: use explicit LaTeX delimiters. Build output is produced with JSON.stringify and validated with JSON.parse.',
    '',
    '## 7. 第七章：静电场',
    '',
  ];
  chapter.questions.forEach((question, index) => {
    lines.push(`### ${index + 1}`);
    lines.push(`Q: ${question.q}`);
    lines.push(`A. ${question.opts.A}`);
    lines.push(`B. ${question.opts.B}`);
    lines.push(`C. ${question.opts.C}`);
    lines.push(`D. ${question.opts.D}`);
    lines.push(`Answer: ${question.ans || '?'}`);
    lines.push('');
  });
  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const rawPages = JSON.parse(await fs.readFile(RAW_FILE, 'utf8'));
  const chapterText = extractChapter(rawPages);
  const matches = findQuestionMatches(chapterText);
  repairQuestionNumbers(matches);
  const parsedByNumber = new Map();
  const errorsByNumber = new Map();
  const fallbackByNumber = new Map();
  for (const match of matches) {
    const result = parseQuestion(match);
    if (result.error) {
      errorsByNumber.set(match.number, result.error);
      if (result.fallbackAnswer || result.fallbackStem) fallbackByNumber.set(match.number, result);
    } else {
      const fallback = fallbackByNumber.get(match.number);
      if (!result.question.ans && fallback?.fallbackAnswer) result.question.ans = fallback.fallbackAnswer;
      if (fallback?.fallbackStem && fallback.fallbackStem.length > result.question.q.length) {
        result.question.q = fallback.fallbackStem;
      }
      parsedByNumber.set(match.number, result.question);
    }
  }
  const parseErrors = [...errorsByNumber.entries()]
    .filter(([number]) => !parsedByNumber.has(number))
    .map(([, error]) => error);
  if (parseErrors.length) fail(parseErrors.join('\n'));

  const parsed = [...parsedByNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, question]) => question);
  const chapter = { name: '第七章：静电场', questions: parsed };
  const warnings = validateChapter(chapter);
  const db = { 7: chapter };
  const json = `${JSON.stringify(db, null, 2)}\n`;
  JSON.parse(json);

  await fs.mkdir(path.dirname(OUT_MD), { recursive: true });
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(OUT_MD, toMarkdown(chapter), 'utf8');
  await fs.writeFile(OUT_JSON, json, 'utf8');
  await fs.writeFile(REPORT_FILE, JSON.stringify({ questionCount: parsed.length, warnings }, null, 2) + '\n', 'utf8');

  console.log(`Parsed ${parsed.length} questions.`);
  console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`Wrote ${path.relative(ROOT, REPORT_FILE)}`);
  if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

function repairQuestionNumbers(matches) {
  for (let i = 1; i < matches.length - 1; i += 1) {
    const previous = matches[i - 1].number;
    const current = matches[i].number;
    const next = matches[i + 1].number;
    if (current < previous && next === previous + 2) {
      matches[i].number = previous + 1;
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
