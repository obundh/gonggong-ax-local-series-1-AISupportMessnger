#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

SAFE_PDF_TOOL_DIR = Path(__file__).resolve().parents[1] / "pdftojson-verify"
SAFE_PDF_VENDOR_DIR = SAFE_PDF_TOOL_DIR / "vendor"
if SAFE_PDF_VENDOR_DIR.exists():
    sys.path.insert(0, str(SAFE_PDF_VENDOR_DIR))
sys.path.insert(0, str(SAFE_PDF_TOOL_DIR))

try:
    import pdf_safe_backend as pdf_backend
except ImportError as exc:
    raise SystemExit("Missing PDF dependencies. Install them with: python -m pip install -r tools/pdftojson-verify/requirements.txt -t tools/pdftojson-verify/vendor") from exc


DEFAULT_INPUT_DIR = Path("data/emp_docs")
DEFAULT_OUTPUT_DIR = Path("data/emp_blocks")
DEFAULT_ASSET_DIR = Path("data/emp_assets")
DEFAULT_INDEX = Path("data/emp/index.json")
DEFAULT_KR_DOCS_DIR = Path("data/emp_kr/docs")

FIGURE_CAPTION_RE = re.compile(r"^\s*(?:Figure|Fig\.?|\uadf8\ub9bc)\s+([A-Za-z0-9.\-]+)[\s:.\-]*(.*)$", re.IGNORECASE)
TABLE_CAPTION_RE = re.compile(r"^\s*(?:Table|\ud45c)\s+([A-Za-z0-9.\-]+)[\s:.\-]*(.*)$", re.IGNORECASE)
KR_PAGE_RE = re.compile(r"^\s*\uc6d0\ubb38\s*p\.(\d+)\s*(.*)$", re.DOTALL)


def parse_args():
    parser = argparse.ArgumentParser(description="Extract EMP PDF layout blocks, table candidates, and figure assets.")
    parser.add_argument("--in", "--input", dest="input_dir", default=str(DEFAULT_INPUT_DIR))
    parser.add_argument("--out", "--output", dest="output_dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--assets", dest="asset_dir", default=str(DEFAULT_ASSET_DIR))
    parser.add_argument("--index", dest="index_path", default=str(DEFAULT_INDEX))
    parser.add_argument("--kr-docs", dest="kr_docs_dir", default=str(DEFAULT_KR_DOCS_DIR))
    parser.add_argument("--file", dest="file_filter", default="")
    parser.add_argument("--max-docs", dest="max_docs", type=int, default=0)
    parser.add_argument("--max-pages", dest="max_pages", type=int, default=0)
    parser.add_argument("--min-image-side", dest="min_image_side", type=float, default=45)
    parser.add_argument("--min-image-area", dest="min_image_area", type=float, default=8000)
    parser.add_argument("--render-scale", dest="render_scale", type=float, default=2.0)
    parser.add_argument("--no-caption-page-renders", dest="caption_page_renders", action="store_false")
    parser.set_defaults(caption_page_renders=True)
    return parser.parse_args()


def posix(path):
    return Path(path).as_posix()


def relative(path):
    try:
        return posix(Path(path).resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return posix(path)


def assert_safe_output(path):
    resolved = Path(path).resolve()
    cwd = Path.cwd().resolve()
    rel = resolved.relative_to(cwd)
    if not str(rel).replace("\\", "/").startswith("data/"):
        raise ValueError(f"Refusing to reset output outside data/: {path}")


def reset_dir(path):
    assert_safe_output(path)
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_text(text):
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", str(text or "").replace("\r\n", "\n").replace("\r", "\n"))).strip()


def normalize_cell(value):
    return normalize_text(value).replace("\n", " ")


def slugify(value):
    value = Path(value).stem if value else "document"
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "document"


def load_index(index_path):
    if not index_path.exists():
        return {}, {}
    entries = json.loads(index_path.read_text(encoding="utf-8"))
    by_source = {}
    by_stem = {}
    for entry in entries:
        source = entry.get("sourceFile") or ""
        if source:
            by_source[posix(source).lower()] = entry
            by_stem[Path(source).stem.lower()] = entry
    return by_source, by_stem


def find_metadata(pdf_path, by_source, by_stem):
    source_key = posix(relative(pdf_path)).lower()
    stem_key = pdf_path.stem.lower()
    entry = by_source.get(source_key) or by_stem.get(stem_key)
    if entry:
        return dict(entry)
    doc_id = slugify(pdf_path.name)
    return {
        "id": doc_id,
        "title": pdf_path.stem.replace("_", " "),
        "sourceFile": relative(pdf_path),
        "language": "en",
        "sourceLanguage": None,
        "year": None,
        "agency": None,
        "topics": [],
    }


def load_korean_page_map(kr_docs_dir, doc_id):
    doc_path = kr_docs_dir / f"{doc_id}.json"
    if not doc_path.exists():
        return {}, None
    try:
        parsed = json.loads(doc_path.read_text(encoding="utf-8"))
    except Exception:
        return {}, relative(doc_path)

    pages = {}
    for page in parsed.get("pages") or []:
        text = page.get("text") or ""
        match = KR_PAGE_RE.match(text)
        if not match:
            continue
        original_page = int(match.group(1))
        content = normalize_text(match.group(2) or text)
        if content:
            pages.setdefault(original_page, []).append(content)
    return {page: "\n\n".join(parts) for page, parts in pages.items()}, relative(doc_path)


def collect_pdfs(input_dir, file_filter, max_docs):
    files = sorted(input_dir.glob("*.pdf"), key=lambda item: item.name.lower())
    if file_filter:
        needle = file_filter.lower()
        files = [file for file in files if needle in file.name.lower() or needle in file.stem.lower()]
    if max_docs:
        files = files[:max_docs]
    return files


def rect_to_list(rect):
    if not rect:
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
    for idx, block in enumerate(page.get_text("dict").get("blocks") or [], start=1):
        if block.get("type") != 0:
            continue
        text = block_text(block)
        if not text:
            continue
        rect = pdf_backend.Rect(block.get("bbox"))
        blocks.append({
            "type": "paragraph",
            "blockId": f"{doc_id}:p{page_num}:para{idx}",
            "page": page_num,
            "bbox": rect_to_list(rect),
            "text": text,
            "confidence": 0.92,
            "method": "pdfplumber-text-block",
        })
    return blocks


def rows_to_markdown(rows):
    clean = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    if not clean:
        return ""
    width = max(len(row) for row in clean)
    clean = [row + [""] * (width - len(row)) for row in clean]
    header = clean[0]
    sep = ["---"] * width
    body = clean[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(sep) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines)


def rows_to_objects(rows):
    clean = [[normalize_cell(cell) for cell in row] for row in rows if any(normalize_cell(cell) for cell in row)]
    if len(clean) < 2:
        return []
    headers = clean[0]
    if not all(headers) or len(set(headers)) != len(headers):
        return []
    output = []
    for row in clean[1:]:
        item = {}
        for index, header in enumerate(headers):
            item[header] = row[index] if index < len(row) else ""
        output.append(item)
    return output


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


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)


def extract_pdfplumber_tables(page, doc_id, page_num, table_dir):
    tables = []
    try:
        found = page.find_tables()
        source_tables = getattr(found, "tables", found)
    except Exception:
        return tables

    for idx, table in enumerate(source_tables or [], start=1):
        try:
            rows = table.extract()
        except Exception:
            continue
        rows = [[normalize_cell(cell) for cell in row] for row in rows or []]
        rows = [row for row in rows if any(row)]
        if not table_row_quality(rows):
            continue
        table_id = f"{doc_id}:p{page_num}:table{idx}"
        csv_path = table_dir / f"p{page_num:04d}-table{idx:02d}.csv"
        write_csv(csv_path, rows)
        markdown = rows_to_markdown(rows)
        tables.append({
            "type": "table",
            "blockId": table_id,
            "tableId": table_id,
            "page": page_num,
            "bbox": rect_to_list(pdf_backend.Rect(table.bbox)) if getattr(table, "bbox", None) else None,
            "caption": "",
            "rows": rows_to_objects(rows),
            "cells": rows,
            "markdown": markdown,
            "csvPath": relative(csv_path),
            "confidence": 0.78,
            "method": "pdfplumber-find_tables",
        })
    return tables


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


def extract_text_table_candidates(lines, doc_id, page_num, existing_count, table_dir):
    candidates = []
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
        idx = existing_count + len(candidates) + 1
        table_id = f"{doc_id}:p{page_num}:table-candidate{idx}"
        csv_path = table_dir / f"p{page_num:04d}-table-candidate{idx:02d}.csv"
        write_csv(csv_path, rows)
        candidates.append({
            "type": "table",
            "blockId": table_id,
            "tableId": table_id,
            "page": page_num,
            "bbox": None,
            "caption": "",
            "rawText": "\n".join(run),
            "rows": rows_to_objects(rows),
            "cells": rows,
            "markdown": rows_to_markdown(rows),
            "csvPath": relative(csv_path),
            "confidence": 0.38,
            "method": "text-line-candidate",
        })
        run = []

    for line in lines:
        if line_is_table_like(line):
            run.append(line)
        else:
            flush()
    flush()
    return candidates


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


def nearest_caption(rect, captions):
    if not captions:
        return ""
    # Text-line coordinates are intentionally not used here. Captions are still useful provenance.
    return captions[0].get("caption", "")


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


def extract_image_figures(page, doc, doc_id, page_num, figure_dir, captions, options, image_hashes):
    figures = []
    seen = set()
    matrix = pdf_backend.Matrix(options.render_scale, options.render_scale)
    image_index = 1
    for image in page.get_images(full=True):
        xref = image[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for rect in rects:
            if rect.width < options.min_image_side or rect.height < options.min_image_side:
                continue
            if rect.width * rect.height < options.min_image_area:
                continue
            if is_decorative_image(rect, page.rect, captions):
                continue
            key = (xref, round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1))
            if key in seen:
                continue
            seen.add(key)
            figure_id = f"{doc_id}:p{page_num}:fig{image_index}"
            image_path = figure_dir / f"p{page_num:04d}-fig{image_index:02d}.png"
            try:
                pix = page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
                digest = hashlib.sha1(pix.samples).hexdigest()
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
                "caption": nearest_caption(rect, captions),
                "imagePath": relative(image_path),
                "nearbyText": "",
                "confidence": 0.68 if captions else 0.52,
                "method": "embedded-image-render",
            })
            image_index += 1
    if options.caption_page_renders:
        for idx, caption in enumerate(captions, start=1):
            if any(item.get("caption") == caption["caption"] for item in figures):
                continue
            figure_id = f"{doc_id}:p{page_num}:caption-fig{idx}"
            image_path = figure_dir / f"p{page_num:04d}-caption-fig{idx:02d}.png"
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
                "imagePath": relative(image_path),
                "nearbyText": "",
                "confidence": 0.32,
                "method": "caption-page-render",
            })
    return figures


def attach_captions_to_tables(tables, captions):
    if not captions:
        return tables
    for index, table in enumerate(tables):
        if not table.get("caption") and index < len(captions):
            table["caption"] = captions[index]["caption"]
    return tables


def block_sort_key(block):
    bbox = block.get("bbox")
    if bbox:
        return (bbox[1], bbox[0], block.get("type", ""))
    return (10_000, 0, block.get("type", ""))


def search_text_for_block(block):
    if block["type"] == "paragraph":
        return block.get("text", "")
    if block["type"] == "table":
        return "\n".join(part for part in [block.get("caption", ""), block.get("markdown", ""), block.get("rawText", "")] if part)
    if block["type"] == "figure":
        return "\n".join(part for part in [block.get("caption", ""), block.get("nearbyText", "")] if part)
    return ""


def extract_document(pdf_path, metadata, options):
    doc_id = metadata["id"]
    output_doc_dir = Path(options.output_dir).resolve() / "docs"
    asset_doc_dir = Path(options.asset_dir).resolve() / doc_id
    figure_dir = asset_doc_dir / "figures"
    table_dir = asset_doc_dir / "tables"
    figure_dir.mkdir(parents=True, exist_ok=True)
    table_dir.mkdir(parents=True, exist_ok=True)

    korean_pages, kr_doc_path = load_korean_page_map(Path(options.kr_docs_dir), doc_id)

    pdf = pdf_backend.open(pdf_path)
    pages = []
    search_blocks = []
    table_count = 0
    figure_count = 0
    paragraph_count = 0
    image_hashes = set()

    page_total = min(len(pdf), options.max_pages) if options.max_pages else len(pdf)
    for page_index in range(page_total):
        page = pdf[page_index]
        page_num = page_index + 1
        text = page.get_text("text")
        lines = [line.rstrip() for line in text.splitlines() if line.strip()]
        figure_captions, table_captions = detect_captions(lines)

        paragraph_blocks = extract_paragraph_blocks(page, doc_id, page_num)
        tables = extract_pdfplumber_tables(page, doc_id, page_num, table_dir)
        tables.extend(extract_text_table_candidates(lines, doc_id, page_num, len(tables), table_dir))
        tables = attach_captions_to_tables(tables, table_captions)
        figures = extract_image_figures(page, pdf, doc_id, page_num, figure_dir, figure_captions, options, image_hashes)

        blocks = sorted(paragraph_blocks + tables + figures, key=block_sort_key)
        for block in blocks:
            block_text_value = search_text_for_block(block)
            if not block_text_value:
                continue
            search_blocks.append({
                "id": block["blockId"],
                "docId": doc_id,
                "title": metadata.get("title"),
                "sourceFile": metadata.get("sourceFile") or relative(pdf_path),
                "language": "en",
                "page": page_num,
                "type": block["type"],
                "method": block.get("method"),
                "confidence": block.get("confidence"),
                "text": block_text_value,
                "imagePath": block.get("imagePath"),
                "csvPath": block.get("csvPath"),
            })

        paragraph_count += len(paragraph_blocks)
        table_count += len(tables)
        figure_count += len(figures)
        pages.append({
            "page": page_num,
            "width": round(page.rect.width, 2),
            "height": round(page.rect.height, 2),
            "text": normalize_text(text),
            "koreanText": korean_pages.get(page_num, ""),
            "blocks": blocks,
            "tableCount": len(tables),
            "figureCount": len(figures),
            "paragraphCount": len(paragraph_blocks),
        })

    pdf.close()

    doc = {
        "id": doc_id,
        "title": metadata.get("title"),
        "sourceFile": metadata.get("sourceFile") or relative(pdf_path),
        "language": "en",
        "koreanDocFile": kr_doc_path,
        "type": "pdf-layout",
        "year": metadata.get("year"),
        "agency": metadata.get("agency"),
        "topics": metadata.get("topics") or [],
        "pageCount": len(pages),
        "paragraphCount": paragraph_count,
        "tableCount": table_count,
        "figureCount": figure_count,
        "assetDir": relative(asset_doc_dir),
        "pages": pages,
    }
    write_json(output_doc_dir / f"{doc_id}.json", doc)
    return doc, search_blocks


def make_index_entry(doc, output_dir):
    return {
        "id": doc["id"],
        "title": doc["title"],
        "sourceFile": doc["sourceFile"],
        "detailFile": relative(Path(output_dir) / "docs" / f"{doc['id']}.json"),
        "language": doc["language"],
        "type": doc["type"],
        "year": doc["year"],
        "agency": doc["agency"],
        "topics": doc["topics"],
        "pageCount": doc["pageCount"],
        "paragraphCount": doc["paragraphCount"],
        "tableCount": doc["tableCount"],
        "figureCount": doc["figureCount"],
        "assetDir": doc["assetDir"],
    }


def main():
    options = parse_args()
    input_dir = Path(options.input_dir).resolve()
    output_dir = Path(options.output_dir).resolve()
    asset_dir = Path(options.asset_dir).resolve()
    index_path = Path(options.index_path).resolve()

    if not input_dir.exists():
        raise SystemExit(f"Input directory does not exist: {relative(input_dir)}")

    reset_dir(output_dir)
    reset_dir(asset_dir)

    by_source, by_stem = load_index(index_path)
    pdfs = collect_pdfs(input_dir, options.file_filter, options.max_docs)
    index = []
    search_blocks = []
    errors = []

    print(f"EMP layout extract: {len(pdfs)} PDF(s)")
    print(f"Input: {relative(input_dir)}")
    print(f"Output: {relative(output_dir)}")
    print(f"Assets: {relative(asset_dir)}")

    for pdf_path in pdfs:
        display = relative(pdf_path)
        print(f"- {display} ... ", end="", flush=True)
        try:
            metadata = find_metadata(pdf_path, by_source, by_stem)
            doc, doc_search_blocks = extract_document(pdf_path, metadata, options)
            index.append(make_index_entry(doc, output_dir))
            search_blocks.extend(doc_search_blocks)
            print(f"{doc['pageCount']} page(s), {doc['tableCount']} table(s), {doc['figureCount']} figure(s)")
        except Exception as exc:
            errors.append({"sourceFile": display, "message": str(exc)})
            print(f"failed: {exc}")

    write_json(output_dir / "index.json", index)
    (output_dir / "block-search-index.jsonl").write_text(
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in search_blocks),
        encoding="utf-8",
    )

    manifest = {
        "kind": "emp-layout-block-extract",
        "parser": "pdfplumber-pypdfium2",
        "inputDir": relative(input_dir),
        "outputDir": relative(output_dir),
        "assetDir": relative(asset_dir),
        "docCount": len(index),
        "sourceFileCount": len(pdfs),
        "pageCount": sum(item["pageCount"] for item in index),
        "paragraphCount": sum(item["paragraphCount"] for item in index),
        "tableCount": sum(item["tableCount"] for item in index),
        "figureCount": sum(item["figureCount"] for item in index),
        "searchBlockCount": len(search_blocks),
        "notes": [
            "Tables are a mix of pdfplumber table detection and low-confidence text-line candidates.",
            "Figures are embedded image crops and caption-based page renders when no embedded image is confidently matched.",
            "Korean page text is linked from data/emp_kr/docs when source-page labels are available.",
        ],
        "errors": errors,
    }
    write_json(output_dir / "manifest.json", manifest)

    print(f"Done. {len(index)} document(s), {manifest['tableCount']} table(s), {manifest['figureCount']} figure(s), {len(errors)} error(s).")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
