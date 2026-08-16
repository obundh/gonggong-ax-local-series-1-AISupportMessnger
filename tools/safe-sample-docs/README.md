# Safe Sample Docs

This folder generates self-authored PDF fixtures for parser testing.

Use this when the app needs to test PDF-to-JSON layout parsing without copying
external standards, reports, manuals, images, or official translations.

## Commands

```cmd
npm run safe:docs
npm run safe:layout
```

To launch the desktop app using only the safe EMP test corpus:

```cmd
npm run start:safe
```

## Output

- `data/safe_docs`: generated PDF fixtures
- `data/safe/index.json`: metadata for generated fixtures
- `data/safe_blocks`: parsed JSON/search blocks
- `data/safe_assets`: extracted page/table/figure assets
