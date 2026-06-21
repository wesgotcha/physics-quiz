import json
from pathlib import Path

from paddleocr import PaddleOCR


ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / "tmp" / "paddleocr" / "pages"
OUT_DIR = ROOT / "tmp" / "paddleocr"
OUT_JSON = OUT_DIR / "first_chapter_ocr_lines.json"
OUT_TXT = OUT_DIR / "first_chapter_ocr_lines.txt"


def as_list(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def main():
    image_paths = sorted(PAGES_DIR.glob("choice-*.ppm"))[:6]
    if not image_paths:
        raise SystemExit(f"No rendered pages found in {PAGES_DIR}")

    ocr = PaddleOCR(
        lang="ch",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )

    all_lines = []
    text_lines = []
    for image_path in image_paths:
        page_no = int(image_path.stem.split("-")[-1])
        result = ocr.predict(str(image_path))[0]
        texts = result["rec_texts"]
        scores = result["rec_scores"]
        boxes = result["rec_boxes"]

        text_lines.append(f"# Page {page_no}")
        for index, text in enumerate(texts):
            box = as_list(boxes[index])
            score = float(scores[index])
            record = {
                "page": page_no,
                "index": index + 1,
                "score": score,
                "box": box,
                "text": text,
            }
            all_lines.append(record)
            text_lines.append(f"{index + 1:03d} [{score:.3f}] {box} {text}")
        text_lines.append("")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(all_lines, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_TXT.write_text("\n".join(text_lines), encoding="utf-8")
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_TXT}")


if __name__ == "__main__":
    main()
