const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Series 4 IPC is gated to 김루틴 and exposes only fixed operations", () => {
  const main = read("app/main/main.cjs");
  const preload = read("app/main/preload.cjs");
  const channels = [
    "series4:status",
    "series4:install",
    "series4:install-cancel",
    "series4:launch",
    "series4:sessions:list",
    "series4:session:inspect",
    "series4:video-url",
    "series4:artifact:open",
  ];

  channels.forEach((channel) => {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(\\"${channel.replaceAll(":", "\\:")}\\"`));
    assert.match(preload, new RegExp(channel.replaceAll(":", "\\:")));
  });
  assert.ok(main.split("isContactWindow(event, \"routine-officer\")").length > channels.length);
  assert.doesNotMatch(preload, /resolveArtifact|executablePath|sidecarPath|currentVideoPath/);
  assert.match(main, /protocol\.handle\("heyu-series4", handleSeries4VideoRequest\)/);
  assert.match(main, /pathToFileURL\(artifact\.path\)/);
});

test("renderer receives no coordinates or recorded input payload in the Series 4 timeline", () => {
  const main = read("app/main/main.cjs");
  const renderer = read("app/renderer/chat.js");
  const publicInspection = main.slice(
    main.indexOf("function publicSeries4Inspection"),
    main.indexOf("function broadcastSeries4Progress")
  );
  const timelineNormalizer = renderer.slice(
    renderer.indexOf("function normalizeSeries4Timeline"),
    renderer.indexOf("function series4EventCounts")
  );

  assert.match(publicInspection, /type:[\s\S]*actionKind:[\s\S]*offsetMs:[\s\S]*durationMs:/);
  assert.doesNotMatch(publicInspection, /\bx\s*:|\by\s*:|text|keyCode|modifier|message|path/i);
  assert.match(timelineNormalizer, /return \{ type, offsetMs: Math\.round\(offsetMs\), durationMs:/);
  assert.doesNotMatch(timelineNormalizer, /event\.(?:x|y|text|keyCode|modifier|message|path)/i);
});

test("manual confirmation steps are enabled and require an explicit renderer decision", () => {
  const html = read("app/renderer/chat.html");
  const renderer = read("app/renderer/chat.js");
  const main = read("app/main/main.cjs");
  const runner = read("tools/routine-recorder/runner.py");

  assert.match(html, /<option value="checkpoint">/);
  assert.match(html, /<option value="confirm">/);
  assert.doesNotMatch(html, /<option value="(?:checkpoint|confirm)" disabled/);
  assert.match(renderer, /event\.type === "approval-required"/);
  assert.match(renderer, /resolveRoutineApproval\(\{ token, approved: approved === true \}\)/);
  assert.match(main, /routine:execution-approval/);
  assert.match(runner, /approval-required/);
  assert.match(runner, /action\.lower\(\) in \{"approve", "reject"\}/);
  assert.match(runner, /if command == "approve"/);
});

test("package scripts include focused Series 4 and routine safety checks", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["test:series4-integration"], "node --test tools/test-series4-integration.cjs");
  assert.equal(packageJson.scripts["test:series4-app"], "node --test tools/test-series4-app-integration.cjs");
  assert.equal(packageJson.scripts["test:routine-safety"], "node --test tools/test-routine-safety.cjs");
});

test("bundled Series 4 copy progress reaches the renderer without download wording", () => {
  const main = read("app/main/main.cjs");
  const renderer = read("app/renderer/chat.js");
  const phaseSet = main.match(/const SERIES4_PROGRESS_PHASES = new Set\(\[([^\]]+)\]\)/)?.[1] || "";

  assert.match(phaseSet, /"copying"/);
  assert.doesNotMatch(phaseSet, /"downloading"/);
  assert.match(renderer, /copying:\s*"내장 설치 파일 준비 중"/);
  assert.match(renderer, /내장 설치 파일의 검증과 설치가 끝날 때까지/);
});
