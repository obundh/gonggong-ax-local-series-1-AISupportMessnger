const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const MAX_CHART_POINTS = 18;
const CHART_WIDTH = 620;
const CHART_HEIGHT = 360;
const COLORS = ["#356dff", "#f1b400", "#1f9d6a", "#d9534f", "#7b61ff"];
const DEFAULT_GRAPH_FILE_MB = 30;
const MAX_GRAPH_ROWS = 5000;
const MAX_GRAPH_COLUMNS = 120;

async function buildGraphOfficerReply(payload) {
  const files = normalizeInputFiles(payload?.files || payload?.attachedFiles || []);
  const file = files.find(isSupportedDataFile);
  const legacyFile = files.find(isLegacyExcelFile);
  if (!file) {
    return {
      ok: !legacyFile,
      model: "local-graph",
      text: legacyFile
        ? [
            "구식 .xls 파일은 안전 문제 때문에 자동 그래프 생성 대상에서 뺐습니다.",
            "",
            `- 파일: ${legacyFile.name}`,
            "- 처리 방법: 엑셀에서 .xlsx 또는 .csv로 다시 저장한 뒤 첨부해 주세요.",
          ].join("\n")
        : [
            "1차 답변",
            "좋습니다. 그래프로 만들 엑셀 또는 CSV 파일을 먼저 첨부해 주세요. 그래프 도구는 .xlsx, .csv 파일을 읽어서 숫자 열을 자동 감지하고 막대그래프나 선그래프 SVG를 생성합니다.",
            "",
            "확인 필요 사항",
            "파일을 첨부한 뒤 '월별 매출을 선그래프로', '부서별 건수를 막대그래프로'처럼 원하는 x축과 y축을 같이 적어주시면 더 정확하게 잡겠습니다.",
          ].join("\n"),
    };
  }

  try {
    const analysis = await analyzeWorkbookFile(file, payload?.userText || "", payload?.graphOptions || {}, payload?.limits || {});
    const chart = buildChartSvg(analysis);
    return {
      ok: true,
      model: "local-graph",
      text: buildGraphReplyText(analysis),
      chart,
    };
  } catch (error) {
    return {
      ok: false,
      model: "local-graph",
      text: [
        "엑셀 그래프 생성 중 오류가 발생했습니다.",
        "",
        `- 파일: ${file.name}`,
        `- 오류: ${error?.message || "알 수 없는 오류"}`,
        "",
        "확인 필요 사항",
        "암호가 걸린 엑셀 파일, 너무 복잡한 병합 셀 중심 파일, 이미지로만 된 표는 현재 자동 그래프 생성이 어렵습니다. 첫 행에 열 제목이 있고 아래에 데이터가 있는 표 형태로 다시 첨부해 주세요.",
      ].join("\n"),
    };
  }
}

function normalizeInputFiles(files) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      name: String(file?.name || "").trim(),
      path: String(file?.path || "").trim(),
      size: String(file?.size || "").trim(),
      type: String(file?.type || inferFileType(file?.name || file?.path || "file")).trim(),
    }))
    .filter((file) => file.name && file.path);
}

function isSupportedDataFile(file) {
  const ext = path.extname(file.path || file.name).toLowerCase().replace(".", "");
  return ["xlsx", "csv"].includes(ext);
}

function isLegacyExcelFile(file) {
  const ext = path.extname(file.path || file.name).toLowerCase().replace(".", "");
  return ext === "xls";
}

async function analyzeWorkbookFile(file, userText, graphOptions = {}, limits = {}) {
  const resolved = assertSafeReadableFile(file.path, limits);
  const ext = path.extname(resolved).toLowerCase();
  const { rows, sheetName } = ext === ".csv"
    ? readCsvTable(resolved)
    : await readXlsxTable(resolved, userText);

  const table = normalizeTableRows(rows);
  if (table.rows.length < 2) throw new Error("그래프로 만들 데이터 행이 부족합니다.");

  const columns = inferColumns(table);
  const graphPlan = chooseGraphPlan(columns, userText, graphOptions);
  if (!graphPlan.valueColumns.length) throw new Error("숫자 데이터 열을 찾지 못했습니다.");

  const series = graphPlan.valueColumns.slice(0, graphPlan.chartType === "line" ? 3 : 2).map((column, index) => ({
    name: column.name,
    color: COLORS[index % COLORS.length],
    values: table.rows.map((row) => toNumber(row[column.index])),
  }));

  const labels = table.rows.map((row, index) => formatCellLabel(row[graphPlan.labelColumn.index], index));
  const compacted = compactSeries(labels, series, graphPlan.chartType);
  const title = buildChartTitle(file.name, sheetName, graphPlan, userText);

  return {
    file,
    sheetName,
    title,
    chartType: graphPlan.chartType,
    labelColumn: graphPlan.labelColumn,
    valueColumns: graphPlan.valueColumns,
    labels: compacted.labels,
    series: compacted.series,
    originalRowCount: table.rows.length,
    shownRowCount: compacted.labels.length,
  };
}

function assertSafeReadableFile(filePath, limits = {}) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("일반 파일이 아닙니다.");
  const maxBytes = limitMbToBytes(limits.graphFileMb, DEFAULT_GRAPH_FILE_MB);
  if (stat.size > maxBytes) throw new Error(`${formatLimitMb(maxBytes)}를 넘는 파일은 현재 그래프 자동 생성 대상에서 제외했습니다. 설정에서 그래프 파일 제한을 조정할 수 있습니다.`);
  return resolved;
}

function limitMbToBytes(value, fallbackMb) {
  const mb = Number(value);
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb;
  return Math.max(1, Math.min(4096, safeMb)) * 1024 * 1024;
}

function formatLimitMb(bytes) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

async function readXlsxTable(filePath, userText) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = pickWorksheet(workbook, userText);
  if (!worksheet) throw new Error("읽을 수 있는 시트를 찾지 못했습니다.");

  const rows = [];
  const columnLimit = Math.min(worksheet.columnCount || MAX_GRAPH_COLUMNS, MAX_GRAPH_COLUMNS);
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= MAX_GRAPH_ROWS) return;
    const values = [];
    for (let col = 1; col <= columnLimit; col += 1) {
      values.push(normalizeExcelCell(row.getCell(col).value));
    }
    if (values.some((cell) => String(cell).trim() !== "")) rows.push(values);
  });
  return {
    rows,
    sheetName: worksheet.name,
  };
}

function readCsvTable(filePath) {
  const body = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return {
    rows: parseCsvRows(body).slice(0, MAX_GRAPH_ROWS).map((row) => row.slice(0, MAX_GRAPH_COLUMNS)),
    sheetName: "CSV",
  };
}

function parseCsvRows(body) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function pickWorksheet(workbook, userText) {
  const wanted = String(userText || "").toLowerCase();
  const worksheets = workbook.worksheets || [];
  if (!worksheets.length) return null;
  const mentioned = worksheets.find((sheet) => wanted.includes(String(sheet.name).toLowerCase()));
  return mentioned || worksheets[0];
}

function normalizeExcelCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    if (value.result != null) return normalizeExcelCell(value.result);
    if (value.text != null) return normalizeExcelCell(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part?.text || "").join("").trim();
    if (value.hyperlink && value.text) return normalizeExcelCell(value.text);
    return "";
  }
  return String(value ?? "").trim();
}

function normalizeTableRows(rows) {
  const cleaned = rows
    .map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []))
    .filter((row) => row.some((cell) => String(cell).trim() !== ""));

  const headerIndex = findHeaderRowIndex(cleaned);
  const headers = (cleaned[headerIndex] || []).map((cell, index) => String(cell || `열${index + 1}`).trim() || `열${index + 1}`);
  const rowsAfterHeader = cleaned
    .slice(headerIndex + 1)
    .map((row) => headers.map((_header, index) => row[index] ?? ""))
    .filter((row) => row.some((cell) => String(cell).trim() !== ""));

  return {
    headers,
    rows: rowsAfterHeader,
  };
}

function normalizeCell(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  return String(value ?? "").trim();
}

function findHeaderRowIndex(rows) {
  const limit = Math.min(rows.length, 8);
  let best = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || [];
    const nextRows = rows.slice(index + 1, Math.min(rows.length, index + 8));
    const nonEmpty = row.filter((cell) => String(cell).trim() !== "").length;
    const nextNumeric = countNumericCells(nextRows.flat());
    const rowNumeric = countNumericCells(row);
    const score = nonEmpty * 3 + nextNumeric * 2 - rowNumeric * 2;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

function inferColumns(table) {
  return table.headers.map((name, index) => {
    const values = table.rows.map((row) => row[index]);
    const numericCount = values.filter((value) => toNumber(value) !== null).length;
    const textCount = values.filter((value) => String(value ?? "").trim() !== "" && toNumber(value) === null).length;
    return {
      index,
      name: String(name || `열${index + 1}`).trim(),
      numericCount,
      textCount,
      isNumeric: numericCount >= Math.max(2, Math.ceil(values.length * 0.45)),
    };
  });
}

function chooseGraphPlan(columns, userText, graphOptions = {}) {
  const text = String(userText || "").toLowerCase();
  const xAxis = String(graphOptions.xAxis || "").trim();
  const yAxisTerms = splitAxisTerms(graphOptions.yAxis || "");
  const explicitChartType = String(graphOptions.chartType || "").toLowerCase();
  const numericColumns = columns.filter((column) => column.isNumeric);
  const labelColumn =
    findColumnByAxisName(columns, xAxis) ||
    columns.find((column) => !column.isNumeric && matchesColumnName(column.name, text)) ||
    columns.find((column) => !column.isNumeric && column.textCount >= 2) ||
    columns[0];
  const requestedNumeric = yAxisTerms.length
    ? yAxisTerms.map((term) => findColumnByAxisName(numericColumns, term)).filter(Boolean)
    : [];
  const mentionedNumeric = numericColumns.filter((column) => matchesColumnName(column.name, text));
  const valueColumns = mentionedNumeric.length ? mentionedNumeric : numericColumns.filter((column) => column.index !== labelColumn.index);
  const chartType =
    explicitChartType === "line" || explicitChartType === "bar"
      ? explicitChartType
      : /선|라인|line|추세|월별|일별|연도|시계열|시간/.test(text)
        ? "line"
        : "bar";
  return {
    chartType,
    labelColumn,
    valueColumns: requestedNumeric.length ? uniqueColumns(requestedNumeric) : valueColumns,
  };
}

function splitAxisTerms(value) {
  return String(value || "")
    .split(/[,，、/]+|\s+및\s+|\s+와\s+|\s+과\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findColumnByAxisName(columns, term) {
  const normalized = normalizeColumnName(term);
  if (!normalized) return null;
  return (
    columns.find((column) => normalizeColumnName(column.name) === normalized) ||
    columns.find((column) => normalizeColumnName(column.name).includes(normalized) || normalized.includes(normalizeColumnName(column.name)))
  );
}

function normalizeColumnName(value) {
  return String(value || "").toLowerCase().replace(/[\s_\-(){}\[\].,]/g, "");
}

function uniqueColumns(columns) {
  const seen = new Set();
  return columns.filter((column) => {
    if (seen.has(column.index)) return false;
    seen.add(column.index);
    return true;
  });
}

function matchesColumnName(name, lowerText) {
  const normalized = String(name || "").toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;
  return lowerText.replace(/\s+/g, "").includes(normalized);
}

function compactSeries(labels, series, chartType) {
  if (labels.length <= MAX_CHART_POINTS) return { labels, series };

  if (chartType === "line") {
    const step = Math.ceil(labels.length / MAX_CHART_POINTS);
    const indexes = labels.map((_label, index) => index).filter((index) => index % step === 0).slice(0, MAX_CHART_POINTS);
    return {
      labels: indexes.map((index) => labels[index]),
      series: series.map((item) => ({ ...item, values: indexes.map((index) => item.values[index]) })),
    };
  }

  const first = labels.slice(0, MAX_CHART_POINTS);
  return {
    labels: first,
    series: series.map((item) => ({ ...item, values: item.values.slice(0, MAX_CHART_POINTS) })),
  };
}

function buildChartTitle(fileName, sheetName, graphPlan, userText) {
  const explicit = String(userText || "").match(/['"“”‘’]([^'"“”‘’]{2,40})['"“”‘’]/)?.[1];
  if (explicit) return explicit;
  const columns = graphPlan.valueColumns.map((column) => column.name).slice(0, 2).join(", ");
  return `${path.basename(fileName)} · ${sheetName} · ${columns || "숫자 데이터"}`;
}

function buildChartSvg(analysis) {
  const svg = analysis.chartType === "line" ? buildLineSvg(analysis) : buildBarSvg(analysis);
  return {
    type: analysis.chartType,
    title: analysis.title,
    svg,
    fileName: analysis.file.name,
    sheetName: analysis.sheetName,
    rowCount: analysis.originalRowCount,
    shownRowCount: analysis.shownRowCount,
  };
}

function buildBarSvg(analysis) {
  const margin = { top: 52, right: 24, bottom: 82, left: 58 };
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...analysis.series.flatMap((item) => item.values).filter((value) => value !== null));
  const groupWidth = plotWidth / Math.max(1, analysis.labels.length);
  const barWidth = Math.max(6, Math.min(28, (groupWidth - 8) / Math.max(1, analysis.series.length)));
  const y = (value) => margin.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight;

  const bars = analysis.labels
    .map((_label, labelIndex) =>
      analysis.series
        .map((serie, serieIndex) => {
          const value = serie.values[labelIndex];
          if (value === null) return "";
          const x = margin.left + labelIndex * groupWidth + 4 + serieIndex * barWidth;
          const top = y(value);
          return `<rect x="${round(x)}" y="${round(top)}" width="${round(barWidth - 1)}" height="${round(margin.top + plotHeight - top)}" rx="3" fill="${serie.color}"><title>${escapeXml(analysis.labels[labelIndex])}: ${formatNumber(value)}</title></rect>`;
        })
        .join("")
    )
    .join("");

  return wrapChartSvg(
    analysis,
    [
      axisMarkup(margin, plotWidth, plotHeight, maxValue),
      bars,
      xLabelMarkup(analysis.labels, margin, groupWidth),
      legendMarkup(analysis.series, width),
    ].join("")
  );
}

function buildLineSvg(analysis) {
  const margin = { top: 52, right: 24, bottom: 82, left: 58 };
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...analysis.series.flatMap((item) => item.values).filter((value) => value !== null));
  const x = (index) => margin.left + (analysis.labels.length <= 1 ? plotWidth / 2 : (index / (analysis.labels.length - 1)) * plotWidth);
  const y = (value) => margin.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight;

  const lines = analysis.series
    .map((serie) => {
      const points = serie.values
        .map((value, index) => (value === null ? "" : `${round(x(index))},${round(y(value))}`))
        .filter(Boolean)
        .join(" ");
      const dots = serie.values
        .map((value, index) =>
          value === null
            ? ""
            : `<circle cx="${round(x(index))}" cy="${round(y(value))}" r="3.5" fill="${serie.color}"><title>${escapeXml(analysis.labels[index])}: ${formatNumber(value)}</title></circle>`
        )
        .join("");
      return `<polyline points="${points}" fill="none" stroke="${serie.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
    })
    .join("");

  const groupWidth = plotWidth / Math.max(1, analysis.labels.length);
  return wrapChartSvg(
    analysis,
    [
      axisMarkup(margin, plotWidth, plotHeight, maxValue),
      lines,
      xLabelMarkup(analysis.labels, margin, groupWidth, true),
      legendMarkup(analysis.series, width),
    ].join("")
  );
}

function wrapChartSvg(analysis, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeXml(analysis.title)}">`,
    `<rect width="100%" height="100%" rx="8" fill="#ffffff" />`,
    `<text x="22" y="30" fill="#1f252d" font-size="17" font-weight="700">${escapeXml(compactLabel(analysis.title, 52))}</text>`,
    body,
    `</svg>`,
  ].join("");
}

function axisMarkup(margin, plotWidth, plotHeight, maxValue) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return ticks
    .map((tick) => {
      const value = maxValue * tick;
      const y = margin.top + plotHeight - tick * plotHeight;
      return [
        `<line x1="${margin.left}" x2="${margin.left + plotWidth}" y1="${round(y)}" y2="${round(y)}" stroke="#edf0f3" />`,
        `<text x="${margin.left - 10}" y="${round(y + 4)}" text-anchor="end" fill="#8a93a0" font-size="11">${escapeXml(formatCompactNumber(value))}</text>`,
      ].join("");
    })
    .join("") +
    `<line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + plotHeight}" stroke="#cfd5dd" />` +
    `<line x1="${margin.left}" x2="${margin.left + plotWidth}" y1="${margin.top + plotHeight}" y2="${margin.top + plotHeight}" stroke="#cfd5dd" />`;
}

function xLabelMarkup(labels, margin, groupWidth, lineMode = false) {
  const plotHeight = CHART_HEIGHT - margin.top - margin.bottom;
  return labels
    .map((label, index) => {
      const x = lineMode
        ? margin.left + (labels.length <= 1 ? (CHART_WIDTH - margin.left - margin.right) / 2 : (index / (labels.length - 1)) * (CHART_WIDTH - margin.left - margin.right))
        : margin.left + index * groupWidth + groupWidth / 2;
      return `<text x="${round(x)}" y="${margin.top + plotHeight + 26}" transform="rotate(-32 ${round(x)} ${margin.top + plotHeight + 26})" text-anchor="end" fill="#596170" font-size="11">${escapeXml(compactLabel(label, 14))}</text>`;
    })
    .join("");
}

function legendMarkup(series, width) {
  return series
    .map((item, index) => {
      const x = width - 170;
      const y = 24 + index * 18;
      return `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${item.color}" /><text x="${x + 16}" y="${y}" fill="#596170" font-size="12">${escapeXml(compactLabel(item.name, 18))}</text>`;
    })
    .join("");
}

function buildGraphReplyText(analysis) {
  const values = analysis.series.flatMap((item) => item.values.filter((value) => value !== null));
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const shown = analysis.originalRowCount === analysis.shownRowCount ? `${analysis.shownRowCount}개 행` : `${analysis.originalRowCount}개 행 중 ${analysis.shownRowCount}개 표시`;
  return [
    "1차 답변",
    `좋습니다. ${analysis.file.name}의 '${analysis.sheetName}' 시트를 읽어서 ${analysis.chartType === "line" ? "선그래프" : "막대그래프"}로 만들었습니다. x축은 '${analysis.labelColumn.name}', y축은 ${analysis.valueColumns.map((column) => `'${column.name}'`).join(", ")} 기준입니다.`,
    "",
    "데이터 요약",
    `총 ${shown}을 그래프에 반영했습니다. 표시된 숫자 범위는 최소 ${formatNumber(min)}, 최대 ${formatNumber(max)}입니다.`,
    "",
    "확인 필요 사항",
    "원하는 축이 다르면 'x축은 월, y축은 매출로 다시'처럼 말해 주세요. 여러 시트가 있는 파일은 시트 이름을 같이 적으면 해당 시트 기준으로 다시 만들 수 있습니다.",
  ].join("\n");
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const compact = text.replace(/,/g, "").replace(/\s+/g, "");
  const negative = /^\(.+\)$/.test(compact);
  const body = negative ? compact.slice(1, -1) : compact;
  const match = body.match(/^([-+])?(?:₩|\$|usd|krw)?(\d+(?:\.\d+)?)(%|원|만원|억원|달러|건|명|개|회|점)?$/i);
  if (!match) return null;
  const sign = match[1] === "-" || negative ? -1 : 1;
  const unit = match[3] || "";
  let number = Number(match[2]);
  if (!Number.isFinite(number)) return null;
  if (unit === "만원") number *= 10000;
  if (unit === "억원") number *= 100000000;
  if (unit === "%") number /= 100;
  return sign * number;
}

function countNumericCells(values) {
  return values.filter((value) => toNumber(value) !== null).length;
}

function formatCellLabel(value, index) {
  const label = String(value ?? "").trim();
  return label || `행 ${index + 1}`;
}

function compactLabel(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? number.toLocaleString("ko-KR") : number.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100000000) return `${formatNumber(number / 100000000)}억`;
  if (Math.abs(number) >= 10000) return `${formatNumber(number / 10000)}만`;
  return formatNumber(number);
}

function inferFileType(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase().replace(".", "");
  if (["xlsx", "csv"].includes(ext)) return "excel";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "hwp", "hwpx"].includes(ext)) return "word";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  return "file";
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = {
  buildGraphOfficerReply,
};
