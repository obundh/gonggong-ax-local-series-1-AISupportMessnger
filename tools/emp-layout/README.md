# EMP layout extraction

Extracts PDF layout blocks for local RAG use:

- paragraph blocks from PDF text
- table blocks as CSV, Markdown, and cell arrays
- figure blocks as cropped PNG assets when embedded images or figure captions are found
- optional Korean page text linked from `data/emp_kr/docs`

Run:

```powershell
python -m pip install -r tools\emp-layout\requirements.txt
npm run emp:layout
```

Useful test runs:

```powershell
python tools\emp-layout\extract-layout.py --file CISA_NCC --max-pages 4 --out data\emp_blocks_test --assets data\emp_assets_test
python tools\emp-layout\extract-layout.py --max-docs 2
```

Main outputs:

- `data/emp_blocks/manifest.json`
- `data/emp_blocks/index.json`
- `data/emp_blocks/docs/{docId}.json`
- `data/emp_blocks/block-search-index.jsonl`
- `data/emp_assets/{docId}/figures/*.png`
- `data/emp_assets/{docId}/tables/*.csv`

Notes:

- Table extraction combines pdfplumber table detection with conservative text-line candidates.
- Figure extraction keeps embedded image crops and renders full page images for caption-only figure references.
- Low-confidence blocks are kept with `confidence` and `method` fields so the app can review or filter them later.
