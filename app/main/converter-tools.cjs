const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

const IMAGE_INPUT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "bmp", "gif"]);
const IMAGE_OUTPUT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "tiff"]);
const DEFAULT_CONVERTER_FILE_MB = 200;
const DEFAULT_CONVERTER_PDF_TOTAL_MB = 300;
const DEFAULT_IMAGE_MEGAPIXELS = 80;

function conversionOutputDir(workspaceDir) {
  const outputDir = path.join(workspaceDir, "conversions");
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function normalizeExtension(value) {
  const ext = String(value || "").toLowerCase().replace(/^\./, "");
  if (ext === "jpeg") return "jpg";
  if (ext === "tif") return "tiff";
  return ext;
}

function sanitizeFileBase(value) {
  return String(value || "converted")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80) || "converted";
}

function uniquePath(outputDir, baseName, extension) {
  const safeBase = sanitizeFileBase(baseName);
  const safeExtension = normalizeExtension(extension) || "bin";
  let candidate = path.join(outputDir, `${safeBase}.${safeExtension}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${safeBase}_${index}.${safeExtension}`);
    index += 1;
  }
  return candidate;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function normalizeFiles(files) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      name: String(file?.name || path.basename(file?.path || "") || "").trim(),
      path: String(file?.path || "").trim(),
      type: String(file?.type || "").trim(),
    }))
    .filter((file) => file.path && fs.existsSync(file.path))
    .slice(0, 50);
}

function normalizeQuality(value) {
  const quality = Math.round(Number(value || 85));
  return Math.min(100, Math.max(1, quality));
}

function normalizeBackground(value, fallback = "#ffffff") {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "transparent") return null;
  if (text === "white") return "#ffffff";
  if (text === "black") return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  return fallback;
}

function normalizeMaxDimension(value, fallback = 1920) {
  const dimension = Math.round(Number(value || fallback));
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;
  return Math.min(12000, Math.max(256, dimension));
}

function normalizeCompressionLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  if (level === "light" || level === "strong") return level;
  return "balanced";
}

function compressionDefaults(level) {
  if (level === "light") return { quality: 85, maxDimension: 2560 };
  if (level === "strong") return { quality: 60, maxDimension: 1440 };
  return { quality: 75, maxDimension: 1920 };
}

function compressedImageExtension(sourceExt) {
  const ext = normalizeExtension(sourceExt);
  if (["jpg", "png", "webp", "avif", "tiff"].includes(ext)) return ext;
  return "png";
}

function outputFormatLabel(format) {
  const ext = normalizeExtension(format);
  if (ext === "jpg") return "JPG";
  if (ext === "png") return "PNG";
  if (ext === "webp") return "WebP";
  if (ext === "avif") return "AVIF";
  if (ext === "tiff") return "TIFF";
  return String(format || "").toUpperCase();
}

function formatReduction(beforeBytes, afterBytes) {
  const before = Number(beforeBytes || 0);
  const after = Number(afterBytes || 0);
  if (!before || !after) return "0%";
  const ratio = Math.round(((before - after) / before) * 1000) / 10;
  return `${ratio}%`;
}

function limitMbToBytes(value, fallbackMb) {
  const mb = Number(value);
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb;
  return Math.max(1, Math.min(8192, safeMb)) * 1024 * 1024;
}

function normalizeConverterLimits(limits = {}) {
  const imageMegapixels = Number(limits.converterImageMegapixels);
  return {
    fileBytes: limitMbToBytes(limits.converterFileMb, DEFAULT_CONVERTER_FILE_MB),
    pdfTotalBytes: limitMbToBytes(limits.converterPdfTotalMb, DEFAULT_CONVERTER_PDF_TOTAL_MB),
    imagePixels: Math.round(Math.max(1, Math.min(500, Number.isFinite(imageMegapixels) ? imageMegapixels : DEFAULT_IMAGE_MEGAPIXELS)) * 1000000),
  };
}

function assertReadableFileWithinLimit(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("일반 파일이 아닙니다.");
  if (stat.size > maxBytes) {
    throw new Error(`${path.basename(filePath)} 파일이 현재 용량 제한(${formatFileSize(maxBytes)})을 넘습니다. 설정에서 변환 용량 제한을 조정할 수 있습니다.`);
  }
  return stat;
}

async function convertImageFiles(payload = {}, workspaceDir) {
  const outputDir = conversionOutputDir(workspaceDir);
  const files = normalizeFiles(payload.files);
  const limits = normalizeConverterLimits(payload.limits);
  const outputFormat = normalizeExtension(payload.outputFormat || "png");
  const quality = normalizeQuality(payload.quality);
  const background = normalizeBackground(payload.background);

  if (!IMAGE_OUTPUT_EXTENSIONS.has(outputFormat)) {
    return { ok: false, error: "지원하지 않는 이미지 출력 형식입니다." };
  }

  const imageFiles = files.filter((file) => IMAGE_INPUT_EXTENSIONS.has(normalizeExtension(path.extname(file.path))));
  if (!imageFiles.length) {
    return { ok: false, error: "변환할 이미지 파일이 없습니다. JPG, PNG, WebP, AVIF, TIFF, BMP, GIF 파일을 넣어 주세요." };
  }

  const outputs = [];
  const errors = [];

  for (const file of imageFiles) {
    const sourceExt = normalizeExtension(path.extname(file.path));
    try {
      assertReadableFileWithinLimit(file.path, limits.fileBytes);
      let pipeline = sharp(file.path, { animated: false, limitInputPixels: limits.imagePixels }).rotate();
      const metadata = await pipeline.metadata();
      const pixels = Number(metadata.width || 0) * Number(metadata.height || 0);
      if (pixels > limits.imagePixels) {
        throw new Error(`${Math.round(pixels / 1000000)}MP 이미지는 현재 픽셀 제한(${Math.round(limits.imagePixels / 1000000)}MP)을 넘습니다. 설정에서 이미지 픽셀 제한을 조정할 수 있습니다.`);
      }
      const outputBase = `${path.basename(file.path, path.extname(file.path))}_${outputFormat}`;
      const outputPath = uniquePath(outputDir, outputBase, outputFormat);

      if (outputFormat === "jpg") {
        pipeline = pipeline.flatten({ background: background || "#ffffff" }).jpeg({ quality, mozjpeg: true });
      } else if (outputFormat === "png") {
        if (background) pipeline = pipeline.flatten({ background });
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      } else if (outputFormat === "webp") {
        if (background) pipeline = pipeline.flatten({ background });
        pipeline = pipeline.webp({ quality });
      } else if (outputFormat === "avif") {
        if (background) pipeline = pipeline.flatten({ background });
        pipeline = pipeline.avif({ quality, effort: 4 });
      } else if (outputFormat === "tiff") {
        if (background) pipeline = pipeline.flatten({ background });
        pipeline = pipeline.tiff({ quality, compression: "jpeg" });
      }

      await pipeline.toFile(outputPath);
      const stat = fs.statSync(outputPath);
      outputs.push({
        sourceName: file.name || path.basename(file.path),
        sourceExtension: sourceExt,
        fileName: path.basename(outputPath),
        path: outputPath,
        size: formatFileSize(stat.size),
        format: outputFormatLabel(outputFormat),
        width: metadata.width || 0,
        height: metadata.height || 0,
      });
    } catch (error) {
      errors.push({
        sourceName: file.name || path.basename(file.path),
        error: error?.message || String(error),
      });
    }
  }

  return {
    ok: outputs.length > 0,
    outputDir,
    outputFormat,
    quality,
    count: outputs.length,
    outputs,
    errors,
    error: outputs.length ? "" : errors[0]?.error || "이미지 변환에 실패했습니다.",
  };
}

async function compressImageFile(file, options, outputDir, limits) {
  const sourceExt = normalizeExtension(path.extname(file.path));
  const outputExt = compressedImageExtension(sourceExt);
  const sourceStat = assertReadableFileWithinLimit(file.path, limits.fileBytes);
  let pipeline = sharp(file.path, { animated: false, limitInputPixels: limits.imagePixels }).rotate();
  const metadata = await pipeline.metadata();
  const pixels = Number(metadata.width || 0) * Number(metadata.height || 0);
  if (pixels > limits.imagePixels) {
    throw new Error(`${Math.round(pixels / 1000000)}MP 이미지는 현재 픽셀 제한(${Math.round(limits.imagePixels / 1000000)}MP)을 넘습니다. 설정에서 이미지 픽셀 제한을 조정할 수 있습니다.`);
  }

  if (options.maxDimension > 0) {
    pipeline = pipeline.resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  if (outputExt === "jpg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: options.quality, mozjpeg: true });
  } else if (outputExt === "png") {
    pipeline = pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: options.level === "strong",
      quality: Math.max(1, Math.min(100, options.quality)),
    });
  } else if (outputExt === "webp") {
    pipeline = pipeline.webp({ quality: options.quality });
  } else if (outputExt === "avif") {
    pipeline = pipeline.avif({ quality: options.quality, effort: options.level === "strong" ? 6 : 4 });
  } else if (outputExt === "tiff") {
    pipeline = pipeline.tiff({ quality: options.quality, compression: "jpeg" });
  }

  const outputBase = `${path.basename(file.path, path.extname(file.path))}_compressed`;
  const outputPath = uniquePath(outputDir, outputBase, outputExt);
  await pipeline.toFile(outputPath);
  const outputStat = fs.statSync(outputPath);

  return {
    kind: "image",
    sourceName: file.name || path.basename(file.path),
    sourceExtension: sourceExt,
    fileName: path.basename(outputPath),
    path: outputPath,
    sourceSize: formatFileSize(sourceStat.size),
    size: formatFileSize(outputStat.size),
    beforeBytes: sourceStat.size,
    afterBytes: outputStat.size,
    reduction: formatReduction(sourceStat.size, outputStat.size),
    format: outputFormatLabel(outputExt),
    width: metadata.width || 0,
    height: metadata.height || 0,
    note: outputStat.size < sourceStat.size ? "" : "원본보다 작아지지 않았습니다.",
  };
}

async function compressPdfFile(file, options, outputDir, limits) {
  const sourceStat = assertReadableFileWithinLimit(file.path, limits.fileBytes);
  const bytes = fs.readFileSync(file.path);
  const source = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: false,
  });
  const outputBase = `${path.basename(file.path, path.extname(file.path))}_compressed`;
  const outputPath = uniquePath(outputDir, outputBase, "pdf");
  const optimizedBytes = await source.save({
    useObjectStreams: true,
    objectsPerTick: options.level === "strong" ? 200 : 100,
  });
  fs.writeFileSync(outputPath, optimizedBytes);
  const outputStat = fs.statSync(outputPath);

  return {
    kind: "pdf",
    sourceName: file.name || path.basename(file.path),
    fileName: path.basename(outputPath),
    path: outputPath,
    sourceSize: formatFileSize(sourceStat.size),
    size: formatFileSize(outputStat.size),
    beforeBytes: sourceStat.size,
    afterBytes: outputStat.size,
    reduction: formatReduction(sourceStat.size, outputStat.size),
    pageCount: source.getPageCount(),
    note: outputStat.size < sourceStat.size
      ? "PDF 안전 최적화로 저장했습니다."
      : "이미지 해상도는 건드리지 않는 안전 최적화라 감소폭이 작을 수 있습니다.",
  };
}

async function compressFiles(payload = {}, workspaceDir) {
  const outputDir = conversionOutputDir(workspaceDir);
  const files = normalizeFiles(payload.files);
  const limits = normalizeConverterLimits(payload.limits);
  const level = normalizeCompressionLevel(payload.level);
  const defaults = compressionDefaults(level);
  const quality = normalizeQuality(payload.quality || defaults.quality);
  const maxDimension = normalizeMaxDimension(payload.maxDimension, defaults.maxDimension);
  const target = String(payload.target || "auto").trim().toLowerCase();
  const includeImages = target === "auto" || target === "image" || target === "images";
  const includePdfs = target === "auto" || target === "pdf" || target === "pdfs";
  const targets = files.filter((file) => {
    const ext = normalizeExtension(path.extname(file.path));
    if (includeImages && IMAGE_INPUT_EXTENSIONS.has(ext)) return true;
    if (includePdfs && ext === "pdf") return true;
    return false;
  });

  if (!targets.length) {
    return { ok: false, error: "용량을 줄일 이미지나 PDF 파일이 슬롯에 없습니다." };
  }

  const outputs = [];
  const errors = [];
  const options = { level, quality, maxDimension };

  for (const file of targets) {
    const ext = normalizeExtension(path.extname(file.path));
    try {
      if (IMAGE_INPUT_EXTENSIONS.has(ext)) {
        outputs.push(await compressImageFile(file, options, outputDir, limits));
      } else if (ext === "pdf") {
        outputs.push(await compressPdfFile(file, options, outputDir, limits));
      }
    } catch (error) {
      errors.push({
        sourceName: file.name || path.basename(file.path),
        error: error?.message || String(error),
      });
    }
  }

  const beforeBytes = outputs.reduce((sum, item) => sum + Number(item.beforeBytes || 0), 0);
  const afterBytes = outputs.reduce((sum, item) => sum + Number(item.afterBytes || 0), 0);

  return {
    ok: outputs.length > 0,
    outputDir,
    count: outputs.length,
    level,
    quality,
    maxDimension,
    beforeSize: formatFileSize(beforeBytes),
    afterSize: formatFileSize(afterBytes),
    reduction: formatReduction(beforeBytes, afterBytes),
    outputs,
    errors,
    error: outputs.length ? "" : errors[0]?.error || "파일 용량 줄이기에 실패했습니다.",
  };
}

async function mergePdfFiles(payload = {}, workspaceDir) {
  const outputDir = conversionOutputDir(workspaceDir);
  const files = normalizeFiles(payload.files);
  const limits = normalizeConverterLimits(payload.limits);
  const pdfFiles = files.filter((file) => normalizeExtension(path.extname(file.path)) === "pdf");
  if (pdfFiles.length < 2) {
    return { ok: false, error: "PDF 병합은 PDF 파일이 2개 이상 필요합니다." };
  }

  const merged = await PDFDocument.create();
  const sources = [];
  let totalBytes = 0;

  for (const file of pdfFiles) {
    const stat = assertReadableFileWithinLimit(file.path, limits.fileBytes);
    totalBytes += stat.size;
    if (totalBytes > limits.pdfTotalBytes) {
      throw new Error(`PDF 병합 전체 용량이 현재 제한(${formatFileSize(limits.pdfTotalBytes)})을 넘습니다. 설정에서 PDF 병합 전체 용량을 조정할 수 있습니다.`);
    }
    const bytes = fs.readFileSync(file.path);
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
    sources.push({
      name: file.name || path.basename(file.path),
      pages: pages.length,
    });
  }

  const defaultName = sanitizeFileBase(payload.outputName || `merged_${new Date().toISOString().slice(0, 10)}`);
  const outputPath = uniquePath(outputDir, defaultName, "pdf");
  const mergedBytes = await merged.save({ useObjectStreams: false });
  fs.writeFileSync(outputPath, mergedBytes);
  const stat = fs.statSync(outputPath);

  return {
    ok: true,
    outputDir,
    fileName: path.basename(outputPath),
    path: outputPath,
    size: formatFileSize(stat.size),
    pageCount: merged.getPageCount(),
    sources,
  };
}

function normalizePdfFileFromPayload(payload = {}) {
  const files = normalizeFiles(payload.files || (payload.file ? [payload.file] : []));
  const pdfFiles = files.filter((file) => normalizeExtension(path.extname(file.path)) === "pdf");
  return pdfFiles[0] || null;
}

function pageRange(start, end) {
  const pages = [];
  const step = start <= end ? 1 : -1;
  for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
    pages.push(page);
  }
  return pages;
}

function parsePdfPageOrder(value, pageCount) {
  const maxPage = Math.max(0, Number(pageCount || 0));
  if (!maxPage) throw new Error("PDF에 정렬할 페이지가 없습니다.");

  if (Array.isArray(value)) {
    const pages = value.map((page) => Math.round(Number(page))).filter((page) => Number.isFinite(page));
    return validatePdfPageOrder(pages, maxPage);
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "all" || text === "전체" || text === "원본") {
    return pageRange(1, maxPage);
  }
  if (["reverse", "역순", "reverse-all"].includes(text)) {
    return pageRange(maxPage, 1);
  }
  if (["odd-even", "odd,even", "홀수-짝수", "홀수먼저"].includes(text)) {
    return [...pageRange(1, maxPage).filter((page) => page % 2 === 1), ...pageRange(1, maxPage).filter((page) => page % 2 === 0)];
  }
  if (["even-odd", "even,odd", "짝수-홀수", "짝수먼저"].includes(text)) {
    return [...pageRange(1, maxPage).filter((page) => page % 2 === 0), ...pageRange(1, maxPage).filter((page) => page % 2 === 1)];
  }

  const pages = [];
  const tokens = text.split(/[,\s]+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token === "odd" || token === "홀수") {
      pages.push(...pageRange(1, maxPage).filter((page) => page % 2 === 1));
      continue;
    }
    if (token === "even" || token === "짝수") {
      pages.push(...pageRange(1, maxPage).filter((page) => page % 2 === 0));
      continue;
    }
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      pages.push(...pageRange(Number(range[1]), Number(range[2])));
      continue;
    }
    if (/^\d+$/.test(token)) {
      pages.push(Number(token));
      continue;
    }
    throw new Error(`페이지 순서에 알 수 없는 값이 있습니다: ${token}`);
  }

  return validatePdfPageOrder(pages, maxPage);
}

function validatePdfPageOrder(pages, pageCount) {
  if (!pages.length) throw new Error("페이지 순서를 입력해 주세요.");
  const seen = new Set();
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`페이지 번호는 1부터 ${pageCount} 사이여야 합니다.`);
    }
    if (seen.has(page)) {
      throw new Error(`같은 페이지가 두 번 들어갔습니다: ${page}`);
    }
    seen.add(page);
  }
  return pages;
}

function parsePdfSplitGroups(value, pageCount) {
  const maxPage = Math.max(0, Number(pageCount || 0));
  if (!maxPage) throw new Error("PDF에 나눌 페이지가 없습니다.");
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "each" || text === "page" || text === "1page" || text === "한쪽씩") {
    return pageRange(1, maxPage).map((page) => [page]);
  }

  const groups = text
    .split(/[,\n;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => validatePdfPageOrder(parsePdfPageOrder(token, maxPage), maxPage));

  if (!groups.length) throw new Error("PDF 나누기 범위를 입력해 주세요.");
  return groups;
}

async function inspectPdfFile(payload = {}, _workspaceDir) {
  const file = normalizePdfFileFromPayload(payload);
  const limits = normalizeConverterLimits(payload.limits);
  if (!file) return { ok: false, error: "페이지 순서를 볼 PDF 파일을 먼저 슬롯에 넣어 주세요." };

  try {
    assertReadableFileWithinLimit(file.path, limits.fileBytes);
    const bytes = fs.readFileSync(file.path);
    const source = await PDFDocument.load(bytes);
    return {
      ok: true,
      fileName: file.name || path.basename(file.path),
      path: file.path,
      size: formatFileSize(bytes.length),
      pageCount: source.getPageCount(),
      defaultOrder: source.getPageCount() ? `1-${source.getPageCount()}` : "",
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function previewPdfFile(payload = {}, _workspaceDir) {
  const file = normalizePdfFileFromPayload(payload);
  const limits = normalizeConverterLimits(payload.limits);
  if (!file) return { ok: false, error: "미리볼 PDF 파일을 먼저 슬롯에 넣어 주세요." };

  try {
    assertReadableFileWithinLimit(file.path, limits.fileBytes);
    const bytes = fs.readFileSync(file.path);
    const source = await PDFDocument.load(bytes);
    return {
      ok: true,
      fileName: file.name || path.basename(file.path),
      size: formatFileSize(bytes.length),
      pageCount: source.getPageCount(),
      mimeType: "application/pdf",
      base64: Buffer.from(bytes).toString("base64"),
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function reorderPdfPages(payload = {}, workspaceDir) {
  const outputDir = conversionOutputDir(workspaceDir);
  const file = normalizePdfFileFromPayload(payload);
  const limits = normalizeConverterLimits(payload.limits);
  if (!file) return { ok: false, error: "순서를 바꿀 PDF 파일을 먼저 슬롯에 넣어 주세요." };

  try {
    assertReadableFileWithinLimit(file.path, limits.fileBytes);
    const bytes = fs.readFileSync(file.path);
    const source = await PDFDocument.load(bytes);
    const originalPageCount = source.getPageCount();
    const order = parsePdfPageOrder(payload.pageOrder || payload.order, originalPageCount);

    const reordered = await PDFDocument.create();
    const copiedPages = await reordered.copyPages(source, order.map((page) => page - 1));
    copiedPages.forEach((page) => reordered.addPage(page));

    const sourceBase = path.basename(file.path, path.extname(file.path));
    const defaultName = sanitizeFileBase(payload.outputName || `${sourceBase}_reordered`);
    const outputPath = uniquePath(outputDir, defaultName, "pdf");
    const reorderedBytes = await reordered.save({ useObjectStreams: false });
    fs.writeFileSync(outputPath, reorderedBytes);
    const stat = fs.statSync(outputPath);

    return {
      ok: true,
      outputDir,
      fileName: path.basename(outputPath),
      path: outputPath,
      size: formatFileSize(stat.size),
      sourceName: file.name || path.basename(file.path),
      originalPageCount,
      pageCount: reordered.getPageCount(),
      omittedPageCount: Math.max(0, originalPageCount - order.length),
      order,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function splitPdfFile(payload = {}, workspaceDir) {
  const outputDir = conversionOutputDir(workspaceDir);
  const file = normalizePdfFileFromPayload(payload);
  const limits = normalizeConverterLimits(payload.limits);
  if (!file) return { ok: false, error: "나눌 PDF 파일을 먼저 슬롯에 넣어 주세요." };

  try {
    assertReadableFileWithinLimit(file.path, limits.fileBytes);
    const bytes = fs.readFileSync(file.path);
    const source = await PDFDocument.load(bytes);
    const pageCount = source.getPageCount();
    const groups = parsePdfSplitGroups(payload.ranges || payload.pageRanges || payload.pages, pageCount).slice(0, 500);
    const sourceBase = path.basename(file.path, path.extname(file.path));
    const baseName = sanitizeFileBase(payload.outputName || `${sourceBase}_split`);
    const outputs = [];

    for (let index = 0; index < groups.length; index += 1) {
      const pages = groups[index];
      const part = await PDFDocument.create();
      const copied = await part.copyPages(source, pages.map((page) => page - 1));
      copied.forEach((page) => part.addPage(page));
      const suffix = String(index + 1).padStart(2, "0");
      const outputPath = uniquePath(outputDir, `${baseName}_part_${suffix}`, "pdf");
      const partBytes = await part.save({ useObjectStreams: false });
      fs.writeFileSync(outputPath, partBytes);
      const stat = fs.statSync(outputPath);
      outputs.push({
        fileName: path.basename(outputPath),
        path: outputPath,
        size: formatFileSize(stat.size),
        pages: pages.length,
        pageRange: pages.join(","),
      });
    }

    return {
      ok: true,
      outputDir,
      sourceName: file.name || path.basename(file.path),
      pageCount,
      count: outputs.length,
      outputs,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  convertImageFiles,
  compressFiles,
  mergePdfFiles,
  splitPdfFile,
  inspectPdfFile,
  previewPdfFile,
  reorderPdfPages,
  conversionOutputDir,
};
