import json
import re
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "physics_quiz_db.json"
PDF_PATH = ROOT / "tmp" / "试题库：_大学物理C—选择.pdf"
OUT_DIR = ROOT / "tmp" / "audit"
OUT_DIR.mkdir(parents=True, exist_ok=True)


CHAPTER_RE = re.compile(r"第[一二三四五六七八九十]+章[：:].*")
QUESTION_RE = re.compile(r"^\s*(\d+)\s*[.．、]\s*(.*)")
ANSWER_RE = re.compile(r"[（(]\s*([A-D])\s*[）)]")
OPTION_RE = re.compile(r"[（(]\s*([A-D])\s*[）)]")
BAD_GLYPH_RE = re.compile(r"[\u0B00-\u0D7F\uf000-\uf8ff]|[𝑞𝑑𝜆𝐵𝜋𝑅𝜀]")


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def strip_answer_marks(s: str, answer: str | None = None) -> str:
    if not answer:
        return s
    return re.sub(rf"[（(]\s*{re.escape(answer)}\s*[）)]", "（ ）", s)


def is_diagram_marker(text: str, match: re.Match) -> bool:
    before = text[match.start() - 1 : match.start()]
    after = text[match.end() : match.end() + 2]
    return before in {"图", "～", "~"} or "～" in after or "~" in after


def answer_markers(text: str):
    for match in ANSWER_RE.finditer(text):
        if not is_diagram_marker(text, match):
            yield match


def extract_pdf_questions():
    records = []
    current_chapter = None
    current = None

    with pdfplumber.open(str(PDF_PATH)) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line or "院学理物大师杭" in line:
                    continue
                ch_match = CHAPTER_RE.search(line)
                if ch_match:
                    current_chapter = ch_match.group(0).strip()
                    continue
                q_match = QUESTION_RE.match(line)
                if q_match:
                    if current:
                        records.append(current)
                    current = {
                        "chapter_name": current_chapter,
                        "number": int(q_match.group(1)),
                        "page": page_no,
                        "text": q_match.group(2).strip(),
                        "lines": [line],
                    }
                    continue
                if current:
                    current["text"] += " " + line
                    current["lines"].append(line)

    if current:
        records.append(current)

    for rec in records:
        answer = None
        # Prefer the answer marker near the beginning of the full question text.
        head = rec["text"][:260]
        matches = [match.group(1) for match in answer_markers(head)]
        if matches:
            answer = matches[0]
        rec["answer"] = answer
        rec["text_no_answer"] = strip_answer_marks(rec["text"], answer)
    return records


def group_pdf_by_chapter(records):
    grouped = {}
    current_id = None
    name_to_id = {
        "第一章": "1",
        "第二章": "2",
        "第四章": "4",
        "第五章": "5",
        "第六章": "6",
        "第七章": "7",
        "第八章": "8",
        "第九章": "9",
    }
    for rec in records:
        chapter_name = rec.get("chapter_name") or ""
        for key, value in name_to_id.items():
            if key in chapter_name:
                current_id = value
                break
        if current_id:
            grouped.setdefault(current_id, []).append(rec)
    return grouped


def audit():
    db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    pdf_records = extract_pdf_questions()
    pdf_by_chapter = group_pdf_by_chapter(pdf_records)

    summary = []
    issues = []
    rows = []

    for chapter_id, chapter in db.items():
        db_questions = chapter["questions"]
        pdf_questions = pdf_by_chapter.get(chapter_id, [])
        summary.append(
            {
                "chapter_id": chapter_id,
                "chapter_name": chapter["name"],
                "db_count": len(db_questions),
                "pdf_count": len(pdf_questions),
            }
        )

        for idx, question in enumerate(db_questions, start=1):
            pdf_q = pdf_questions[idx - 1] if idx - 1 < len(pdf_questions) else None
            q_text = question.get("q", "")
            row = {
                "chapter_id": chapter_id,
                "number": idx,
                "db_answer": question.get("ans"),
                "pdf_answer": pdf_q.get("answer") if pdf_q else None,
                "pdf_page": pdf_q.get("page") if pdf_q else None,
                "db_q": q_text,
                "pdf_text": pdf_q.get("text") if pdf_q else None,
                "issues": [],
            }

            if not pdf_q:
                row["issues"].append("MISSING_PDF_MATCH")
            else:
                if question.get("ans") != pdf_q.get("answer"):
                    row["issues"].append("ANSWER_MISMATCH")
                # Compare rough text without spaces and answer marks.
                db_norm = norm(strip_answer_marks(q_text, question.get("ans")))
                pdf_norm = norm(pdf_q.get("text_no_answer", ""))
                if db_norm and pdf_norm:
                    # Use containment because PDF text includes options after the stem.
                    stem = db_norm[: min(40, len(db_norm))]
                    if stem and stem not in pdf_norm:
                        row["issues"].append("STEM_MISMATCH")

            if ANSWER_RE.search(q_text):
                # Ignore references like 图(A)～(D).
                answer_leak = any(match.group(1) == question.get("ans") for match in answer_markers(q_text))
                if answer_leak:
                    row["issues"].append("ANSWER_LEAK_IN_STEM")

            joined = " ".join([q_text, *(question.get("opts") or {}).values()])
            if BAD_GLYPH_RE.search(joined):
                row["issues"].append("SUSPECT_GLYPHS")

            for key in ["A", "B", "C", "D"]:
                if key not in question.get("opts", {}):
                    row["issues"].append(f"MISSING_OPTION_{key}")
            if question.get("ans") not in ["A", "B", "C", "D"]:
                row["issues"].append("BAD_ANSWER_KEY")

            rows.append(row)
            if row["issues"]:
                issues.append(row)

    (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "issues.json").write_text(json.dumps(issues, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# 题库逐题审计", "", "## 章节题数", ""]
    for item in summary:
        mark = "OK" if item["db_count"] == item["pdf_count"] else "MISMATCH"
        lines.append(f"- {item['chapter_id']} {item['chapter_name']}: DB {item['db_count']} / PDF {item['pdf_count']} [{mark}]")
    lines.extend(["", "## 问题清单", ""])
    if not issues:
        lines.append("未发现自动审计问题。")
    else:
        for item in issues:
            issue_text = ", ".join(item["issues"])
            lines.append(f"- 第{item['chapter_id']}章 第{item['number']}题 PDF页{item.get('pdf_page')}: {issue_text}")
            lines.append(f"  - DB答案: {item.get('db_answer')} / PDF答案: {item.get('pdf_answer')}")
            lines.append(f"  - DB题干: {item.get('db_q')}")
            if item.get("pdf_text"):
                lines.append(f"  - PDF摘录: {item.get('pdf_text')[:260]}")
    (OUT_DIR / "audit_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({"summary": summary, "issue_count": len(issues), "out_dir": str(OUT_DIR)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    audit()
