# EMP Korean PDF pipeline

This is the intended no-API flow:

```text
data/emp_docs/*.pdf
-> translated Korean PDFs in data/emp_kr_pdfs
-> data/emp_kr JSON/search chunks
```

## 1. Prepare the PDF translation list

```powershell
npm run emp:kr:prepare
```

This creates:

- `data/emp_pdf_translation/manifest.json`
- `data/emp_pdf_translation/translation-list.csv`
- `data/emp_pdf_translation/README.md`
- `data/emp_kr_pdfs/`

Translate each PDF in `data/emp_docs`, then save the translated PDF using the `expectedKoreanPdf` path from the manifest or CSV.

Example:

```text
data/emp_docs/DOE_EMP_Resilience_Action_Plan_2017.pdf
-> data/emp_kr_pdfs/DOE_EMP_Resilience_Action_Plan_2017.ko.pdf
```

## 2. Ingest translated Korean PDFs

If you want this project to create Korean text PDFs automatically, run:

```powershell
npm run emp:kr:pdfs
```

This creates `data/emp_kr_pdfs/*.ko.pdf` from the structured English text in `data/emp`.

Then ingest the Korean PDFs:

```powershell
npm run emp:kr:ingest
```

This reads `data/emp_kr_pdfs/*.ko.pdf` and writes:

- `data/emp_kr/manifest.json`
- `data/emp_kr/index.json`
- `data/emp_kr/search-index.jsonl`
- `data/emp_kr/docs/*.json`

The generated Korean JSON keeps `originalSourceFile` so the translated PDF can be traced back to the original English PDF.
