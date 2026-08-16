# EMP document ingest

This tool converts the raw files in `data/emp_docs` into structured JSON under `data/emp`.

## Run

```powershell
npm run emp:ingest
```

Useful test run:

```powershell
node tools/emp-ingest/ingest-emp.js --out data/emp_test --max-files 2
```

Custom folders:

```powershell
npm run emp:ingest -- --in data/emp_docs --out data/emp
```

Korean translated PDF ingest:

```powershell
npm run emp:kr:prepare
# Put translated PDFs into data/emp_kr_pdfs using the expected *.ko.pdf names.
npm run emp:kr:ingest
```

## Output

- `data/emp/manifest.json`: ingest metadata and parse errors
- `data/emp/index.json`: document-level index
- `data/emp/search-index.jsonl`: one JSON chunk per line for retrieval/search
- `data/emp/docs/*.json`: full extracted pages and chunks per source document

The source PDFs and text files are not modified.
