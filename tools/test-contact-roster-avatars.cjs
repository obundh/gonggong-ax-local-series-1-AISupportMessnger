"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(projectRoot, "app", "renderer");
const dataPath = path.join(rendererRoot, "data.js");

const removedContacts = new Map([
  ["presentation-officer", "김부래"],
  ["report", "김보고"],
  ["emp-standard", "김준파"],
  ["technical-translator", "김번기"],
  ["document-converter", "김변한"],
  ["graph-officer", "김그래"],
  ["frustration-officer", "김답답"],
]);

// Keep the original HEYU assignments plus the new non-human 김자원 asset
// explicit so a generic icon or shared placeholder cannot silently replace one.
const retainedContacts = new Map([
  ["chief", { name: "김법률", avatar: "assets/avatars/lawai.png" }],
  ["admin-officer", { name: "김행정", avatar: "assets/avatars/hangjeongai.png" }],
  ["translator", { name: "김국어", avatar: "assets/avatars/langai.png" }],
  ["file-converter", { name: "김병환", avatar: "assets/avatars/byeonghwanai.png" }],
  ["language", { name: "김언심", avatar: "assets/avatars/languageai.png" }],
  ["image-officer", { name: "김그림", avatar: "assets/avatars/geurimai.png" }],
  ["steno-officer", { name: "김속기", avatar: "assets/avatars/sokgiai.png" }],
  ["resource-officer", { name: "김자원", avatar: "assets/avatars/jawonai.png" }],
  ["privacy-officer", { name: "김개보", avatar: "assets/avatars/gaeboai.png" }],
  ["routine-officer", { name: "김루틴", avatar: "assets/avatars/routineai.png" }],
  ["nori", { name: "김노리", avatar: "assets/avatars/noriai.png" }],
]);

function loadData() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
  assert.ok(sandbox.window.HEYU_DATA, "data.js must assign window.HEYU_DATA");
  return sandbox.window.HEYU_DATA;
}

function normalizedRelativeFile(relativePath, label) {
  assert.equal(typeof relativePath, "string", `${label} must be a relative file path`);
  assert.ok(relativePath.trim(), `${label} must not be empty`);
  assert.ok(!path.isAbsolute(relativePath), `${label} must remain portable (not absolute)`);
  assert.ok(!/^(?:data|https?):/i.test(relativePath), `${label} must use a bundled local asset`);

  const absolutePath = path.resolve(rendererRoot, relativePath);
  const allowedPrefix = `${rendererRoot}${path.sep}`;
  assert.ok(absolutePath.startsWith(allowedPrefix), `${label} must stay inside app/renderer`);
  return absolutePath;
}

function inspectPng(absolutePath, label) {
  assert.ok(fs.existsSync(absolutePath), `${label} is missing: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  assert.ok(bytes.length >= 32 * 1024, `${label} is suspiciously small (${bytes.length} bytes)`);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${label} must be a valid PNG asset`,
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width >= 128 && height >= 128, `${label} resolution is too small (${width}x${height})`);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function main() {
  const data = loadData();
  assert.ok(Array.isArray(data.contacts), "HEYU_DATA.contacts must be an array");

  // Array.from also normalizes the VM-realm array into this process realm so
  // strict structural assertions do not fail only because of prototypes.
  const actualIds = Array.from(data.contacts, (contact) => contact.id);
  const actualNames = Array.from(data.contacts, (contact) => contact.name);
  assert.equal(new Set(actualIds).size, actualIds.length, "contact ids must be unique");
  assert.equal(new Set(actualNames).size, actualNames.length, "contact names must be unique");

  for (const [id, name] of removedContacts) {
    assert.ok(!actualIds.includes(id), `${name} (${id}) must not remain in contacts`);
    assert.ok(!actualNames.includes(name), `${name} must not remain in contacts`);
    assert.ok(!Object.prototype.hasOwnProperty.call(data.messages || {}, id), `${name} chat seed must be removed`);
    assert.ok(!(data.files || []).some((item) => item.owner === name), `${name} must not remain as a visible file owner`);
    assert.ok(!JSON.stringify(data.contacts).includes(name), `${name} must not be referenced by retained contacts`);
  }

  assert.deepEqual(
    [...actualIds].sort(),
    [...retainedContacts.keys()].sort(),
    "the contact roster must contain exactly the eleven retained and added officers",
  );

  const avatarHashes = new Map();
  for (const contact of data.contacts) {
    const expected = retainedContacts.get(contact.id);
    assert.ok(expected, `unexpected retained contact: ${contact.id}`);
    assert.equal(contact.name, expected.name, `${contact.id} name changed unexpectedly`);
    assert.equal(contact.avatarImage, expected.avatar, `${contact.name} must use the original avatar assignment`);
    assert.equal(contact.avatarFallback, expected.avatar, `${contact.name} fallback must point to the restored avatar`);
    assert.ok(!/(?:placeholder|default|generic|robot|bot)/i.test(path.basename(contact.avatarImage)), `${contact.name} uses a placeholder-like filename`);

    const absoluteAvatarPath = normalizedRelativeFile(contact.avatarImage, `${contact.name} avatarImage`);
    const absoluteFallbackPath = normalizedRelativeFile(contact.avatarFallback, `${contact.name} avatarFallback`);
    assert.equal(absoluteFallbackPath, absoluteAvatarPath, `${contact.name} avatar and fallback must resolve consistently`);
    avatarHashes.set(contact.id, inspectPng(absoluteAvatarPath, `${contact.name} avatar`));
  }

  assert.equal(
    new Set(avatarHashes.values()).size,
    retainedContacts.size,
    "each retained officer must have a distinct profile image (no shared placeholder)",
  );

  const resourceOfficer = data.contacts.find((contact) => contact.id === "resource-officer");
  assert.ok(resourceOfficer, "김자원 contact must exist");
  assert.match(resourceOfficer.persona?.character || "", /24세 여성/, "김자원 age and identity must remain explicit");
  assert.match(resourceOfficer.persona?.character || "", /사람 사진 대신/, "김자원 profile direction must remain non-human");
  assert.match(resourceOfficer.persona?.systemPrompt || "", /문서의 바이트나 본문은 채팅 LLM으로 자동 전송되지/, "김자원 must keep the local-document/chat-provider boundary");

  const chatHtml = fs.readFileSync(path.join(rendererRoot, "chat.html"), "utf8");
  const chatSource = fs.readFileSync(path.join(rendererRoot, "chat.js"), "utf8");
  assert.match(chatHtml, /id="documentResourcePanel"/, "김자원 right panel must exist");
  assert.match(chatHtml, /지원 형식 33종 보기/, "김자원 panel must disclose the 33 supported formats");
  for (const apiName of [
    "selectDocumentResourceFile",
    "analyzeDocumentResources",
    "cancelDocumentResourceJob",
    "previewDocumentResource",
    "saveDocumentResource",
    "saveAllDocumentResources",
    "clearDocumentResourceSession",
    "openDocumentResourceOutput",
    "onDocumentResourceProgress",
  ]) {
    assert.ok(chatSource.includes(apiName), `김자원 renderer must use ${apiName}`);
  }
  assert.doesNotMatch(chatSource, /dataTransfer\s*\.\s*files/, "김자원 drop guide must not read raw OS file drops");
  assert.match(chatSource, /isDocumentResourceOfficer\(\)\s*\?\s*\[\]/, "김자원 documents must not enter the chat LLM file payload");

  console.log(`PASS: ${removedContacts.size} contacts removed; ${retainedContacts.size} avatar mappings and 김자원 UI boundary verified.`);
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
