# PDF to JSON Verify

Standalone PDF-to-JSON verification tool.

You can copy this `pdftojson-verify` folder to another PC and run it there. It does not need the main messenger project folder.

## Requirements

- Windows
- Python 3.10 or newer

The `vendor` folder contains the Python PDF dependency used by this tool. If `vendor` is missing or broken, run `install.cmd` once. It restores dependencies into this folder with:

```powershell
python -m pip install -r requirements.txt -t vendor --upgrade
```

## Easiest Run

Double-click:

```text
PDF_JSON_Verify.cmd
```

or:

```text
start.cmd
```

The GUI lets you:

- choose a PDF
- choose a report output folder
- limit pages for a quick check
- include or hide decorative images
- open the generated report automatically

## Drag-and-Drop Run

Drag a PDF onto:

```text
verify-pdf.cmd
```

This immediately creates and opens a report.

## CLI Run

```powershell
python verify-pdf.py --input "C:\path\sample.pdf" --max-pages 5 --open
```

## Outputs

By default, reports are written inside this folder:

```text
reports/{pdf-name}-{hash}/index.html
```

Each report contains:

- `index.html`: visual inspection report
- `document.json`: full structured JSON
- `manifest.json`: summary
- `block-search-index.jsonl`: search/RAG-friendly block lines
- `pages/*.png`: page previews
- `figures/*.png`: extracted figure images or caption page renders
- `tables/*.csv`
- `tables/*.md`

## Notes

- Table extraction is automatic and should be treated as review data, not final truth.
- Blocks include `confidence` and `method` so low-confidence results can be reviewed.
- Figure extraction keeps embedded image crops; if a figure caption exists but no reliable crop is found, a page render is used as a fallback.
