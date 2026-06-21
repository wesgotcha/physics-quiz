const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_FILE = path.join(ROOT, 'tmp', '旧数据库.json');
const IMAGE_NOTE = '（图题，以原 PDF 图为准）';

const chapterId = String(process.argv[2] || process.env.CHAPTER || '');
const sourceName = process.argv[3] || process.env.SOURCE_NAME || `chapter${chapterId}`;
if (!chapterId) {
  throw new Error('Usage: node scripts/parse-vl-chapter.js <chapterId> [sourceName]');
}

const RAW_FILE = path.join(ROOT, 'tmp', 'paddleocr_vl', sourceName, 'raw_pages.json');
const OUT_MD = path.join(ROOT, 'data', `physics_quiz_db_chapter${chapterId}.md`);
const OUT_JSON = path.join(ROOT, 'data', `physics_quiz_db_chapter${chapterId}.json`);
const REPORT_FILE = path.join(ROOT, 'tmp', 'paddleocr_vl', sourceName, 'parse_report.json');

const CHINESE_NUMERAL = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
};

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
const GREEK = new Map(Object.entries({
  'λ': '\\lambda',
  'π': '\\pi',
  'φ': '\\phi',
  'Φ': '\\Phi',
  'ω': '\\omega',
  'Ω': '\\Omega',
  'θ': '\\theta',
  'β': '\\beta',
  'τ': '\\tau',
  'μ': '\\mu',
  'ρ': '\\rho',
  'σ': '\\sigma',
  'ε': '\\varepsilon',
  'Δ': '\\Delta',
}));

function fail(message) {
  throw new Error(message);
}

function normalizeMathGlyphs(text) {
  let out = String(text || '');
  out = out.replace(/<!--[\s\S]*?-->/g, '\n');
  out = out.replace(/<div[^>]*>/gi, '\n').replace(/<\/div>/gi, '\n');
  out = out.replace(/<img[^>]*>/gi, ` ${IMAGE_NOTE} `);
  out = out.replace(/&nbsp;/g, ' ');
  out = out.replace(/[Ａ-Ｄ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  out = out.replace(/[（(]\s*([A-D])\s*[）)]/g, '($1)');
  out = out.replace(/([A-Za-z])\u20d7/g, (_, name) => `\\(\\vec ${name}\\)`);
  out = out.replace(/([A-Za-z])\s*→/g, (_, name) => `\\(\\vec ${name}\\)`);
  out = out.replace(/Φ\s*e/g, '\\(\\Phi_e\\)');
  out = out.replace(/Φ\s*m/g, '\\(\\Phi_m\\)');
  out = out.replace(/ε\s*0/g, '\\(\\varepsilon_0\\)');
  out = out.replace(/μ\s*0/g, '\\(\\mu_0\\)');
  out = out.replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079\u207b\u207a]+/g, (m) => `^{${[...m].map((c) => SUPER.get(c)).join('')}}`);
  out = out.replace(/[\u2080-\u2089\u208b\u208a]+/g, (m) => `_{${[...m].map((c) => SUB.get(c)).join('')}}`);
  out = out.replace(/[λπφΦωΩθβτμρσεΔ]/g, (ch) => GREEK.get(ch) || ch);
  out = out.replace(/[－–—]/g, '-');
  out = out.replace(/\r\n?/g, '\n');
  out = out.replace(/^\s*#{1,6}\s*(\d{1,2}\\?[.．、])/gm, '$1');
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function extractChapter(rawPages, legacyChapter) {
  const joined = rawPages.map((page) => `\n<!-- PDF page ${page.pdf_page} -->\n${page.markdown}`).join('\n');
  const normalized = normalizeMathGlyphs(joined);
  const exactIndex = normalized.indexOf(legacyChapter.name);
  const numeral = CHINESE_NUMERAL[chapterId];
  const headingPattern = numeral ? new RegExp(`第\\s*${numeral}\\s*章\\s*[：:]`) : null;
  const regexIndex = headingPattern ? normalized.search(headingPattern) : -1;
  const start = exactIndex >= 0 ? exactIndex : regexIndex;
  if (start < 0) fail(`Cannot find chapter heading for ${chapterId}: ${legacyChapter.name}`);

  const afterStart = normalized.slice(start);
  const nextHeading = afterStart.slice(1).search(/\n\s*#{0,3}\s*第\s*[一二三四五六七八九十]+\s*章\s*[：:]/);
  return nextHeading >= 0 ? afterStart.slice(0, nextHeading + 1) : afterStart;
}

function findQuestionMatches(text) {
  const matches = [];
  const re = /^(\d{1,2})\\?[.．、]\s*([\s\S]*?)(?=^\d{1,2}\\?[.．、]\s*|(?![\s\S]))/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    const number = Number(match[1]);
    if (number > 0) matches.push({ number, chunk: `${match[1]}. ${match[2]}`.trim() });
  }
  return matches;
}

function findOptionMarkers(body) {
  const firstBreak = body.indexOf('\n');
  const offset = firstBreak >= 0 ? firstBreak : 0;
  const optionArea = body.slice(offset);
  const markers = [];
  const re = /(^|[\s\n])\(([A-D])\)\s*/g;
  let match;
  while ((match = re.exec(optionArea)) !== null) {
    let markerStart = offset + match.index + match[1].length;
    let contentStart = offset + match.index + match[0].length;
    const adjusted = adjustDisplayMathMarker(body, markerStart, contentStart);
    markers.push({
      key: match[2],
      markerStart: adjusted.markerStart,
      contentStart: adjusted.contentStart,
    });
  }
  if (markers.length >= 4) return markers.slice(0, 4);
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
  if (formulaMatches.length < 4 - markers.length + 1) return markers;
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

function parseQuestion(match, legacyQuestion) {
  const body = match.chunk.replace(/^\d{1,2}\\?[.．、]\s*/, '').trim();
  const optionMarkers = findOptionMarkers(body);
  if (optionMarkers.length < 4) {
    if (legacyQuestion) {
      return {
        number: match.number,
        fallbackWarning: `question ${match.number}: used legacy options because OCR had ${optionMarkers.length} option markers`,
        question: {
          q: cleanField(cleanAnswerBlank(body.split('\n')[0] || legacyQuestion.q)) || legacyQuestion.q,
          opts: {
            A: cleanField(legacyQuestion.opts.A),
            B: cleanField(legacyQuestion.opts.B),
            C: cleanField(legacyQuestion.opts.C),
            D: cleanField(legacyQuestion.opts.D),
          },
          ans: legacyQuestion.ans,
        },
      };
    }
    return {
      error: `question ${match.number}: expected 4 options, got ${optionMarkers.length}`,
      fallbackAnswer: extractAnswer(body) || legacyQuestion?.ans || '',
      fallbackStem: cleanAnswerBlank(body.replace(/\s+/g, ' ').trim()),
    };
  }

  let stem = body.slice(0, optionMarkers[0].markerStart).trim();
  const answer = extractAnswer(stem) || legacyQuestion?.ans || '';
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
    if (!cleanedOpts[key] && legacyQuestion?.opts?.[key]) {
      cleanedOpts[key] = cleanField(legacyQuestion.opts[key]);
    }
  }
  let questionText = cleanField(stem);
  if (hasImageNote && !questionText.includes(IMAGE_NOTE)) questionText += ` ${IMAGE_NOTE}`;

  return {
    number: match.number,
    question: {
      q: questionText || legacyQuestion?.q || '',
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
  return wrapBareFormula(normalizeMathGlyphs(text))
    .replace(/^\$\$\s*\([A-D]\)\s*/, () => '$$ ')
    .replace(/^[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapBareFormula(text) {
  const value = String(text || '').trim();
  if (!value || /\\\(|\\\[|\$/.test(value)) return value;
  if (!/[\\_^=+\-*/]|\\(?:lambda|pi|phi|omega|theta|beta|mu|rho|sigma|varepsilon|Delta)/.test(value)) return value;
  if (/[\u4e00-\u9fff]/u.test(value)) return value;
  return `$ ${value} $`;
}

function stripImageTail(text) {
  return String(text || '').replace(new RegExp(`\\s*${escapeRegExp(IMAGE_NOTE)}[\\s\\S]*$`), '').trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function repairQuestionNumbers(matches, expectedCount) {
  for (let i = 1; i < matches.length - 1; i += 1) {
    const previous = matches[i - 1].number;
    const current = matches[i].number;
    const next = matches[i + 1].number;
    if (current < previous && next === previous + 2) matches[i].number = previous + 1;
  }
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

function validateChapter(chapter, expectedCount) {
  const warnings = [];
  if (chapter.questions.length !== expectedCount) {
    warnings.push(`expected ${expectedCount} questions for chapter ${chapterId}, got ${chapter.questions.length}`);
  }
  chapter.questions.forEach((question, index) => {
    const label = `${chapterId}.${index + 1}`;
    if (!question.q) fail(`${label}.q is empty`);
    validateText(question.q, `${label}.q`, warnings);
    for (const key of ['A', 'B', 'C', 'D']) {
      if (!question.opts[key]) fail(`${label}.opts.${key} is empty`);
      validateText(question.opts[key], `${label}.opts.${key}`, warnings);
    }
    if (!/^[A-D]$/.test(question.ans)) fail(`${label}: missing answer`);
  });
  return warnings;
}

function toMarkdown(chapter, sourceName) {
  const lines = [
    `# Physics Quiz Database - Chapter ${chapterId} Draft`,
    '',
    `> Source: PaddleOCR-VL-1.6 extraction from tmp/试题库：_大学物理C—选择.pdf via tmp/paddleocr_vl/${sourceName}/raw_pages.json.`,
    '> Formula style: use explicit LaTeX delimiters. Build output is produced with JSON.stringify and validated with JSON.parse.',
    '',
    `## ${chapterId}. ${chapter.name}`,
    '',
  ];
  chapter.questions.forEach((question, index) => {
    lines.push(`### ${index + 1}`);
    lines.push(`Q: ${question.q}`);
    lines.push(`A. ${question.opts.A}`);
    lines.push(`B. ${question.opts.B}`);
    lines.push(`C. ${question.opts.C}`);
    lines.push(`D. ${question.opts.D}`);
    lines.push(`Answer: ${question.ans}`);
    lines.push('');
  });
  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const legacy = JSON.parse(await fs.readFile(LEGACY_FILE, 'utf8'));
  const legacyChapter = legacy[chapterId];
  if (!legacyChapter) fail(`Legacy chapter ${chapterId} not found`);
  const expectedCount = legacyChapter.questions.length;
  const rawPages = JSON.parse(await fs.readFile(RAW_FILE, 'utf8'));
  const chapterText = extractChapter(rawPages, legacyChapter);
  const matches = findQuestionMatches(chapterText);
  repairQuestionNumbers(matches, expectedCount);

  const parsedByNumber = new Map();
  const errorsByNumber = new Map();
  const fallbackByNumber = new Map();
  for (const match of matches) {
    const legacyQuestion = legacyChapter.questions[match.number - 1];
    const result = parseQuestion(match, legacyQuestion);
    if (result.fallbackWarning) {
      fallbackByNumber.set(match.number, result);
      parsedByNumber.set(match.number, result.question);
    } else if (result.error) {
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

  const missing = [];
  for (let number = 1; number <= expectedCount; number += 1) {
    if (!parsedByNumber.has(number)) missing.push(number);
  }
  if (missing.length) fail(`missing parsed questions: ${missing.join(', ')}`);

  const parsed = [...parsedByNumber.entries()]
    .filter(([number]) => number >= 1 && number <= expectedCount)
    .sort(([a], [b]) => a - b)
    .map(([, question]) => question);
  const chapter = { name: legacyChapter.name, questions: parsed };
  const warnings = validateChapter(chapter, expectedCount);
  const db = { [chapterId]: chapter };
  const json = `${JSON.stringify(db, null, 2)}\n`;
  JSON.parse(json);

  await fs.mkdir(path.dirname(OUT_MD), { recursive: true });
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(OUT_MD, toMarkdown(chapter, sourceName), 'utf8');
  await fs.writeFile(OUT_JSON, json, 'utf8');
  await fs.writeFile(REPORT_FILE, JSON.stringify({ chapterId, questionCount: parsed.length, warnings }, null, 2) + '\n', 'utf8');

  console.log(`Parsed ${parsed.length} questions for chapter ${chapterId}.`);
  console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`Wrote ${path.relative(ROOT, REPORT_FILE)}`);
  if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
