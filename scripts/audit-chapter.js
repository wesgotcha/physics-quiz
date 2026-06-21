const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const chapterId = String(process.argv[2] || process.env.CHAPTER || '7');
const dbPath = path.join(ROOT, 'data', 'physics_quiz_db.json');
const publicDbPath = path.join(ROOT, 'public', 'data', 'physics_quiz_db.json');
const legacyDbPath = path.join(ROOT, 'tmp', '旧数据库.json');
const pdfRowsPath = path.join(ROOT, 'tmp', 'audit', 'rows.json');
const outDir = path.join(ROOT, 'data', 'audits');
const outJson = path.join(outDir, `chapter_${chapterId}_audit.json`);
const outMd = path.join(outDir, `chapter_${chapterId}_audit.md`);
const publicAuditDir = path.join(ROOT, 'public', 'audits');
const outHtml = path.join(publicAuditDir, `chapter_${chapterId}_audit.html`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeForSearch(text) {
  return normalizeFormulaGlyphs(String(text || ''))
    .replace(/\\[,;! ]/g, ' ')
    .replace(/\\pi/g, 'π')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\varepsilon|\\epsilon/g, 'ε')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\Delta/g, '△')
    .replace(/\\Phi/g, 'φ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\tau/g, 'τ')
    .replace(/\\vec\s*([a-zA-Z])/g, 'vec$1')
    .replace(/([a-zA-Z])\u20d7/g, 'vec$1')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt$1')
    .replace(/√\s*([0-9]+)/g, 'sqrt$1')
    .replace(/√/g, 'sqrt')
    .replace(/_\{([^{}]+)\}/g, '$1')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
    .replace(/(\d+)\s*([a-zA-Z]+)\s*\/\s*(\d+)/g, '$1/$3$2')
    .replace(/(^|[^0-9])([a-zA-Z]+)\s*\/\s*(\d+)/g, (_, prefix, symbol, denominator) => `${prefix}1/${denominator}${symbol}`)
    .replace(/\\(?:vec|overrightarrow|mathrm|text|left|right|cdot|oint|int|sum|infty|partial|nabla|hat|bar)/g, '')
    .replace(/\\pi/g, 'π')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\varepsilon|\\epsilon/g, 'ε')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\Delta/g, '△')
    .replace(/\\Phi/g, 'φ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\tau/g, 'τ')
    .replace(/[{}\\$()\[\]（），。；：:;,.、_\^\s]/g, '')
    .replace(/[−－–—]/g, '-')
    .toLowerCase();
}

function normalizeFormulaGlyphs(text) {
  const supers = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  const subs = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₋': '-', '₊': '+' };
  return String(text || '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, (ch) => supers[ch] || ch)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₋₊]/g, (ch) => subs[ch] || ch)
    .replace(/△/g, '△')
    .replace(/Φ/g, 'φ')
    .replace(/[•·]/g, '·')
    .replace(/[．.。]+$/g, '');
}

function optionNeedle(text) {
  const normalized = normalizeForSearch(text);
  if (!normalized) return '';
  return normalized.slice(0, Math.min(18, Math.max(8, Math.floor(normalized.length * 0.55))));
}

function normalizePlainText(text) {
  return normalizeForSearch(text)
    .replace(/＝/g, '=')
    .replace(/电场场强/g, '电场强')
    .replace(/场强/g, '场强');
}

function legacyOptionAudit(question, legacyQuestion) {
  if (!legacyQuestion) return { status: 'missing_legacy_question', matches: {} };
  const matches = {};
  const crossMatches = {};
  const missing = [];
  for (const key of ['A', 'B', 'C', 'D']) {
    const current = normalizePlainText(question.opts?.[key] || '');
    const legacy = normalizePlainText(legacyQuestion.opts?.[key] || '');
    const currentNeedle = current.slice(0, Math.min(24, Math.max(8, Math.floor(current.length * 0.7))));
    const legacyNeedle = legacy.slice(0, Math.min(24, Math.max(8, Math.floor(legacy.length * 0.7))));
    const ownMatch =
      current && legacy && (
        current.includes(legacyNeedle) ||
        legacy.includes(currentNeedle) ||
        formulaSignature(current) === formulaSignature(legacy)
      );
    matches[key] = ownMatch;
    if (!ownMatch) {
      missing.push(key);
      crossMatches[key] = ['A', 'B', 'C', 'D'].filter((candidate) => {
        const other = normalizePlainText(legacyQuestion.opts?.[candidate] || '');
        return other && current && (other.includes(currentNeedle) || current.includes(other.slice(0, Math.min(24, Math.max(8, Math.floor(other.length * 0.7))))));
      });
    }
  }
  const definiteSwap = Object.values(crossMatches).some((matchesForOption) => matchesForOption.length === 1);
  if (definiteSwap) return { status: 'order_mismatch', matches, missing, crossMatches };
  if (missing.length) return { status: 'text_diff', matches, missing, crossMatches };
  return { status: 'ok', matches, missing: [], crossMatches: {} };
}

function formulaSignature(text) {
  return normalizeForSearch(text)
    .replace(/[a-z\u4e00-\u9fff]/gi, '')
    .replace(/[;；.。]/g, '')
    .toLowerCase();
}

function hasBalanced(text, openRe, closeRe) {
  return (String(text).match(openRe) || []).length === (String(text).match(closeRe) || []).length;
}

function dollarPairs(text) {
  const matches = String(text || '').match(/(?<!\\)\$\$/g) || [];
  return matches.length % 2 === 0;
}

function auditMathText(text) {
  const issues = [];
  const value = String(text || '');
  if (/[\u25a1\ufffd\ufffc]/u.test(value)) issues.push('OCR_PLACEHOLDER');
  if (/[锛绗]/u.test(value)) issues.push('MOJIBAKE');
  if (/[\u20d7→]/u.test(value)) issues.push('RAW_VECTOR_GLYPH');
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/u.test(value)) issues.push('RAW_SUP_SUBSCRIPT');
  if (!hasBalanced(value, /\\\(/g, /\\\)/g)) issues.push('UNBALANCED_INLINE_LATEX');
  if (!hasBalanced(value, /\\\[/g, /\\\]/g)) issues.push('UNBALANCED_DISPLAY_LATEX');
  if (!dollarPairs(value)) issues.push('UNBALANCED_DOLLAR_DISPLAY');
  return issues;
}

function checkMathJaxConfig() {
  const files = ['index.html', path.join('public', 'index.html')];
  const issues = [];
  for (const rel of files) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!html.includes("['$', '$']")) issues.push(`${rel}:MISSING_DOLLAR_INLINE`);
    if (!html.includes("['$$', '$$']")) issues.push(`${rel}:MISSING_DOLLAR_DISPLAY`);
    if (!html.includes('MathJax.startup.promise')) issues.push(`${rel}:NO_STARTUP_WAIT`);
    if (!html.includes('tex-chtml.js')) issues.push(`${rel}:MISSING_MATHJAX_SCRIPT`);
  }
  return issues;
}

function optionOrderAudit(question, pdfText) {
  if (!pdfText) return { status: 'missing_pdf_text', positions: {} };
  const segments = pdfOptionSegments(pdfText);
  if (Object.keys(segments).length < 4) {
    return { status: 'needs_manual_review', positions: {}, missing: ['A', 'B', 'C', 'D'].filter((key) => !segments[key]) };
  }
  const missing = [];
  const crossMatches = {};
  for (const key of ['A', 'B', 'C', 'D']) {
    const needle = optionNeedle(question.opts[key]);
    if (!needle) {
      missing.push(key);
      continue;
    }
    const ownSegment = normalizeForSearch(segments[key]);
    if (!ownSegment.includes(needle)) {
      missing.push(key);
      crossMatches[key] = ['A', 'B', 'C', 'D'].filter((candidate) => normalizeForSearch(segments[candidate]).includes(needle));
    }
  }
  const definiteSwap = Object.entries(crossMatches).some(([, matches]) => matches.length === 1);
  if (definiteSwap) return { status: 'order_mismatch', missing, crossMatches };
  if (missing.length) return { status: 'partial_match', missing, crossMatches };
  return { status: 'ok', missing: [], crossMatches: {} };
}

function pdfOptionSegments(pdfText) {
  const text = String(pdfText || '');
  const markers = [];
  const re = /[（(]\s*([A-D])\s*[）)]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    markers.push({ key: match[1], start: match.index, contentStart: re.lastIndex });
  }
  const firstA = markers.findIndex((item) => item.key === 'A');
  const ordered = firstA >= 0 ? markers.slice(firstA) : markers;
  const segments = {};
  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    if (segments[current.key]) continue;
    const next = ordered.slice(i + 1).find((item) => ['A', 'B', 'C', 'D'].includes(item.key));
    segments[current.key] = text.slice(current.contentStart, next ? next.start : text.length);
  }
  return segments;
}

function main() {
  const db = readJson(dbPath);
  const publicDb = readJson(publicDbPath);
  const legacyDb = fs.existsSync(legacyDbPath) ? readJson(legacyDbPath) : {};
  const chapter = db[chapterId];
  const legacyChapter = legacyDb[chapterId];
  if (!chapter) throw new Error(`Chapter ${chapterId} not found in ${dbPath}`);
  if (!publicDb[chapterId]) throw new Error(`Chapter ${chapterId} not found in ${publicDbPath}`);

  const pdfRows = fs.existsSync(pdfRowsPath)
    ? readJson(pdfRowsPath).filter((row) => String(row.chapter_id) === chapterId)
    : [];
  const mathJaxIssues = checkMathJaxConfig();

  const rows = chapter.questions.map((question, index) => {
    const number = index + 1;
    const pdfRow = pdfRows.find((row) => Number(row.number) === number);
    const legacyQuestion = legacyChapter?.questions?.[index] || null;
    const fields = [question.q, ...Object.values(question.opts || {})];
    const mathIssues = fields.flatMap((text, fieldIndex) => {
      const field = fieldIndex === 0 ? 'q' : ['A', 'B', 'C', 'D'][fieldIndex - 1];
      return auditMathText(text).map((issue) => `${field}:${issue}`);
    });
    const optionOrder = optionOrderAudit(question, pdfRow?.pdf_text);
    const legacyOrder = legacyOptionAudit(question, legacyQuestion);
    const issues = [];
    const review = [];

    if (!pdfRow) issues.push('MISSING_PDF_ROW');
    if (pdfRow && question.ans !== pdfRow.pdf_answer) issues.push('ANSWER_MISMATCH');
    if (!legacyQuestion) issues.push('MISSING_LEGACY_ROW');
    if (legacyQuestion && question.ans !== legacyQuestion.ans) issues.push('LEGACY_ANSWER_MISMATCH');
    if (!/^[A-D]$/.test(question.ans)) issues.push('BAD_ANSWER');
    for (const key of ['A', 'B', 'C', 'D']) {
      if (!question.opts?.[key]) issues.push(`MISSING_OPTION_${key}`);
    }
    issues.push(...mathIssues);
    if (legacyOrder.status === 'order_mismatch') issues.push('LEGACY_OPTION_ORDER_MISMATCH');
    if (optionOrder.status === 'order_mismatch' && legacyOrder.status !== 'ok') issues.push('OPTION_ORDER_MISMATCH');
    if (optionOrder.status === 'order_mismatch' && legacyOrder.status === 'ok') review.push('PDF_OPTION_ORDER_CONFLICT_LEGACY_OK');
    if (legacyOrder.status === 'text_diff') review.push('LEGACY_OPTION_TEXT_DIFF_REVIEW');
    if (['partial_match', 'needs_manual_review', 'missing_pdf_text'].includes(optionOrder.status)) {
      review.push(`OPTION_ORDER_${optionOrder.status.toUpperCase()}`);
    }
    if (/图题，以原 PDF 图为准/.test(question.q)) review.push('DIAGRAM_NEEDS_VISUAL_REVIEW');

    return {
      chapter_id: chapterId,
      number,
      db_answer: question.ans,
      pdf_answer: pdfRow?.pdf_answer || null,
      pdf_page: pdfRow?.pdf_page || null,
      option_order_status: optionOrder.status,
      legacy_option_status: legacyOrder.status,
      option_positions: optionOrder.positions,
      legacy_option_matches: legacyOrder.matches,
      issues,
      review,
      q: question.q,
      opts: question.opts,
      pdf_excerpt: pdfRow?.pdf_text || null,
      legacy_q: legacyQuestion?.q || null,
      legacy_opts: legacyQuestion?.opts || null,
      legacy_answer: legacyQuestion?.ans || null,
    };
  });

  const hardIssues = rows.filter((row) => row.issues.length);
  const reviewRows = rows.filter((row) => row.review.length);
  const summary = {
    chapter_id: chapterId,
    chapter_name: chapter.name,
    question_count: chapter.questions.length,
    public_question_count: publicDb[chapterId].questions.length,
    pdf_row_count: pdfRows.length,
    legacy_question_count: legacyChapter?.questions?.length || 0,
    hard_issue_count: hardIssues.length,
    manual_review_count: reviewRows.length,
    mathjax_issues: mathJaxIssues,
    passed_automatic_gate:
      chapter.questions.length === publicDb[chapterId].questions.length &&
      (!pdfRows.length || chapter.questions.length === pdfRows.length) &&
      (!legacyChapter || chapter.questions.length === legacyChapter.questions.length) &&
      hardIssues.length === 0 &&
      mathJaxIssues.length === 0,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf8');

  const lines = [];
  lines.push(`# Chapter ${chapterId} Audit - ${chapter.name}`);
  lines.push('');
  lines.push(`- Questions: DB ${summary.question_count} / public ${summary.public_question_count} / legacy ${summary.legacy_question_count || 'N/A'} / PDF rows ${summary.pdf_row_count || 'N/A'}`);
  lines.push(`- Automatic hard issues: ${summary.hard_issue_count}`);
  lines.push(`- Manual review items: ${summary.manual_review_count}`);
  lines.push(`- MathJax config issues: ${summary.mathjax_issues.length ? summary.mathjax_issues.join(', ') : 'none'}`);
  lines.push(`- Automatic gate: ${summary.passed_automatic_gate ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Hard Issues');
  lines.push('');
  if (!hardIssues.length) lines.push('None.');
  for (const row of hardIssues) {
    lines.push(`- Q${row.number} PDF p.${row.pdf_page || '?'}: ${row.issues.join(', ')}`);
    lines.push(`  - DB answer: ${row.db_answer}; PDF answer: ${row.pdf_answer || '?'}`);
    if (row.legacy_answer) lines.push(`  - Legacy answer: ${row.legacy_answer}`);
    lines.push(`  - Stem: ${row.q}`);
  }
  lines.push('');
  lines.push('## Manual Review Queue');
  lines.push('');
  if (!reviewRows.length) lines.push('None.');
  for (const row of reviewRows) {
    lines.push(`- Q${row.number} PDF p.${row.pdf_page || '?'}: ${row.review.join(', ')}`);
    lines.push(`  - DB answer: ${row.db_answer}; PDF answer: ${row.pdf_answer || '?'}`);
    if (row.legacy_answer) lines.push(`  - Legacy answer: ${row.legacy_answer}`);
    lines.push(`  - Stem: ${row.q}`);
    lines.push(`  - A: ${row.opts.A}`);
    lines.push(`  - B: ${row.opts.B}`);
    lines.push(`  - C: ${row.opts.C}`);
    lines.push(`  - D: ${row.opts.D}`);
    if (row.pdf_excerpt) lines.push(`  - PDF excerpt: ${row.pdf_excerpt.slice(0, 360)}`);
  }
  fs.writeFileSync(outMd, `${lines.join('\n')}\n`, 'utf8');
  fs.mkdirSync(publicAuditDir, { recursive: true });
  fs.writeFileSync(outHtml, renderAuditHtml(summary, rows), 'utf8');

  console.log(JSON.stringify({
    summary,
    outJson: path.relative(ROOT, outJson),
    outMd: path.relative(ROOT, outMd),
    outHtml: path.relative(ROOT, outHtml),
  }, null, 2));
}

function renderAuditHtml(summary, rows) {
  const reviewRows = rows.filter((row) => row.issues.length || row.review.length);
  const renderedRows = reviewRows.length ? reviewRows : rows;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chapter ${escapeHtml(summary.chapter_id)} Audit</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f6f7f9;color:#172033}
main{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 12px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px}
.metric{background:white;border:1px solid #dde2ea;border-radius:8px;padding:12px}
.metric b{display:block;font-size:20px;margin-top:4px}
.q{background:white;border:1px solid #dde2ea;border-radius:8px;margin:14px 0;padding:14px}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.tag{font-size:12px;border-radius:999px;padding:3px 8px;background:#edf2f7}
.bad{background:#ffe8e8;color:#8a1f1f}.warn{background:#fff4cc;color:#765700}.ok{background:#e7f6ec;color:#166534}
.gate{background:#fff;border:1px solid #dde2ea;border-radius:8px;padding:12px;margin:0 0 14px;line-height:1.55}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:7px 10px;cursor:pointer}
button.active{background:#172033;color:white;border-color:#172033}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.opts div{margin:6px 0;line-height:1.55}
.pdf{font-size:13px;line-height:1.55;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;white-space:pre-wrap}
@media(max-width:780px){.grid{grid-template-columns:1fr}}
</style>
<script>
window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)'],['$','$']],displayMath:[['\\\\[','\\\\]'],['$$','$$']],processEscapes:true},options:{skipHtmlTags:['script','noscript','style','textarea','pre','code']}};
</script>
<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<script>
function setFilter(kind){
  document.querySelectorAll('.toolbar button').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===kind));
  document.querySelectorAll('.q').forEach(card=>{
    const tags=(card.dataset.review||'').split(',');
    const show=kind==='all'||tags.includes(kind);
    card.style.display=show?'block':'none';
  });
}
window.addEventListener('DOMContentLoaded',()=>setFilter('all'));
</script>
</head>
<body>
<main>
<h1>第 ${escapeHtml(summary.chapter_id)} 章审核：${escapeHtml(summary.chapter_name)}</h1>
<div class="summary">
<div class="metric">题数<b>${summary.question_count}</b></div>
<div class="metric">PDF 对照<b>${summary.pdf_row_count}</b></div>
<div class="metric">硬问题<b>${summary.hard_issue_count}</b></div>
<div class="metric">人工复核<b>${summary.manual_review_count}</b></div>
<div class="metric">自动门<b>${summary.passed_automatic_gate ? 'PASS' : 'FAIL'}</b></div>
</div>
<div class="gate">
<b>人工状态：待放行。</b>
自动门只证明题数、答案、旧库选项顺序、JSON 和 MathJax 配置没有硬错误；本页仍需人工确认公式视觉渲染、图题含义和 PDF 摘录中的可疑排版。确认本章通过后，才开始下一章。
</div>
<div class="toolbar">
<button data-filter="all" onclick="setFilter('all')">全部待审</button>
<button data-filter="DIAGRAM_NEEDS_VISUAL_REVIEW" onclick="setFilter('DIAGRAM_NEEDS_VISUAL_REVIEW')">图题</button>
<button data-filter="OPTION_ORDER_PARTIAL_MATCH" onclick="setFilter('OPTION_ORDER_PARTIAL_MATCH')">选项弱匹配</button>
<button data-filter="OPTION_ORDER_NEEDS_MANUAL_REVIEW" onclick="setFilter('OPTION_ORDER_NEEDS_MANUAL_REVIEW')">选项需人工</button>
<button data-filter="PDF_OPTION_ORDER_CONFLICT_LEGACY_OK" onclick="setFilter('PDF_OPTION_ORDER_CONFLICT_LEGACY_OK')">PDF/旧库冲突</button>
</div>
${renderedRows.map(renderAuditQuestion).join('\n')}
</main>
</body>
</html>
`;
}

function renderAuditQuestion(row) {
  const issueTags = row.issues.map((issue) => `<span class="tag bad">${escapeHtml(issue)}</span>`).join('');
  const reviewTags = row.review.map((issue) => `<span class="tag warn">${escapeHtml(issue)}</span>`).join('');
  const status = row.issues.length ? 'bad' : row.review.length ? 'warn' : 'ok';
  return `<section class="q" data-review="${escapeHtml(row.review.join(','))}">
<div class="meta">
<span class="tag ${status}">Q${row.number}</span>
<span class="tag">PDF p.${row.pdf_page || '?'}</span>
<span class="tag">答案 ${escapeHtml(row.db_answer)} / PDF ${escapeHtml(row.pdf_answer || '?')}</span>
${issueTags}${reviewTags}
</div>
<div class="grid">
<div>
<p><b>题干</b> ${escapeHtml(row.q)}</p>
<div class="opts">
<div><b>A.</b> ${escapeHtml(row.opts.A)}</div>
<div><b>B.</b> ${escapeHtml(row.opts.B)}</div>
<div><b>C.</b> ${escapeHtml(row.opts.C)}</div>
<div><b>D.</b> ${escapeHtml(row.opts.D)}</div>
</div>
</div>
<div>
<b>PDF 摘录</b>
<div class="pdf">${escapeHtml(row.pdf_excerpt || '')}</div>
</div>
</div>
</section>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char]));
}

main();
