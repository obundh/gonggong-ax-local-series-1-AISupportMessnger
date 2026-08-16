from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium


class Rect:
    def __init__(self, value):
        if isinstance(value, Rect):
            self.x0, self.y0, self.x1, self.y1 = value.x0, value.y0, value.x1, value.y1
        elif isinstance(value, dict):
            self.x0 = value.get("x0", 0)
            self.y0 = value.get("top", value.get("y0", 0))
            self.x1 = value.get("x1", 0)
            self.y1 = value.get("bottom", value.get("y1", 0))
        else:
            x0, y0, x1, y1 = value
            self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1

    @property
    def width(self):
        return max(0, self.x1 - self.x0)

    @property
    def height(self):
        return max(0, self.y1 - self.y0)


class Matrix:
    def __init__(self, x=1.0, y=None):
        self.x = float(x or 1.0)
        self.y = float(y if y is not None else self.x)

    @property
    def scale(self):
        return max(self.x, self.y)


class Pixmap:
    def __init__(self, image):
        self.image = image.convert("RGB")

    @property
    def samples(self):
        return self.image.tobytes()

    def save(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.image.save(path)


class TableResult:
    def __init__(self, tables):
        self.tables = tables


class Table:
    def __init__(self, source):
        self._source = source
        self.bbox = getattr(source, "bbox", None)

    def extract(self):
        return self._source.extract()


class Page:
    def __init__(self, document, index, plumber_page):
        self._document = document
        self._index = index
        self._page = plumber_page
        self.rect = Rect([0, 0, float(plumber_page.width), float(plumber_page.height)])

    def get_text(self, kind="text"):
        if kind == "dict":
            return {"blocks": self._text_blocks()}
        return self._page.extract_text(x_tolerance=1, y_tolerance=3) or ""

    def find_tables(self):
        try:
            tables = self._page.find_tables()
        except Exception:
            tables = []
        return TableResult([Table(table) for table in tables])

    def get_images(self, full=False):
        return [(index + 1,) for index, _image in enumerate(self._page.images or [])]

    def get_image_rects(self, xref):
        index = int(xref) - 1
        images = self._page.images or []
        if index < 0 or index >= len(images):
            return []
        return [Rect(images[index])]

    def get_pixmap(self, matrix=None, clip=None, alpha=False):
        scale = (matrix.scale if matrix else 1.0) or 1.0
        pdfium_page = self._document._render_doc[self._index]
        bitmap = pdfium_page.render(scale=scale)
        image = bitmap.to_pil().convert("RGB")
        if clip:
            rect = Rect(clip)
            crop_box = (
                max(0, int(rect.x0 * scale)),
                max(0, int(rect.y0 * scale)),
                min(image.width, int(rect.x1 * scale)),
                min(image.height, int(rect.y1 * scale)),
            )
            if crop_box[2] > crop_box[0] and crop_box[3] > crop_box[1]:
                image = image.crop(crop_box)
        return Pixmap(image)

    def _text_blocks(self):
        words = self._page.extract_words(x_tolerance=1, y_tolerance=3, keep_blank_chars=False, use_text_flow=True) or []
        if not words:
            text = self.get_text("text")
            return [
                {
                    "type": 0,
                    "bbox": [0, 0, self.rect.width, self.rect.height],
                    "lines": [{"spans": [{"text": line}]} for line in text.splitlines() if line.strip()],
                }
            ] if text else []

        lines = []
        for word in words:
            placed = False
            y_mid = (float(word["top"]) + float(word["bottom"])) / 2
            for line in lines:
                if abs(line["y_mid"] - y_mid) <= 3:
                    line["words"].append(word)
                    line["y_mid"] = (line["y_mid"] + y_mid) / 2
                    placed = True
                    break
            if not placed:
                lines.append({"y_mid": y_mid, "words": [word]})

        lines.sort(key=lambda line: (min(word["top"] for word in line["words"]), min(word["x0"] for word in line["words"])))
        blocks = []
        current = []
        previous_bottom = None
        for line in lines:
            line_words = sorted(line["words"], key=lambda word: word["x0"])
            top = min(word["top"] for word in line_words)
            bottom = max(word["bottom"] for word in line_words)
            if current and previous_bottom is not None and top - previous_bottom > 11:
                blocks.append(self._make_block(current))
                current = []
            current.append(line_words)
            previous_bottom = bottom
        if current:
            blocks.append(self._make_block(current))
        return blocks

    def _make_block(self, line_groups):
        all_words = [word for line in line_groups for word in line]
        return {
            "type": 0,
            "bbox": [
                min(word["x0"] for word in all_words),
                min(word["top"] for word in all_words),
                max(word["x1"] for word in all_words),
                max(word["bottom"] for word in all_words),
            ],
            "lines": [
                {"spans": [{"text": " ".join(word["text"] for word in line)}]}
                for line in line_groups
            ],
        }


class Document:
    def __init__(self, pdf_path):
        self.path = str(pdf_path)
        self._plumber_doc = pdfplumber.open(self.path)
        self._render_doc = pdfium.PdfDocument(self.path)
        self.metadata = self._plumber_doc.metadata or {}

    def __len__(self):
        return len(self._plumber_doc.pages)

    def __getitem__(self, index):
        return Page(self, index, self._plumber_doc.pages[index])

    def close(self):
        self._plumber_doc.close()
        try:
            self._render_doc.close()
        except Exception:
            pass


def open(pdf_path):
    return Document(pdf_path)
