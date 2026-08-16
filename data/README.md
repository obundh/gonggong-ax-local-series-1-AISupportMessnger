# Local data directory

This public source distribution does not include legal, precedent, EMP, workplace, transcript, or generated user data.

Use the provided sync and sample-generation scripts to create data locally:

```powershell
npm run law:sync
npm run precedent:sync
npm run legal-ref:sync
npm run legal:vector
npm run safe:docs
npm run safe:layout
```

Keep API credentials outside this directory. Do not commit collected documents or generated indexes until their source, retrieval time, licence, attribution, privacy, and redistribution terms have been reviewed.
