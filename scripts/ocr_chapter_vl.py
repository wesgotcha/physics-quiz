import argparse
import json
import subprocess
from pathlib import Path

from paddleocr import PaddleOCRVL


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "tmp" / "试题库：_大学物理C—选择.pdf"


def run(cmd):
    subprocess.run(cmd, cwd=ROOT, check=True)


def render_pages(pdf_path, pages_dir, first_page, last_page, dpi):
    pages_dir.mkdir(parents=True, exist_ok=True)
    expected = [pages_dir / f"choice-{page:06d}.ppm" for page in range(first_page, last_page + 1)]
    if all(path.exists() for path in expected):
        return expected

    run(
        [
            "pdftoppm",
            "-r",
            str(dpi),
            "-f",
            str(first_page),
            "-l",
            str(last_page),
            str(pdf_path),
            str(pages_dir / "choice"),
        ]
    )
    return expected


def block_records(result):
    records = []
    for block in result["parsing_res_list"]:
        records.append(
            {
                "label": block.label,
                "bbox": list(block.bbox) if block.bbox is not None else None,
                "content": block.content,
            }
        )
    return records


def main():
    parser = argparse.ArgumentParser(description="Run PaddleOCR-VL 1.6 over a rendered PDF chapter.")
    parser.add_argument("--name", default="electric")
    parser.add_argument("--pdf", default=str(DEFAULT_PDF))
    parser.add_argument("--first-page", type=int, default=36)
    parser.add_argument("--last-page", type=int, default=49)
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    out_dir = ROOT / "tmp" / "paddleocr_vl" / args.name
    pages_dir = out_dir / "pages"
    page_json_dir = out_dir / "page_json"
    page_json_dir.mkdir(parents=True, exist_ok=True)

    image_paths = render_pages(Path(args.pdf), pages_dir, args.first_page, args.last_page, args.dpi)

    ocr = PaddleOCRVL(
        pipeline_version="v1.6",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_layout_detection=True,
        use_chart_recognition=False,
        use_seal_recognition=False,
        use_ocr_for_image_block=True,
        format_block_content=True,
        merge_layout_blocks=True,
    )

    records = []
    for image_path in image_paths:
        pdf_page = int(image_path.stem.split("-")[-1])
        page_json = page_json_dir / f"page-{pdf_page:06d}.json"
        if page_json.exists() and not args.force:
            record = json.loads(page_json.read_text(encoding="utf-8"))
            records.append(record)
            print(f"Reused page {pdf_page}: {page_json.relative_to(ROOT)}")
            continue

        result = ocr.predict(str(image_path), max_new_tokens=4096)[0]
        markdown = result.markdown.get("markdown_texts", "")
        record = {
            "engine": "PaddleOCR-VL-1.6",
            "pdf_page": pdf_page,
            "image_path": str(image_path.relative_to(ROOT)),
            "markdown": markdown,
            "blocks": block_records(result),
        }
        page_json.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        records.append(record)
        print(f"OCR page {pdf_page}: {page_json.relative_to(ROOT)}")

    raw_json = out_dir / "raw_pages.json"
    raw_md = out_dir / "raw_pages.md"
    raw_json.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raw_md.write_text(
        "\n\n".join(f"<!-- PDF page {r['pdf_page']} -->\n\n{r['markdown']}" for r in records) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {raw_json.relative_to(ROOT)}")
    print(f"Wrote {raw_md.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
