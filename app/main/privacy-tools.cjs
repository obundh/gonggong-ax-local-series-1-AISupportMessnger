const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PRIVACY_TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".log",
  ".yaml",
  ".yml",
  ".ini",
  ".conf",
  ".html",
  ".htm",
]);
const PRIVACY_TEXT_FILE_MAX_BYTES = 10 * 1024 * 1024;

const WINDOW_LIST_SCRIPT = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32WindowList {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$items = New-Object System.Collections.Generic.List[object]
$callback = [Win32WindowList+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32WindowList]::IsWindowVisible($hWnd)) { return $true }
  $length = [Win32WindowList]::GetWindowTextLength($hWnd)
  if ($length -le 0) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][Win32WindowList]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString().Trim()
  if (-not $title) { return $true }
  [uint32]$processIdValue = 0
  [void][Win32WindowList]::GetWindowThreadProcessId($hWnd, [ref]$processIdValue)
  $processName = ""
  $commandLine = ""
  try { $processName = (Get-Process -Id $processIdValue -ErrorAction Stop).ProcessName } catch {}
  try { $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$processIdValue" -ErrorAction Stop).CommandLine } catch {}
  $items.Add([pscustomobject]@{
    handle = $hWnd.ToInt64().ToString()
    title = $title
    processId = [int]$processIdValue
    processName = $processName
    commandLine = $commandLine
  }) | Out-Null
  return $true
}
[void][Win32WindowList]::EnumWindows($callback, [IntPtr]::Zero)
$items | ConvertTo-Json -Depth 4 -Compress
`;

const COPY_WINDOW_TEXT_SCRIPT = `
param([Int64]$Handle)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
Add-Type -AssemblyName System.Windows.Forms
$hWnd = [IntPtr]::new($Handle)
[uint32]$targetProcessId = 0
$targetThreadId = [Win32WindowFocus]::GetWindowThreadProcessId($hWnd, [ref]$targetProcessId)
try {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate([int]$targetProcessId)
} catch {}
[void][Win32WindowFocus]::ShowWindowAsync($hWnd, 9)
Start-Sleep -Milliseconds 180
[void][Win32WindowFocus]::BringWindowToTop($hWnd)
[void][Win32WindowFocus]::SetForegroundWindow($hWnd)
Start-Sleep -Milliseconds 300
$foreground = [Win32WindowFocus]::GetForegroundWindow()
if ($foreground.ToInt64() -ne $hWnd.ToInt64()) {
  [uint32]$foregroundProcessId = 0
  $foregroundThreadId = [Win32WindowFocus]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)
  $currentThreadId = [Win32WindowFocus]::GetCurrentThreadId()
  [void][Win32WindowFocus]::AttachThreadInput($currentThreadId, $foregroundThreadId, $true)
  [void][Win32WindowFocus]::AttachThreadInput($currentThreadId, $targetThreadId, $true)
  [void][Win32WindowFocus]::BringWindowToTop($hWnd)
  [void][Win32WindowFocus]::SetForegroundWindow($hWnd)
  Start-Sleep -Milliseconds 250
  [void][Win32WindowFocus]::AttachThreadInput($currentThreadId, $targetThreadId, $false)
  [void][Win32WindowFocus]::AttachThreadInput($currentThreadId, $foregroundThreadId, $false)
}
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 160
[System.Windows.Forms.SendKeys]::SendWait("^c")
Start-Sleep -Milliseconds 360
Write-Output "ok"
`;

async function runPowerShell(script, args = [], timeoutMs = 10000) {
  if (process.platform !== "win32") {
    throw new Error("Window inspection is only available on Windows.");
  }
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, ...args.map(String)],
    {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  return String(result.stdout || "").trim();
}

async function listOpenWindows() {
  if (process.platform !== "win32") return [];
  const raw = await runPowerShell(WINDOW_LIST_SCRIPT, [], 12000);
  let parsed = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch (_error) {
    parsed = [];
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const seen = new Set();
  return rows
    .map(normalizeWindowInfo)
    .filter((item) => item.handle && item.title)
    .filter((item) => {
      const key = `${item.handle}:${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function normalizeWindowInfo(item) {
  const processName = String(item?.processName || "").trim();
  const title = String(item?.title || "").replace(/\s+/g, " ").trim();
  const commandLine = String(item?.commandLine || "").trim();
  const appType = classifyWindow(processName, title);
  const method = extractionMethod(appType);
  return {
    id: String(item?.handle || ""),
    handle: String(item?.handle || ""),
    title,
    processId: Number(item?.processId || 0),
    processName,
    commandLine,
    appType,
    method: method.kind,
    methodLabel: method.label,
    note: method.note,
  };
}

function classifyWindow(processName, title) {
  const process = String(processName || "").toLowerCase();
  const value = `${process} ${title || ""}`.toLowerCase();
  if (/chrome|msedge|firefox|whale|iexplore|brave|vivaldi/.test(process)) return "web";
  if (/hwp|hcell|hshow|hanword/.test(process) || /\.(hwp|hwpx)\b/i.test(title)) return "hwp";
  if (/winword/.test(process) || /\.docx?\b/i.test(title)) return "word";
  if (/excel/.test(process) || /\.xlsx?\b/i.test(title)) return "spreadsheet";
  if (/powerpnt/.test(process) || /\.pptx?\b/i.test(title)) return "presentation";
  if (/acrord|acrobat|pdf|sumatrapdf/.test(process) || /\.pdf\b/i.test(title)) return "pdf";
  if (/notepad|wordpad|code|notepad\+\+/.test(process) || /\.(txt|md|csv|json|xml)\b/i.test(title)) return "text";
  return "app";
}

function extractionMethod(appType) {
  if (appType === "web") {
    return { kind: "clipboard", label: "클립보드 검사", note: "확장 없이 전체 선택/복사로 읽습니다." };
  }
  if (appType === "hwp") {
    return { kind: "clipboard-or-file", label: "한글 클립보드 검사", note: "실패하면 HWP/HWPX 파일을 받아 검사해야 합니다." };
  }
  if (["word", "spreadsheet", "presentation", "pdf", "text"].includes(appType)) {
    return { kind: "clipboard-or-file", label: "문서 클립보드 검사", note: "파일 직접 검사가 더 안정적입니다." };
  }
  return { kind: "clipboard", label: "보이는 텍스트 검사", note: "복사가 안 되면 텍스트 입력이나 파일 첨부가 필요합니다." };
}

async function inspectOpenWindows(selectedWindows, clipboardApi, options = {}) {
  const windows = (Array.isArray(selectedWindows) ? selectedWindows : [])
    .map(normalizeWindowInfo)
    .filter((item) => item.handle && item.title)
    .slice(0, 10);
  const results = [];
  for (const win of windows) {
    results.push(await inspectOneWindow(win, clipboardApi, options));
  }
  return {
    ok: true,
    inspected: results.length,
    results,
    totals: summarizeResults(results),
  };
}

async function inspectOneWindow(win, clipboardApi, options = {}) {
  const fileText = tryReadTextWindowFile(win, options);
  if (fileText.ok) {
    return buildTextScanResult(win, fileText.text, {
      sourceMethod: "file",
      guidance: "창 제목에서 찾은 실제 텍스트 파일을 직접 읽어 검사했습니다. 원본 파일은 수정하지 않았습니다.",
      samplePath: fileText.path,
    });
  }

  const backup = backupClipboard(clipboardApi);
  let text = "";
  let error = "";
  try {
    clipboardApi?.clear?.();
    await runPowerShell(COPY_WINDOW_TEXT_SCRIPT, [win.handle], 8000);
    text = String(clipboardApi?.readText?.() || "").trim();
  } catch (scanError) {
    error = scanError?.message || String(scanError);
  } finally {
    restoreClipboard(clipboardApi, backup);
  }

  if (!text || text.length < 2) {
    return {
      ...win,
      ok: false,
      status: "unreadable",
      textLength: 0,
      findings: [],
      summary: {},
      error: error || "선택/복사로 읽을 수 있는 텍스트가 없습니다.",
      guidance: unreadableGuidance(win),
    };
  }

  return buildTextScanResult(win, text, {
    sourceMethod: "clipboard",
    guidance: "검출 항목을 확인한 뒤 원본이 아니라 복사본이나 입력칸에서 마스킹하세요.",
  });
}

function buildTextScanResult(win, text, meta = {}) {
  const scan = scanPrivacyText(text);
  return {
    ...win,
    ok: true,
    status: scan.findings.length ? "risk" : "clean",
    textLength: text.length,
    sample: scan.maskedText.slice(0, 180),
    samplePath: meta.samplePath || "",
    sourceMethod: meta.sourceMethod || "clipboard",
    findings: scan.findings,
    summary: scan.summary,
    guidance: scan.findings.length ? meta.guidance || "검출 항목을 확인한 뒤 원본이 아니라 복사본이나 입력칸에서 마스킹하세요." : "확정형 개인정보 패턴은 발견되지 않았습니다.",
  };
}

function inspectPrivacyFile(file) {
  const title = String(file?.name || (file?.path ? path.basename(file.path) : "첨부 파일"));
  const baseResult = {
    title,
    processName: "file",
    ok: false,
    status: "unreadable",
    textLength: 0,
    findings: [],
    summary: {},
  };
  const extension = path.extname(title || String(file?.path || "")).toLowerCase();

  if (!PRIVACY_TEXT_FILE_EXTENSIONS.has(extension)) {
    return {
      ...baseResult,
      errorCode: "UNSUPPORTED_PRIVACY_FILE_FORMAT",
      guidance:
        "이 형식은 텍스트로 안전하게 추출할 수 없어 검사하지 않았습니다. PDF·HWP/HWPX·Word·Excel·PPT 파일은 해당 프로그램에서 필요한 내용을 복사해 오른쪽 텍스트 검사 칸에 붙여넣어 주세요.",
    };
  }

  try {
    const resolvedPath = path.resolve(String(file?.path || ""));
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error("첨부 경로가 파일이 아닙니다.");
    if (stat.size > PRIVACY_TEXT_FILE_MAX_BYTES) {
      return {
        ...baseResult,
        errorCode: "PRIVACY_TEXT_FILE_TOO_LARGE",
        guidance: "텍스트 직접 검사는 10MB 이하 파일부터 지원합니다. 큰 파일은 필요한 부분만 붙여넣어 주세요.",
      };
    }

    const text = decodeTextBuffer(fs.readFileSync(resolvedPath));
    if (text.includes("\u0000")) {
      return {
        ...baseResult,
        errorCode: "PRIVACY_FILE_NOT_TEXT",
        guidance: "텍스트 확장자이지만 바이너리 내용이 포함되어 안전하게 읽지 못했습니다. 필요한 내용을 복사해 오른쪽 텍스트 검사 칸에 붙여넣어 주세요.",
      };
    }

    return buildTextScanResult(
      {
        title,
        processName: "file",
        appType: "text",
        methodLabel: "파일 직접 검사",
      },
      text,
      {
        sourceMethod: "file",
        samplePath: resolvedPath,
        guidance: "첨부한 텍스트 파일을 직접 읽어 검사했습니다. 원본 파일은 수정하지 않았습니다.",
      }
    );
  } catch (error) {
    return {
      ...baseResult,
      errorCode: "PRIVACY_FILE_READ_FAILED",
      error: error?.message || String(error),
      guidance: "이 파일은 현재 직접 읽지 못했습니다. 내용을 복사해 텍스트 검사 칸에 붙여넣어 주세요.",
    };
  }
}

function tryReadTextWindowFile(win, options = {}) {
  if (win.appType !== "text") return { ok: false };
  const candidates = textFilePathCandidates(win, options).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
      const buffer = fs.readFileSync(resolved);
      return { ok: true, path: resolved, text: decodeTextBuffer(buffer) };
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return { ok: false };
}

function textFilePathCandidates(win, options = {}) {
  const fromWindow = extractTextFilePathFromWindowTitle(win.title);
  const fromCommandLine = extractTextFilePathFromWindowTitle(win.commandLine);
  const names = extractTextFileNamesFromWindowTitle(win.title);
  const searchRoots = [
    options.workspaceDir,
    process.cwd(),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, "Desktop"),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, "Documents"),
  ].filter(Boolean);
  const candidates = [];
  if (fromWindow) candidates.push(fromWindow);
  if (fromCommandLine) candidates.push(fromCommandLine);
  for (const root of searchRoots) {
    for (const name of names) {
      candidates.push(path.join(root, name));
    }
  }
  return [...new Set(candidates)];
}

function extractTextFilePathFromWindowTitle(title) {
  const value = String(title || "");
  const match = value.match(/([A-Za-z]:\\[^:*?"<>|\r\n]+?\.(?:txt|md|csv|json|xml|log))/i);
  return match ? match[1].trim() : "";
}

function extractTextFileNamesFromWindowTitle(title) {
  const names = [];
  const value = String(title || "");
  for (const match of value.matchAll(/([^\\/:*?"<>|\r\n]+?\.(?:txt|md|csv|json|xml|log))/gi)) {
    names.push(match[1].trim());
  }
  return names.filter(Boolean);
}

function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || "");
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.slice(3).toString("utf8");
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.slice(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return swapUtf16Be(buffer.slice(2)).toString("utf16le");
  return buffer.toString("utf8");
}

function swapUtf16Be(buffer) {
  const next = Buffer.from(buffer);
  for (let index = 0; index + 1 < next.length; index += 2) {
    const first = next[index];
    next[index] = next[index + 1];
    next[index + 1] = first;
  }
  return next;
}

function backupClipboard(clipboardApi) {
  if (!clipboardApi) return {};
  const image = clipboardApi.readImage?.();
  return {
    text: clipboardApi.readText?.() || "",
    html: clipboardApi.readHTML?.() || "",
    rtf: clipboardApi.readRTF?.() || "",
    image: image && !image.isEmpty?.() ? image : null,
  };
}

function restoreClipboard(clipboardApi, backup) {
  if (!clipboardApi || !backup) return;
  try {
    const payload = {};
    if (backup.text) payload.text = backup.text;
    if (backup.html) payload.html = backup.html;
    if (backup.rtf) payload.rtf = backup.rtf;
    if (backup.image) payload.image = backup.image;
    clipboardApi.clear?.();
    if (Object.keys(payload).length) clipboardApi.write?.(payload);
  } catch (_error) {
    // Clipboard preservation is best-effort.
  }
}

function unreadableGuidance(win) {
  if (win.appType === "hwp") return "한글 창에서 바로 복사가 안 됐습니다. 실제 HWP/HWPX 파일을 첨부하거나 검사할 문단을 붙여넣어 주세요.";
  if (win.appType === "web") return "웹 페이지가 복사 방지되었거나 입력칸 내용이 복사되지 않았습니다. 해당 입력칸 내용을 직접 붙여넣어 주세요.";
  return "이 프로그램은 자동 텍스트 추출이 어렵습니다. 문서 파일을 첨부하거나 검사할 텍스트를 붙여넣어 주세요.";
}

function scanPrivacyText(sourceText) {
  const text = String(sourceText || "");
  const findings = [];
  addRegexFindings(findings, text, {
    type: "rrn",
    label: "주민등록/외국인등록번호",
    severity: "high",
    regex: /\b\d{6}[-\s]?[1-8]\d{6}\b/g,
    mask: maskResidentNumber,
  });
  addRegexFindings(findings, text, {
    type: "phone",
    label: "전화번호",
    severity: "medium",
    regex: /(?<!\d)(?:01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}|0(?:2|[3-6]\d)[-\s.]?\d{3,4}[-\s.]?\d{4})(?!\d)/g,
    mask: maskPhone,
  });
  addRegexFindings(findings, text, {
    type: "email",
    label: "이메일",
    severity: "medium",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    mask: maskEmail,
  });
  addRegexFindings(findings, text, {
    type: "card",
    label: "카드번호",
    severity: "high",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: isValidCardLikeNumber,
    mask: maskLongNumber,
  });
  addRegexFindings(findings, text, {
    type: "account",
    label: "계좌번호 후보",
    severity: "high",
    regex: /(?:계좌|입금|은행|농협|국민|신한|우리|하나|기업|새마을|수협|우체국|카카오뱅크|토스뱅크)[^\n\d]{0,12}(\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}(?:[-\s]?\d{1,6})?)/g,
    captureGroup: 1,
    mask: maskLongNumber,
  });
  addRegexFindings(findings, text, {
    type: "passport",
    label: "여권번호 후보",
    severity: "high",
    regex: /\b(?:[MSRGD]\d{8}|[A-Z]{2}\d{7})\b/g,
    mask: maskGeneric,
  });
  addRegexFindings(findings, text, {
    type: "driver",
    label: "운전면허번호 후보",
    severity: "high",
    regex: /\b\d{2}[-\s]?\d{2}[-\s]?\d{6}[-\s]?\d{2}\b/g,
    mask: maskLongNumber,
  });
  addRegexFindings(findings, text, {
    type: "address",
    label: "주소 후보",
    severity: "medium",
    regex: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충청북도|충남|충청남도|전북|전라북도|전남|전라남도|경북|경상북도|경남|경상남도|제주|제주특별자치도)[^\n]{0,40}(?:시|군|구)[^\n]{0,40}(?:동|읍|면|로|길)\s*\d{0,4}(?:-\d{1,4})?/g,
    mask: maskAddress,
  });
  addRegexFindings(findings, text, {
    type: "name",
    label: "이름/당사자명 후보",
    severity: "medium",
    regex: /(?:가상\s*인물|인물|성명|이름|신청인|민원인|담당자|수신자|작성자|피해자|가해자|환자)\s*[:：]?\s*([가-힣]{2,4}?)(?=\s|,|\.|님|씨|은|는|이|가|$)/g,
    captureGroup: 1,
    mask: maskKoreanName,
  });
  addRegexFindings(findings, text, {
    type: "birthdate",
    label: "생년월일 후보",
    severity: "medium",
    regex: /(?<!\d)(?:19|20)\d{2}년\s*\d{1,2}월\s*\d{1,2}일(?:생)?/g,
    mask: maskGeneric,
  });
  addRegexFindings(findings, text, {
    type: "employeeId",
    label: "사번 후보",
    severity: "medium",
    regex: /(?:사번|직원번호|직원\s*ID)(?:은|는)?\s*[:：]?\s*([A-Z]{1,4}\d{2,6}[-_]\d{2,8}|[A-Z0-9]{2,8}[-_][A-Z0-9-]{2,12})/gi,
    captureGroup: 1,
    mask: maskGeneric,
  });
  addRegexFindings(findings, text, {
    type: "ip",
    label: "IP 주소",
    severity: "low",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    mask: maskIp,
  });
  addRegexFindings(findings, text, {
    type: "vehicle",
    label: "차량번호 후보",
    severity: "medium",
    regex: /(?:^|[^\d가-힣])(\d{2,3}[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주바사아자허하호]\s?\d{4})(?!\d)/g,
    captureGroup: 1,
    mask: maskVehicle,
  });

  const unique = dedupeFindings(findings).slice(0, 300);
  const maskedText = maskText(text, unique);
  const safeFindings = unique.map((finding) => ({
    id: finding.id,
    type: finding.type,
    label: finding.label,
    severity: finding.severity,
    masked: finding.masked,
    index: finding.index,
    maskedContext: maskedContextAround(text, finding, unique),
  }));
  return {
    ok: true,
    textLength: text.length,
    findings: safeFindings,
    summary: summarizeFindings(safeFindings),
    maskedText,
  };
}

function addRegexFindings(findings, text, rule) {
  for (const match of text.matchAll(rule.regex)) {
    const raw = rule.captureGroup ? match[rule.captureGroup] : match[0];
    const value = String(raw || "").trim();
    if (!value) continue;
    if (rule.validate && !rule.validate(value)) continue;
    const index = rule.captureGroup ? match.index + String(match[0]).indexOf(value) : match.index;
    findings.push({
      id: `${rule.type}-${index}-${value.length}`,
      type: rule.type,
      label: rule.label,
      severity: rule.severity,
      text: value,
      masked: rule.mask ? rule.mask(value) : maskGeneric(value),
      index,
    });
  }
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.index}:${finding.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.index - b.index);
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.type] = (summary[finding.type] || 0) + 1;
    return summary;
  }, {});
}

function summarizeResults(results) {
  return results.reduce((summary, result) => {
    summary.windows = (summary.windows || 0) + 1;
    summary.findings = (summary.findings || 0) + (Array.isArray(result.findings) ? result.findings.length : 0);
    if (result.status === "unreadable") summary.unreadable = (summary.unreadable || 0) + 1;
    if (result.status === "risk") summary.risk = (summary.risk || 0) + 1;
    if (result.status === "clean") summary.clean = (summary.clean || 0) + 1;
    return summary;
  }, {});
}

function maskText(text, findings) {
  let cursor = 0;
  let output = "";
  for (const finding of findings) {
    if (finding.index < cursor) continue;
    output += text.slice(cursor, finding.index);
    output += finding.masked;
    cursor = finding.index + finding.text.length;
  }
  return output + text.slice(cursor);
}

function maskedContextAround(text, target, findings) {
  let start = Math.max(0, target.index - 28);
  let end = Math.min(text.length, target.index + target.text.length + 28);
  let changed = true;

  while (changed) {
    changed = false;
    for (const finding of findings) {
      const findingEnd = finding.index + finding.text.length;
      if (finding.index >= end || findingEnd <= start) continue;
      if (finding.index < start) {
        start = finding.index;
        changed = true;
      }
      if (findingEnd > end) {
        end = findingEnd;
        changed = true;
      }
    }
  }

  const localFindings = findings
    .filter((finding) => finding.index >= start && finding.index + finding.text.length <= end)
    .map((finding) => ({ ...finding, index: finding.index - start }));
  return maskText(text.slice(start, end), localFindings).replace(/\s+/g, " ").trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidKoreanResidentNumber(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 13) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

function isValidCardLikeNumber(value) {
  const digits = onlyDigits(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let num = Number(digits[i]);
    if (doubleIt) {
      num *= 2;
      if (num > 9) num -= 9;
    }
    sum += num;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

function maskResidentNumber(value) {
  const digits = onlyDigits(value);
  return `${digits.slice(0, 6)}-${digits[6] || "*"}******`;
}

function maskPhone(value) {
  const digits = onlyDigits(value);
  if (digits.length < 8) return maskGeneric(value);
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function maskEmail(value) {
  const [local, domain] = String(value).split("@");
  return `${local.slice(0, 2)}***@${domain || "***"}`;
}

function maskLongNumber(value) {
  const raw = String(value || "");
  const digits = onlyDigits(raw);
  if (digits.length <= 6) return "*".repeat(raw.length);
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 7))}${digits.slice(-4)}`;
}

function maskKoreanName(value) {
  const text = String(value || "");
  if (text.length <= 1) return "*";
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${"*".repeat(text.length - 2)}${text[text.length - 1]}`;
}

function maskAddress(value) {
  return String(value || "").replace(/([가-힣]{2,}(?:동|읍|면|로|길)\s*)\d[\d-]*/g, "$1***");
}

function maskIp(value) {
  return String(value || "").replace(/(\d+\.\d+)\.\d+\.\d+/, "$1.*.*");
}

function maskVehicle(value) {
  return String(value || "").replace(/\d{4}$/, "****");
}

function maskGeneric(value) {
  const text = String(value || "");
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}${"*".repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`;
}

module.exports = {
  inspectOpenWindows,
  inspectPrivacyFile,
  listOpenWindows,
  scanPrivacyText,
  buildTextScanResult,
};
