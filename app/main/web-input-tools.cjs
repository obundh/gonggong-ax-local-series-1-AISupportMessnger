const crypto = require("crypto");
const http = require("http");
const net = require("net");

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sleep(ms, token) {
  const end = Date.now() + Math.max(0, ms || 0);
  return new Promise((resolve) => {
    const tick = () => {
      if (token?.canceled || Date.now() >= end) {
        resolve(!token?.canceled);
        return;
      }
      setTimeout(tick, Math.min(50, end - Date.now()));
    };
    tick();
  });
}

function httpJson(port, route, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method: "GET",
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function normalizeWebInputOptions(options = {}) {
  return {
    port: Math.round(clampNumber(options.port, 1, 65535, 9222)),
    targetKeyword: String(options.targetKeyword || "").trim().slice(0, 240),
    targetId: String(options.targetId || "").trim().slice(0, 240),
    delaySeconds: clampNumber(options.delaySeconds, 0, 60, 3),
    restoreClipboard: options.restoreClipboard !== false,
  };
}

function normalizeTargets(targets) {
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => target && target.type === "page" && target.webSocketDebuggerUrl)
    .map((target) => ({
      id: String(target.id || ""),
      title: String(target.title || ""),
      url: String(target.url || ""),
      type: String(target.type || ""),
      webSocketDebuggerUrl: String(target.webSocketDebuggerUrl || ""),
    }));
}

function selectTarget(targets, options = {}) {
  const list = normalizeTargets(targets);
  const targetId = String(options.targetId || "").trim();
  if (targetId) {
    const found = list.find((target) => target.id === targetId);
    if (found) return found;
  }
  const keyword = String(options.targetKeyword || "").trim().toLowerCase();
  if (keyword) {
    const found = list.find((target) => `${target.title}\n${target.url}`.toLowerCase().includes(keyword));
    if (found) return found;
  }
  return list.find((target) => !/^devtools:\/\//i.test(target.url)) || list[0] || null;
}

async function checkWebInputStatus(options = {}) {
  const normalized = normalizeWebInputOptions(options);
  try {
    const [version, targets] = await Promise.all([
      httpJson(normalized.port, "/json/version"),
      httpJson(normalized.port, "/json/list"),
    ]);
    const pages = normalizeTargets(targets);
    const selected = selectTarget(pages, normalized);
    return {
      ok: Boolean(selected),
      port: normalized.port,
      browser: String(version.Browser || "Chromium"),
      selected,
      targets: pages.slice(0, 20).map((target) => ({
        id: target.id,
        title: target.title,
        url: target.url,
      })),
      error: selected ? "" : "연결 가능한 웹 페이지가 없습니다.",
    };
  } catch (error) {
    return {
      ok: false,
      port: normalized.port,
      targets: [],
      error: `127.0.0.1:${normalized.port} 원격 디버깅 브라우저에 연결하지 못했습니다.`,
      detail: error?.message || String(error),
    };
  }
}

class CdpSocket {
  constructor(wsUrl) {
    this.wsUrl = new URL(wsUrl);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const port = Number(this.wsUrl.port || 80);
      const socket = net.createConnection({ host: this.wsUrl.hostname, port });
      let headerBuffer = Buffer.alloc(0);
      let settled = false;
      const timer = setTimeout(() => {
        socket.destroy(new Error("timeout"));
      }, timeoutMs);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      socket.once("connect", () => {
        const request = [
          `GET ${this.wsUrl.pathname}${this.wsUrl.search} HTTP/1.1`,
          `Host: ${this.wsUrl.hostname}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n");
        socket.write(request);
      });

      socket.on("data", (chunk) => {
        if (!this.connected) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const headerEnd = headerBuffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          const header = headerBuffer.slice(0, headerEnd).toString("utf8");
          if (!/^HTTP\/1\.1 101/i.test(header)) {
            fail(new Error("websocket upgrade failed"));
            return;
          }
          this.connected = true;
          this.socket = socket;
          this.buffer = headerBuffer.slice(headerEnd + 4);
          socket.removeAllListeners("data");
          socket.on("data", (nextChunk) => this.readFrames(nextChunk));
          socket.once("close", () => this.rejectPending(new Error("websocket closed")));
          socket.once("error", (error) => this.rejectPending(error));
          if (this.buffer.length) this.readFrames(Buffer.alloc(0));
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
      });

      socket.once("error", fail);
      socket.once("close", () => {
        fail(new Error("websocket closed"));
      });
    });
  }

  close() {
    if (!this.socket) return;
    try {
      this.socket.end();
    } catch (_error) {
      // Already closed.
    }
  }

  rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}, timeoutMs = 8000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.writeFrame(Buffer.from(payload, "utf8"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  writeFrame(payload) {
    this.writeMaskedFrame(0x1, payload);
  }

  writeMaskedFrame(opcode, payload) {
    if (!this.socket || !this.connected) throw new Error("websocket is not connected");
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | payload.length;
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  readFrames(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.slice(offset, offset + length);
      this.buffer = this.buffer.slice(offset + length);
      if (masked && mask) {
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.writePong(payload);
        continue;
      }
      if (opcode !== 0x1) continue;
      this.handleMessage(payload.toString("utf8"));
    }
  }

  writePong(payload) {
    if (!this.socket || !this.connected) return;
    this.writeMaskedFrame(0xa, payload);
  }

  handleMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (_error) {
      return;
    }
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message || "cdp error"));
      return;
    }
    pending.resolve(message.result || {});
  }
}

const KEY_MAP = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  up: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

function keySpec(value) {
  const normalized = String(value || "enter").trim().toLowerCase().replace(/\s+/g, "");
  if (KEY_MAP[normalized]) return KEY_MAP[normalized];
  if (/^[a-z]$/.test(normalized)) {
    return { key: normalized, code: `Key${normalized.toUpperCase()}`, windowsVirtualKeyCode: normalized.toUpperCase().charCodeAt(0) };
  }
  if (/^[0-9]$/.test(normalized)) {
    return { key: normalized, code: `Digit${normalized}`, windowsVirtualKeyCode: normalized.charCodeAt(0) };
  }
  return { key: normalized || "Enter", code: normalized || "Enter", windowsVirtualKeyCode: 0 };
}

async function dispatchKey(client, value, modifiers = 0) {
  const spec = keySpec(value);
  const params = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
    modifiers,
  };
  await client.call("Input.dispatchKeyEvent", { ...params, type: "keyDown" });
  await client.call("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
}

async function dispatchCtrlV(client) {
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 2,
  });
  await dispatchKey(client, "v", 2);
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
  });
}

async function dispatchHotkey(client, value) {
  const parts = String(value || "").split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2) return;
  const last = parts[parts.length - 1];
  const wantsCtrl = parts.includes("ctrl") || parts.includes("control");
  if (wantsCtrl) {
    await client.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
      modifiers: 2,
    });
    await dispatchKey(client, last, 2);
    await client.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
    });
  }
}

async function performStep(client, clipboard, step) {
  const action = String(step?.action || "");
  const value = String(step?.value || "");
  if (action === "pasteText") {
    clipboard.writeText(value);
    await dispatchCtrlV(client);
    return "";
  }
  if (action === "pressKey") {
    await dispatchKey(client, value || "enter");
    return "";
  }
  if (action === "hotkey") {
    await dispatchHotkey(client, value);
    return "";
  }
  if (action === "setClipboard") {
    clipboard.writeText(value);
    return "";
  }
  if (action === "wait") {
    await sleep(clampNumber(step.waitSeconds, 0, 60, 1) * 1000);
    return "";
  }
  return `skipped: unsupported web action ${action || "unknown"}`;
}

async function runWebInput({ clipboard, steps, options, token, onEvent }) {
  const normalized = normalizeWebInputOptions(options);
  const status = await checkWebInputStatus(normalized);
  if (!status.ok || !status.selected?.webSocketDebuggerUrl) {
    throw new Error(status.error || "웹 입력 대상이 없습니다.");
  }

  const client = new CdpSocket(status.selected.webSocketDebuggerUrl);
  let previousClipboard = "";
  let hasPreviousClipboard = false;
  let executed = 0;
  let skipped = 0;

  try {
    if (normalized.restoreClipboard) {
      try {
        previousClipboard = clipboard.readText();
        hasPreviousClipboard = true;
      } catch (_error) {
        hasPreviousClipboard = false;
      }
    }
    await client.connect();
    await client.call("Page.enable").catch(() => {});
    await client.call("Page.bringToFront").catch(() => {});

    onEvent?.({
      type: "status",
      state: "countdown",
      delaySeconds: normalized.delaySeconds,
      targetTitle: status.selected.title,
      targetUrl: status.selected.url,
    });
    if (!(await sleep(normalized.delaySeconds * 1000, token))) {
      onEvent?.({ type: "final", canceled: true, executed: 0, skipped: 0, driver: "web" });
      return;
    }

    onEvent?.({ type: "started", count: steps.length, driver: "web", targetTitle: status.selected.title });
    for (let index = 0; index < steps.length; index += 1) {
      if (token?.canceled) break;
      const step = steps[index];
      const delayBefore = clampNumber(step.delayBefore, 0, 60, 0);
      if (delayBefore > 0 && !(await sleep(delayBefore * 1000, token))) break;
      onEvent?.({ type: "step-start", index, action: step.action, driver: "web" });
      const note = await performStep(client, clipboard, step);
      if (note && note.startsWith("skipped:")) {
        skipped += 1;
        onEvent?.({ type: "step-done", index, skipped: true, note: note.replace("skipped:", "").trim(), driver: "web" });
      } else {
        executed += 1;
        onEvent?.({ type: "step-done", index, note: note || "", driver: "web" });
      }
    }
    onEvent?.({ type: "final", canceled: Boolean(token?.canceled), executed, skipped, driver: "web" });
  } finally {
    if (hasPreviousClipboard) {
      try {
        clipboard.writeText(previousClipboard);
      } catch (_error) {
        // Clipboard restore failure is not important enough to fail the run.
      }
    }
    client.close();
  }
}

module.exports = {
  checkWebInputStatus,
  normalizeWebInputOptions,
  runWebInput,
};
