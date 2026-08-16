#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
VENDOR_DIR = TOOL_DIR / "vendor"
if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

try:
    import pdf_safe_backend as pdf_backend
except ImportError as exc:
    raise SystemExit(f"Missing PDF dependencies. Run install.cmd or: python -m pip install -r {TOOL_DIR / 'requirements.txt'} -t {VENDOR_DIR}") from exc


DEFAULT_OUTPUT_ROOT = TOOL_DIR / "reports"
FIGURE_CAPTION_RE = re.compile(r"^\s*(?:Figure|Fig\.?|\uadf8\ub9bc)\s+([A-Za-z0-9.\-]+)[\s:.\-]*(.*)$", re.IGNORECASE)
TABLE_CAPTION_RE = re.compile(r"^\s*(?:Table|\ud45c)\s+([A-Za-z0-9.\-]+)[\s:.\-]*(.*)$", re.IGNORECASE)


def parse_args():
    parser = argparse.ArgumentParser(description="Create a visual PDF-to-JSON verification report.")
    parser.add_argument("pdf", nargs="?", help="PDF file to inspect")
    parser.add_argument("quick_max_pages", nargs="?", type=int, help="Optional max page count for npm positional use")
    parser.add_argument("--input", "--pdf", dest="input_pdf", help="PDF file to inspect")
    parser.add_argument("--out", "--output", dest="output_root", default=str(DEFAULT_OUTPUT_ROOT), help="Output root folder")
    parser.add_argument("--max-pages", dest="max_pages", type=int, default=0, help="Limit pages for quick checks")
    parser.add_argument("--render-scale", dest="render_scale", type=float, default=1.35, help="Page preview render scale")
    parser.add_argument("--image-scale", dest="image_scale", type=float, default=2.0, help="Figure crop render scale")
    parser.add_argument("--min-image-side", dest="min_image_side", type=float, default=45)
    parser.add_argument("--min-image-area", dest="min_image_area", type=float, default=8000)
    parser.add_argument("--include-decorative", dest="include_decorative", action="store_true", help="Keep small repeated header/logo images")
    parser.add_argument("--open", dest="open_report", action="store_true", help="Open the generated HTML report")
    parser.add_argument("--force", dest="force", action="store_true", help="Replace an existing report folder for the same PDF")
    args = parser.parse_args()
    args.input_pdf = args.input_pdf or args.pdf
    if not args.max_pages and args.quick_max_pages:
        args.max_pages = args.quick_max_pages
    if not args.input_pdf:
      parser.error("a PDF path is required")
    return args


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def posix(path):
    return Path(path).as_posix()


def slugify(value):
    value = Path(value).stem.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "document"


def normalize_text(text):
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_cell(value):
    return normalize_text(value).replace("\n", " ")


def relative_to(path, base):
    return posix(Path(path).resolve().relative_to(Path(base).resolve()))


def relative_to_cwd(path):
    try:
        return posix(Path(path).resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return posix(Path(path).resolve())


def safe_remove_report_dir(report_dir, output_root):
    report_dir = Path(report_dir).resolve()
    output_root = Path(output_root).resolve()
    rel = report_dir.relative_to(output_root)
    if not rel.parts or rel.parts[0] in ("", ".", ".."):
        raise ValueError(f"Refusing to reset suspicious report directory: {report_dir}")
    if report_dir.exists():
        shutil.rmtree(report_dir)


def choose_report_dir(output_root, pdf_path, force):
    output_root.mkdir(parents=True, exist_ok=True)
    file_hash = sha1(str(pdf_path.resolve()).encode("utf-8")).hexdigest()[:8]
    base = output_root / f"{slugify(pdf_path.name)}-{file_hash}"
    if force:
        safe_remove_report_dir(base, output_root)
        base.mkdir(parents=True, exist_ok=True)
        return base
    if not base.exists():
        base.mkdir(parents=True, exist_ok=True)
        return base
    for index in range(2, 1000):
        candidate = output_root / f"{base.name}-{index}"
        if not candidate.exists():
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
    raise ValueError("Could not allocate a report directory")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def rows_to_markdown(rows):
    clean = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    if not clean:
        return ""
    width = max(len(row) for row in clean)
    clean = [row + [""] * (width - len(row)) for row in clean]
    lines = [
        "| " + " | ".join(clean[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in clean[1:])
    return "\n".join(lines)


def rows_to_objects(rows):
    clean = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    if len(clean) < 2:
        return []
    headers = clean[0]
    if not all(headers) or len(set(headers)) != len(headers):
        return []
    objects = []
    for row in clean[1:]:
        item = {}
        for index, header in enumerate(headers):
            item[header] = row[index] if index < len(row) else ""
        objects.append(item)
    return objects


def table_row_quality(rows):
    clean = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    if len(clean) < 2:
        return False
    width = max(len(row) for row in clean)
    if width < 2:
        return False
    multi_cell_rows = 0
    valued_columns = [0] * width
    for row in clean:
        nonempty = 0
        for index in range(width):
            if index < len(row) and row[index]:
                nonempty += 1
                valued_columns[index] += 1
        if nonempty >= 2:
            multi_cell_rows += 1
    populated_columns = sum(1 for count in valued_columns if count >= 2)
    return multi_cell_rows >= 2 and populated_columns >= 2


def rect_to_list(rect):
    if rect is None:
        return None
    return [round(float(rect.x0), 2), round(float(rect.y0), 2), round(float(rect.x1), 2), round(float(rect.y1), 2)]


def block_text(block):
    lines = []
    for line in block.get("lines") or []:
        line_text = "".join(span.get("text", "") for span in line.get("spans") or [])
        if line_text.strip():
            lines.append(line_text.rstrip())
    return normalize_text("\n".join(lines))


def extract_paragraph_blocks(page, doc_id, page_num):
    blocks = []
    for index, block in enumerate(page.get_text("dict").get("blocks") or [], start=1):
        if block.get("type") != 0:
            continue
        text = block_text(block)
        if not text:
            continue
        rect = pdf_backend.Rect(block.get("bbox"))
        blocks.append({
            "type": "paragraph",
            "blockId": f"{doc_id}:p{page_num}:para{index}",
            "page": page_num,
            "bbox": rect_to_list(rect),
            "text": text,
            "confidence": 0.92,
            "method": "pdfplumber-text-block",
        })
    return blocks


def detect_captions(lines):
    figures = []
    tables = []
    for index, line in enumerate(lines):
        figure_match = FIGURE_CAPTION_RE.match(line)
        if figure_match:
            figures.append({"line": index, "label": figure_match.group(1), "caption": normalize_text(line)})
        table_match = TABLE_CAPTION_RE.match(line)
        if table_match:
            tables.append({"line": index, "label": table_match.group(1), "caption": normalize_text(line)})
    return figures, tables


def line_is_table_like(line):
    stripped = line.strip()
    if len(stripped) < 5:
        return False
    if "\t" in stripped:
        return True
    if re.search(r"\s{2,}", stripped) and len(re.split(r"\s{2,}", stripped)) >= 2:
        return True
    if re.search(r"\.{4,}\s*\d+$", stripped):
        return True
    numeric_hits = len(re.findall(r"\b\d+(?:[.,:/-]\d+)*\b", stripped))
    return numeric_hits >= 3 and len(stripped.split()) >= 4


def split_table_line(line):
    if "\t" in line:
        return [normalize_cell(part) for part in line.split("\t")]
    if re.search(r"\s{2,}", line):
        return [normalize_cell(part) for part in re.split(r"\s{2,}", line.strip())]
    if re.search(r"\.{4,}", line):
        return [normalize_cell(part) for part in re.split(r"\.{4,}", line.strip(), maxsplit=1)]
    return [normalize_cell(line)]


def make_table_block(doc_id, page_num, index, rows, caption, bbox, table_dir, method, confidence):
    rows = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    table_id = f"{doc_id}:p{page_num}:table{index}"
    csv_path = table_dir / f"p{page_num:04d}-table{index:02d}.csv"
    md_path = table_dir / f"p{page_num:04d}-table{index:02d}.md"
    markdown = rows_to_markdown(rows)
    write_csv(csv_path, rows)
    md_path.write_text(markdown + "\n", encoding="utf-8")
    return {
        "type": "table",
        "blockId": table_id,
        "tableId": table_id,
        "page": page_num,
        "bbox": rect_to_list(bbox) if bbox else None,
        "caption": caption or "",
        "rows": rows_to_objects(rows),
        "cells": rows,
        "markdown": markdown,
        "csvPath": None,
        "markdownPath": None,
        "confidence": confidence,
        "method": method,
    }, csv_path, md_path


def extract_pdfplumber_tables(page, doc_id, page_num, table_dir, captions):
    tables = []
    paths = []
    try:
        found = page.find_tables()
        source_tables = getattr(found, "tables", found)
    except Exception:
        return tables, paths
    for index, table in enumerate(source_tables or [], start=1):
        try:
            rows = table.extract()
        except Exception:
            continue
        if not table_row_quality(rows or []):
            continue
        caption = captions[index - 1]["caption"] if index - 1 < len(captions) else ""
        block, csv_path, md_path = make_table_block(
            doc_id,
            page_num,
            index,
            rows,
            caption,
            pdf_backend.Rect(table.bbox) if getattr(table, "bbox", None) else None,
            table_dir,
            "pdfplumber-find_tables",
            0.78,
        )
        tables.append(block)
        paths.append((block["tableId"], csv_path, md_path))
    return tables, paths


def extract_text_table_candidates(lines, doc_id, page_num, start_index, table_dir, captions):
    tables = []
    paths = []
    run = []

    def flush():
        nonlocal run
        if len(run) < 3:
            run = []
            return
        rows = [split_table_line(line) for line in run]
        if not table_row_quality(rows):
            run = []
            return
        index = start_index + len(tables) + 1
        caption = captions[index - 1]["caption"] if index - 1 < len(captions) else ""
        block, csv_path, md_path = make_table_block(
            doc_id,
            page_num,
            index,
            rows,
            caption,
            None,
            table_dir,
            "text-line-candidate",
            0.38,
        )
        block["rawText"] = "\n".join(run)
        tables.append(block)
        paths.append((block["tableId"], csv_path, md_path))
        run = []

    for line in lines:
        if line_is_table_like(line):
            run.append(line)
        else:
            flush()
    flush()
    return tables, paths


def is_decorative_image(rect, page_rect, captions):
    if captions:
        return False
    if rect.height < 85 and rect.y0 < page_rect.height * 0.25:
        return True
    if rect.width > page_rect.width * 0.65 and rect.height < 90:
        return True
    if rect.width * rect.height < 14000:
        return True
    return False


def nearest_caption(captions, index):
    if not captions:
        return ""
    if index - 1 < len(captions):
        return captions[index - 1].get("caption", "")
    return captions[0].get("caption", "")


def extract_figures(page, doc_id, page_num, figure_dir, captions, args, image_hashes):
    figures = []
    seen = set()
    matrix = pdf_backend.Matrix(args.image_scale, args.image_scale)
    image_index = 1

    for image in page.get_images(full=True):
        xref = image[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for rect in rects:
            if rect.width < args.min_image_side or rect.height < args.min_image_side:
                continue
            if rect.width * rect.height < args.min_image_area:
                continue
            if not args.include_decorative and is_decorative_image(rect, page.rect, captions):
                continue
            key = (xref, round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1))
            if key in seen:
                continue
            seen.add(key)
            figure_id = f"{doc_id}:p{page_num}:fig{image_index}"
            image_path = figure_dir / f"p{page_num:04d}-fig{image_index:02d}.png"
            try:
                pix = page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
                digest = sha1(pix.samples).hexdigest()
                if not captions and digest in image_hashes:
                    continue
                image_hashes.add(digest)
                pix.save(image_path)
            except Exception:
                continue
            figures.append({
                "type": "figure",
                "blockId": figure_id,
                "figureId": figure_id,
                "page": page_num,
                "bbox": rect_to_list(rect),
                "caption": nearest_caption(captions, image_index),
                "imagePath": None,
                "nearbyText": "",
                "confidence": 0.68 if captions else 0.52,
                "method": "embedded-image-render",
                "_imagePathObject": image_path,
            })
            image_index += 1

    for index, caption in enumerate(captions, start=1):
        if any(item.get("caption") == caption["caption"] for item in figures):
            continue
        figure_id = f"{doc_id}:p{page_num}:caption-fig{index}"
        image_path = figure_dir / f"p{page_num:04d}-caption-fig{index:02d}.png"
        try:
            pix = page.get_pixmap(matrix=pdf_backend.Matrix(1.25, 1.25), alpha=False)
            pix.save(image_path)
        except Exception:
            continue
        figures.append({
            "type": "figure",
            "blockId": figure_id,
            "figureId": figure_id,
            "page": page_num,
            "bbox": [0, 0, round(page.rect.width, 2), round(page.rect.height, 2)],
            "caption": caption["caption"],
            "imagePath": None,
            "nearbyText": "",
            "confidence": 0.32,
            "method": "caption-page-render",
            "_imagePathObject": image_path,
        })
    return figures


def block_sort_key(block):
    bbox = block.get("bbox")
    if bbox:
        return (bbox[1], bbox[0], block.get("type", ""))
    return (10000, 0, block.get("type", ""))


def search_text_for_block(block):
    if block["type"] == "paragraph":
        return block.get("text", "")
    if block["type"] == "table":
        return "\n".join(part for part in [block.get("caption", ""), block.get("markdown", ""), block.get("rawText", "")] if part)
    if block["type"] == "figure":
        return "\n".join(part for part in [block.get("caption", ""), block.get("nearbyText", "")] if part)
    return ""


def render_page_image(page, page_num, pages_dir, report_dir, scale):
    image_path = pages_dir / f"p{page_num:04d}.png"
    pix = page.get_pixmap(matrix=pdf_backend.Matrix(scale, scale), alpha=False)
    pix.save(image_path)
    return relative_to(image_path, report_dir)


def extract_pdf(pdf_path, report_dir, args):
    doc_id = slugify(pdf_path.name)
    pages_dir = report_dir / "pages"
    figure_dir = report_dir / "figures"
    table_dir = report_dir / "tables"
    pages_dir.mkdir(parents=True, exist_ok=True)
    figure_dir.mkdir(parents=True, exist_ok=True)
    table_dir.mkdir(parents=True, exist_ok=True)

    pdf = pdf_backend.open(pdf_path)
    original_page_count = len(pdf)
    page_total = min(original_page_count, args.max_pages) if args.max_pages else original_page_count
    image_hashes = set()
    pages = []
    search_blocks = []
    counts = {"paragraph": 0, "table": 0, "figure": 0}

    for page_index in range(page_total):
        page = pdf[page_index]
        page_num = page_index + 1
        page_image = render_page_image(page, page_num, pages_dir, report_dir, args.render_scale)
        text = page.get_text("text")
        lines = [line.rstrip() for line in text.splitlines() if line.strip()]
        figure_captions, table_captions = detect_captions(lines)

        paragraphs = extract_paragraph_blocks(page, doc_id, page_num)
        tables, table_paths = extract_pdfplumber_tables(page, doc_id, page_num, table_dir, table_captions)
        if not tables:
            candidate_tables, candidate_paths = extract_text_table_candidates(lines, doc_id, page_num, len(tables), table_dir, table_captions)
            tables.extend(candidate_tables)
            table_paths.extend(candidate_paths)
        table_path_map = {table_id: (csv_path, md_path) for table_id, csv_path, md_path in table_paths}
        for table in tables:
            csv_path, md_path = table_path_map[table["tableId"]]
            table["csvPath"] = relative_to(csv_path, report_dir)
            table["markdownPath"] = relative_to(md_path, report_dir)

        figures = extract_figures(page, doc_id, page_num, figure_dir, figure_captions, args, image_hashes)
        for figure in figures:
            image_path = figure.pop("_imagePathObject", None)
            if image_path:
                figure["imagePath"] = relative_to(image_path, report_dir)

        blocks = sorted(paragraphs + tables + figures, key=block_sort_key)
        for block in blocks:
            counts[block["type"]] += 1
            text_for_search = search_text_for_block(block)
            search_blocks.append({
                "id": block["blockId"],
                "docId": doc_id,
                "title": pdf_path.stem,
                "sourceFile": relative_to_cwd(pdf_path),
                "page": page_num,
                "type": block["type"],
                "method": block.get("method"),
                "confidence": block.get("confidence"),
                "text": text_for_search,
                "imagePath": block.get("imagePath"),
                "csvPath": block.get("csvPath"),
            })

        pages.append({
            "page": page_num,
            "width": round(page.rect.width, 2),
            "height": round(page.rect.height, 2),
            "pageImage": page_image,
            "text": normalize_text(text),
            "blocks": blocks,
            "paragraphCount": len(paragraphs),
            "tableCount": len(tables),
            "figureCount": len(figures),
        })

    metadata = pdf.metadata or {}
    pdf.close()

    document = {
        "kind": "pdf-to-json-verify-document",
        "id": doc_id,
        "title": metadata.get("title") or pdf_path.stem,
        "sourceFile": relative_to_cwd(pdf_path),
        "sourceFileAbsolute": str(pdf_path.resolve()),
        "generatedAt": now_iso(),
        "pageCount": page_total,
        "originalPageCount": original_page_count,
        "counts": counts,
        "options": {
            "renderScale": args.render_scale,
            "imageScale": args.image_scale,
            "maxPages": args.max_pages or None,
            "includeDecorative": args.include_decorative,
        },
        "pages": pages,
    }
    return document, search_blocks


def make_manifest(document, report_dir, search_count):
    return {
        "kind": "pdf-to-json-verify-report",
        "generatedAt": document["generatedAt"],
        "sourceFile": document["sourceFile"],
        "reportDir": relative_to_cwd(report_dir),
        "documentJson": "document.json",
        "searchIndex": "block-search-index.jsonl",
        "pageCount": document["pageCount"],
        "paragraphCount": document["counts"]["paragraph"],
        "tableCount": document["counts"]["table"],
        "figureCount": document["counts"]["figure"],
        "searchBlockCount": search_count,
        "notes": [
            "Paragraphs are pdfplumber text blocks.",
            "Tables are pdfplumber table detections or conservative text-line candidates.",
            "Figures are embedded image crops or full-page renders for caption-only figures.",
            "Use confidence and method fields to decide which blocks need manual review.",
        ],
    }


def html_json(data):
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def build_html(document):
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PDF to JSON Verify - {escape_html(document['title'])}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4f5f7;
      --panel: #ffffff;
      --line: #dfe3ea;
      --text: #111827;
      --muted: #6b7280;
      --para: #2563eb;
      --table: #d97706;
      --figure: #059669;
      --radius: 8px;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Malgun Gothic", "Segoe UI", Arial, sans-serif;
      font-size: 14px;
    }}
    header {{
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(10px);
    }}
    h1 {{ margin: 0 0 4px; font-size: 18px; }}
    .source {{ color: var(--muted); font-size: 12px; word-break: break-all; }}
    .toolbar {{ display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }}
    .toolbar label, .badge {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fff;
    }}
    input[type="search"] {{
      width: 220px;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 0 10px;
    }}
    main {{
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
    }}
    aside {{
      position: sticky;
      top: 78px;
      align-self: start;
      max-height: calc(100vh - 96px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
    }}
    .summary {{ padding: 14px; border-bottom: 1px solid var(--line); }}
    .stats {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }}
    .stat {{ border: 1px solid var(--line); border-radius: var(--radius); padding: 8px; }}
    .stat strong {{ display: block; font-size: 18px; }}
    nav a {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid #edf0f4;
      color: inherit;
      text-decoration: none;
    }}
    nav a:hover {{ background: #f8fafc; }}
    .page-card {{
      margin-bottom: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--panel);
    }}
    .page-head {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }}
    .page-body {{
      display: grid;
      grid-template-columns: minmax(360px, 48%) minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
    }}
    .preview {{
      position: sticky;
      top: 92px;
      align-self: start;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      background: #e5e7eb;
    }}
    .preview-inner {{ position: relative; }}
    .preview img {{ display: block; width: 100%; height: auto; }}
    .box {{
      position: absolute;
      border: 2px solid currentColor;
      background: color-mix(in srgb, currentColor 12%, transparent);
      min-width: 4px;
      min-height: 4px;
      pointer-events: none;
    }}
    .box.paragraph {{ color: var(--para); }}
    .box.table {{ color: var(--table); }}
    .box.figure {{ color: var(--figure); }}
    .block {{
      margin-bottom: 10px;
      border: 1px solid var(--line);
      border-left-width: 4px;
      border-radius: var(--radius);
      background: #fff;
      overflow: hidden;
    }}
    .block.paragraph {{ border-left-color: var(--para); }}
    .block.table {{ border-left-color: var(--table); }}
    .block.figure {{ border-left-color: var(--figure); }}
    .block-head {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid #edf0f4;
      color: #374151;
      font-size: 12px;
    }}
    .block-content {{ padding: 10px; }}
    pre {{
      max-height: 260px;
      overflow: auto;
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: var(--radius);
      background: #f9fafb;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Consolas, monospace;
      font-size: 12px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }}
    th, td {{
      border: 1px solid #e5e7eb;
      padding: 6px;
      vertical-align: top;
    }}
    th {{ background: #f9fafb; }}
    .figure-img {{
      max-width: 100%;
      border: 1px solid #e5e7eb;
      border-radius: var(--radius);
      background: #f9fafb;
    }}
    .links {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }}
    .links a {{
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: #111827;
      text-decoration: none;
      background: #fff;
      font-size: 12px;
    }}
    .muted {{ color: var(--muted); }}
    .empty {{ padding: 18px; color: var(--muted); }}
    body.hide-paragraph .block.paragraph,
    body.hide-paragraph .box.paragraph,
    body.hide-table .block.table,
    body.hide-table .box.table,
    body.hide-figure .block.figure,
    body.hide-figure .box.figure,
    .filtered {{ display: none !important; }}
    @media (max-width: 1100px) {{
      main {{ grid-template-columns: 1fr; }}
      aside {{ position: static; max-height: none; }}
      .page-body {{ grid-template-columns: 1fr; }}
      .preview {{ position: relative; top: 0; }}
    }}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>{escape_html(document['title'])}</h1>
      <div class="source">{escape_html(document['sourceFile'])}</div>
    </div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="블록 검색" />
      <label><input type="checkbox" data-filter="paragraph" checked /> 본문</label>
      <label><input type="checkbox" data-filter="table" checked /> 표</label>
      <label><input type="checkbox" data-filter="figure" checked /> 그림</label>
      <a class="badge" href="document.json">document.json</a>
      <a class="badge" href="block-search-index.jsonl">jsonl</a>
    </div>
  </header>
  <main>
    <aside>
      <div class="summary" id="summary"></div>
      <nav id="pageNav"></nav>
    </aside>
    <section id="pages"></section>
  </main>
  <script type="application/json" id="verify-data">{html_json(document)}</script>
  <script>
    const data = JSON.parse(document.getElementById('verify-data').textContent);
    const summary = document.getElementById('summary');
    const pageNav = document.getElementById('pageNav');
    const pagesEl = document.getElementById('pages');
    const search = document.getElementById('search');

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({{
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }}[ch]));

    function blockSearchText(block) {{
      return [block.type, block.blockId, block.text, block.caption, block.markdown, block.rawText, block.method]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    }}

    function bboxStyle(block, page) {{
      if (!block.bbox) return '';
      const [x0, y0, x1, y1] = block.bbox;
      return [
        `left:${{(x0 / page.width) * 100}}%`,
        `top:${{(y0 / page.height) * 100}}%`,
        `width:${{((x1 - x0) / page.width) * 100}}%`,
        `height:${{((y1 - y0) / page.height) * 100}}%`
      ].join(';');
    }}

    function renderCells(cells) {{
      if (!cells || !cells.length) return '<div class="muted">셀 구조 없음</div>';
      const rows = cells.slice(0, 12).map((row, rowIndex) => {{
        const tag = rowIndex === 0 ? 'th' : 'td';
        return '<tr>' + row.map((cell) => `<${{tag}}>${{esc(cell)}}</${{tag}}>`).join('') + '</tr>';
      }}).join('');
      const more = cells.length > 12 ? `<div class="muted">외 ${{cells.length - 12}}행은 JSON/CSV에서 확인</div>` : '';
      return `<div style="overflow:auto"><table>${{rows}}</table></div>${{more}}`;
    }}

    function renderBlock(block) {{
      const conf = typeof block.confidence === 'number' ? Math.round(block.confidence * 100) + '%' : '-';
      let body = '';
      if (block.type === 'paragraph') {{
        body = `<div>${{esc(block.text || '')}}</div>`;
      }} else if (block.type === 'table') {{
        body = [
          block.caption ? `<strong>${{esc(block.caption)}}</strong>` : '',
          renderCells(block.cells),
          `<details><summary>Markdown 보기</summary><pre>${{esc(block.markdown || '')}}</pre></details>`,
          `<div class="links">
            ${{block.csvPath ? `<a href="${{esc(block.csvPath)}}">CSV</a>` : ''}}
            ${{block.markdownPath ? `<a href="${{esc(block.markdownPath)}}">Markdown</a>` : ''}}
          </div>`
        ].join('');
      }} else if (block.type === 'figure') {{
        body = [
          block.caption ? `<strong>${{esc(block.caption)}}</strong>` : '<span class="muted">캡션 없음</span>',
          block.imagePath ? `<div style="margin-top:8px"><img class="figure-img" src="${{esc(block.imagePath)}}" alt=""></div>` : '',
          block.nearbyText ? `<pre>${{esc(block.nearbyText)}}</pre>` : ''
        ].join('');
      }}
      return `<article class="block ${{esc(block.type)}}" data-search="${{esc(blockSearchText(block))}}">
        <div class="block-head">
          <span>${{esc(block.type)}} · ${{esc(block.blockId)}}</span>
          <span>${{esc(block.method)}} · confidence ${{conf}}</span>
        </div>
        <div class="block-content">
          ${{body}}
          <details><summary>Block JSON</summary><pre>${{esc(JSON.stringify(block, null, 2))}}</pre></details>
        </div>
      </article>`;
    }}

    function render() {{
      const counts = data.counts;
      summary.innerHTML = `
        <strong>PDF to JSON Verify</strong>
        <div class="muted">${{esc(data.generatedAt)}}</div>
        <div class="stats">
          <div class="stat"><strong>${{data.pageCount}}</strong><span>pages</span></div>
          <div class="stat"><strong>${{counts.paragraph}}</strong><span>paragraphs</span></div>
          <div class="stat"><strong>${{counts.table}}</strong><span>tables</span></div>
          <div class="stat"><strong>${{counts.figure}}</strong><span>figures</span></div>
        </div>`;

      pageNav.innerHTML = data.pages.map((page) => `
        <a href="#page-${{page.page}}">
          <span>Page ${{page.page}}</span>
          <span class="muted">T ${{page.tableCount}} · F ${{page.figureCount}}</span>
        </a>`).join('');

      pagesEl.innerHTML = data.pages.map((page) => {{
        const overlays = page.blocks
          .filter((block) => block.bbox)
          .map((block) => `<span class="box ${{esc(block.type)}}" style="${{bboxStyle(block, page)}}" title="${{esc(block.blockId)}}"></span>`)
          .join('');
        const blocks = page.blocks.length ? page.blocks.map(renderBlock).join('') : '<div class="empty">추출된 블록 없음</div>';
        return `<section class="page-card" id="page-${{page.page}}">
          <div class="page-head">
            <strong>Page ${{page.page}}</strong>
            <span class="muted">paragraph ${{page.paragraphCount}} · table ${{page.tableCount}} · figure ${{page.figureCount}}</span>
          </div>
          <div class="page-body">
            <div class="preview">
              <div class="preview-inner">
                <img src="${{esc(page.pageImage)}}" alt="page ${{page.page}}" />
                ${{overlays}}
              </div>
            </div>
            <div class="blocks">${{blocks}}</div>
          </div>
        </section>`;
      }}).join('');
    }}

    function applySearch() {{
      const term = search.value.trim().toLowerCase();
      document.querySelectorAll('.block').forEach((block) => {{
        block.classList.toggle('filtered', Boolean(term) && !block.dataset.search.includes(term));
      }});
    }}

    document.querySelectorAll('[data-filter]').forEach((input) => {{
      input.addEventListener('change', () => {{
        document.body.classList.toggle(`hide-${{input.dataset.filter}}`, !input.checked);
      }});
    }});
    search.addEventListener('input', applySearch);
    render();
  </script>
</body>
</html>
"""


def escape_html(value):
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_report(report_dir, document, search_blocks):
    write_json(report_dir / "document.json", document)
    manifest = make_manifest(document, report_dir, len(search_blocks))
    write_json(report_dir / "manifest.json", manifest)
    (report_dir / "block-search-index.jsonl").write_text(
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in search_blocks),
        encoding="utf-8",
    )
    (report_dir / "index.html").write_text(build_html(document), encoding="utf-8")
    return manifest


def open_report(path):
    if sys.platform.startswith("win"):
        os.startfile(path)
        return
    if sys.platform == "darwin":
        os.system(f"open {json.dumps(str(path))}")
        return
    os.system(f"xdg-open {json.dumps(str(path))}")


def main():
    args = parse_args()
    pdf_path = Path(args.input_pdf).expanduser().resolve()
    if not pdf_path.exists():
        raise SystemExit(f"PDF does not exist: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise SystemExit(f"Input is not a PDF: {pdf_path}")

    output_root = Path(args.output_root).resolve()
    report_dir = choose_report_dir(output_root, pdf_path, args.force)

    print(f"PDF: {relative_to_cwd(pdf_path)}")
    print(f"Report: {relative_to_cwd(report_dir)}")
    document, search_blocks = extract_pdf(pdf_path, report_dir, args)
    manifest = write_report(report_dir, document, search_blocks)

    print(
        "Done. "
        f"{manifest['pageCount']} page(s), "
        f"{manifest['paragraphCount']} paragraph(s), "
        f"{manifest['tableCount']} table(s), "
        f"{manifest['figureCount']} figure(s)."
    )
    print(f"Open: {relative_to_cwd(report_dir / 'index.html')}")
    if args.open_report:
        open_report(report_dir / "index.html")


if __name__ == "__main__":
    main()
