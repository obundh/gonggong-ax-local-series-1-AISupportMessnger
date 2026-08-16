# Series 4 backend integration

`app/main/series4-integration.cjs` is the main-process boundary for the pinned
public Series 4 portable release. The installed application reads only the
verified ZIP bundled beside `app.asar`; it never downloads Series 4 at runtime.
It does not accept a download URL, executable path, launch arguments, or sidecar
path from the renderer.

## Pinned release

- Version: `4.1.1`
- Asset: `GonggongAX-Series4-Portable-x64-v4.1.1.zip`
- Size: `66,232,189` bytes
- SHA-256: `1c7056b0fcad99c42ba85d9d9770e5b35e64207379b2fa20279365a2a052805f`
- URL: `https://github.com/obundh/gonggong-ax-local-4/releases/download/v4.1.1/GonggongAX-Series4-Portable-x64-v4.1.1.zip`

`tools/prepare-series4-bundle.cjs` is the build-time-only fetch boundary. Every
redirect is handled manually and revalidated. The completed download must match
both the pinned byte length and SHA-256, contain the preferred executable and a
redistribution license, and pass ZIP preflight before it replaces
`vendor/series4-bundle` atomically.

The Electron build must copy that ignored staging directory as an extra resource:

```json
{
  "from": "vendor/series4-bundle",
  "to": "series4-bundle"
}
```

Run `node tools/prepare-series4-bundle.cjs` before `electron-builder`. A missing,
changed, linked, truncated, or hash-mismatched bundle fails closed; the installed
application does not fall back to the network.

## Factory

```js
const { createSeries4Integration } = require("./series4-integration.cjs");

const series4 = createSeries4Integration({
  userDataDir: app.getPath("userData"),
  roots: {
    videosDir: app.getPath("videos"),
    localAppDataDir: process.env.LOCALAPPDATA,
  },
  onProgress(event) {
    // Forward only this already-sanitized progress object when needed.
  },
});
```

Tests may inject `resourcesPath`, `fs`, `spawnImpl`, `extractZip`, `platform`,
and the two roots. Production callers should not construct resource, executable,
or artifact paths from IPC payloads.

## Public manager contract

### `await getStatus()`

Returns:

```js
{
  ok,
  state, // ready | installing | repair-required | not-installed
  installed,
  installing,
  launchable,
  version,
  platform,
  architecture,
  installedAt,
  package: { source: "bundled-installer-resource", bytes },
  progress: null | {
    operation: "series4-install",
    phase, // starting | copying | verifying | extracting | installing | complete
    version,
    downloadedBytes,
    totalBytes
  }
}
```

No managed root, executable path, download URL, or local artifact path is
included.

### `await install({ onProgress?, signal?, timeoutMs? })`

Installs the one pinned bundled release atomically below `userDataDir/series4`.
A valid existing installation is reused. An invalid prior installation is
replaced only after the bundled ZIP and extracted payload have passed validation;
rollback restores it if the commit does not finish.

### `cancelInstall()`

Returns `{ ok: true, canceled }`. Cancellation removes an uncommitted staging
payload.

### `await launch()`

Takes no arguments. It launches only the executable from the verified private
receipt with an empty argument array and `shell: false`.

### `await listSessions({ limit? })`

Scans only these two application-owned roots:

- `<videosDir>/공공AX 업무 매크로`
- `<localAppDataDir>/공공AX 업무 매크로`

The scan has entry, candidate, result-count, file-size, event-count, and tree-depth
limits. Each returned item has a process-local opaque `sessionId`, schema/status
metadata, safe event counts, safe event-type counts, duration, and
`videoAvailable`. It has no path, filename, raw text, key code, modifier, message,
or event timeline.

### `await inspectSession(sessionId)` / `await readSession(sessionId)`

Reopens and revalidates the selected sidecar. It returns the safe session metadata
plus at most 500 timeline items:

```js
{
  type,
  actionKind,
  offsetMs,
  durationMs,
  x,
  y
}
```

`type` and `actionKind` are allowlisted Series 4 action names (or `Other`). No
recorded text, message, key code, modifier, path, or unrecognized label is copied
to the result.

### `await importSession(sessionId)`

Revalidates the selected sidecar and returns a new opaque `importId` plus the same
sanitized metadata/timeline. It retains a private main-process capability to the
original artifact; it does not duplicate the MP4 or JSON.

## Main-process-only artifact resolution

`await resolveArtifact(sessionOrImportId, "video" | "folder")` returns an absolute
trusted path for a main-process custom protocol or open-folder operation. The
method revalidates the sidecar and artifact immediately before returning.

Do not expose `resolveArtifact` through preload. A renderer-facing handler should
perform the desired fixed operation in the main process and return only success or
a sanitized error code.

## Verification

Run the isolated backend tests without starting an external GUI:

```powershell
node --test tools/test-series4-integration.cjs
```

The focused test suite includes a fresh-user-data installation with a network
function that throws. It must finish from the bundled resource with zero requests.
