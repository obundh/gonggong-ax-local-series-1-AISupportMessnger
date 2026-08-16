const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const RUNNER = path.join(ROOT, "tools", "routine-recorder", "runner.py");
const RECORDER_DIR = path.join(ROOT, "tools", "routine-recorder");
const PYTHON = process.env.HEYU_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");

function makeStubRuntime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-routine-test-"));
  fs.writeFileSync(
    path.join(dir, "pyautogui.py"),
    [
      "import json, os",
      "PAUSE = 0",
      "FAILSAFE = False",
      "class FailSafeException(Exception): pass",
      "def _log(name, *args, **kwargs):",
      "    target = os.environ.get('HEYU_ROUTINE_STUB_LOG')",
      "    if target:",
      "        with open(target, 'a', encoding='utf-8') as handle:",
      "            handle.write(json.dumps({'name': name, 'args': args, 'kwargs': kwargs}) + '\\n')",
      "def __getattr__(name):",
      "    def call(*args, **kwargs): _log(name, *args, **kwargs)",
      "    return call",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "pyperclip.py"),
    "_value = ''\ndef paste(): return _value\ndef copy(value):\n global _value\n _value = value\n",
    "utf8",
  );
  const packageDir = path.join(dir, "pynput");
  fs.mkdirSync(packageDir);
  fs.writeFileSync(path.join(packageDir, "__init__.py"), "from . import keyboard, mouse\n", "utf8");
  fs.writeFileSync(
    path.join(packageDir, "keyboard.py"),
    [
      "class KeyCode:",
      "    def __init__(self, char=None): self.char = char",
      "class Listener:",
      "    def __init__(self, **kwargs): pass",
      "    def start(self): pass",
      "    def stop(self): pass",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(packageDir, "mouse.py"),
    "class Listener:\n def __init__(self, **kwargs): pass\n def start(self): pass\n def stop(self): pass\n",
    "utf8",
  );
  return dir;
}

function runApprovalScenario(decision) {
  const stubDir = makeStubRuntime();
  const stepsPath = path.join(stubDir, "steps.json");
  const logPath = path.join(stubDir, "calls.ndjson");
  fs.writeFileSync(
    stepsPath,
    JSON.stringify([
      { action: "mouseDown", button: "left" },
      { action: "keyDown", value: "ctrl" },
      { action: "confirm" },
      { action: "click", x: 10, y: 20 },
    ]),
    "utf8",
  );

  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [RUNNER, "--steps-file", stepsPath, "--countdown", "0", "--output-dir", stubDir], {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONPATH: [stubDir, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
        HEYU_ROUTINE_STUB_LOG: logPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const messages = [];
    let stdout = "";
    let stderr = "";
    let approvalSeenAt = 0;
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        messages.push(message);
        if (message.type === "approval-required" && !approvalSeenAt) {
          approvalSeenAt = Date.now();
          setTimeout(() => child.stdin.write(`${decision} ${message.token}\n`), 120);
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(code, 0, stderr);
        assert.ok(approvalSeenAt > 0, "approval-required must be emitted");
        assert.ok(Date.now() - approvalSeenAt >= 100, "runner must wait for an explicit decision");
        const calls = fs.existsSync(logPath)
          ? fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
          : [];
        resolve({ messages, calls });
      } catch (error) {
        reject(error);
      } finally {
        fs.rmSync(stubDir, { recursive: true, force: true });
      }
    });
  });
}

test("confirm blocks until approval and releases held inputs", async () => {
  const { messages, calls } = await runApprovalScenario("approve");
  assert.ok(messages.some((item) => item.type === "approval-resolved" && item.approved === true));
  assert.ok(calls.some((item) => item.name === "click"), "approved run should continue");
  assert.ok(calls.some((item) => item.name === "keyUp" && item.args[0] === "ctrl"));
  assert.ok(calls.some((item) => item.name === "mouseUp" && item.kwargs.button === "left"));
});

test("rejected approval cancels later actions and still releases inputs", async () => {
  const { messages, calls } = await runApprovalScenario("reject");
  assert.ok(messages.some((item) => item.type === "approval-resolved" && item.approved === false));
  assert.ok(messages.some((item) => item.type === "final" && item.canceled === true));
  assert.equal(calls.some((item) => item.name === "click"), false, "rejected run must not continue");
  assert.ok(calls.some((item) => item.name === "keyUp"));
  assert.ok(calls.some((item) => item.name === "mouseUp"));
});

test("whole routine repeats the requested finite number of cycles", async () => {
  const stubDir = makeStubRuntime();
  const stepsPath = path.join(stubDir, "steps.json");
  const logPath = path.join(stubDir, "calls.ndjson");
  fs.writeFileSync(stepsPath, JSON.stringify([{ action: "click", x: 10, y: 20 }]), "utf8");

  const result = spawnSync(
    PYTHON,
    [RUNNER, "--steps-file", stepsPath, "--countdown", "0", "--output-dir", stubDir, "--repeat-count", "3"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONPATH: [stubDir, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
        HEYU_ROUTINE_STUB_LOG: logPath,
      },
      encoding: "utf8",
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const cycleStarts = messages.filter((item) => item.type === "cycle-start");
    const final = messages.find((item) => item.type === "final");
    const calls = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.deepEqual(cycleStarts.map((item) => item.cycle), [1, 2, 3]);
    assert.equal(calls.filter((item) => item.name === "click").length, 3);
    assert.equal(final?.cyclesCompleted, 3);
    assert.equal(final?.canceled, false);
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test("infinite routine stops promptly and releases held inputs", async () => {
  const stubDir = makeStubRuntime();
  const stepsPath = path.join(stubDir, "steps.json");
  const logPath = path.join(stubDir, "calls.ndjson");
  fs.writeFileSync(
    stepsPath,
    JSON.stringify([
      { action: "mouseDown", button: "left" },
      { action: "keyDown", value: "ctrl" },
      { action: "wait", waitSeconds: 30 },
    ]),
    "utf8",
  );

  await new Promise((resolve, reject) => {
    const child = spawn(
      PYTHON,
      [RUNNER, "--steps-file", stepsPath, "--countdown", "0", "--output-dir", stubDir, "--repeat-forever"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PYTHONPATH: [stubDir, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
          HEYU_ROUTINE_STUB_LOG: logPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const messages = [];
    let stdout = "";
    let stderr = "";
    let stopRequestedAt = 0;
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        messages.push(message);
        if (message.type === "step-start" && message.index === 2 && !stopRequestedAt) {
          stopRequestedAt = Date.now();
          child.stdin.write("stop\n");
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(code, 0, stderr);
        assert.ok(stopRequestedAt > 0, "test must request stop during the long wait");
        assert.ok(Date.now() - stopRequestedAt < 1500, "stop should interrupt the wait promptly");
        const final = messages.find((item) => item.type === "final");
        const calls = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
        assert.equal(final?.canceled, true);
        assert.ok(calls.some((item) => item.name === "keyUp" && item.args[0] === "ctrl"));
        assert.ok(calls.some((item) => item.name === "mouseUp" && item.kwargs.button === "left"));
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        fs.rmSync(stubDir, { recursive: true, force: true });
      }
    });
  });
});

test("recorder pause and redaction remove captured text without echoing it", () => {
  const stubDir = makeStubRuntime();
  const script = [
    "import json, sys, time",
    `sys.path.insert(0, ${JSON.stringify(RECORDER_DIR)})`,
    "from recorder import RoutineRecorder, keyboard",
    "r = RoutineRecorder(0)",
    "r.started_at = time.time()",
    "r.last_event_time = r.started_at",
    "r.on_key_press(keyboard.KeyCode('a'))",
    "r.pause_capture()",
    "r.on_key_press(keyboard.KeyCode('b'))",
    "r.redact_last_text()",
    "r.resume_capture()",
    "r.on_key_press(keyboard.KeyCode('c'))",
    "r.flush_text()",
    "print(json.dumps({'steps': r.steps}))",
  ].join("\n");
  const result = spawnSync(PYTHON, ["-c", script], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: stubDir },
    encoding: "utf8",
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const state = lines.at(-1);
    assert.deepEqual(state.steps.map((item) => item.value), ["c"]);
    assert.equal(lines.some((item) => JSON.stringify(item).includes('"b"')), false);
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});
