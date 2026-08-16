const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, "assets", "avatars");
const OUTPUT_DIR = path.join(ROOT, "assets", "avatar-thumbs");
const FILE_NAMES = [
  "lawai.png",
  "hangjeongai.png",
  "langai.png",
  "byeonghwanai.png",
  "languageai.png",
  "geurimai.png",
  "sokgiai.png",
  "jawonai.png",
  "gaeboai.png",
  "routineai.png",
  "noriai.png",
];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function build() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const items = [];

  for (const sourceFile of FILE_NAMES) {
    const sourcePath = path.join(SOURCE_DIR, sourceFile);
    const thumbnailFile = sourceFile.replace(/\.png$/i, ".webp");
    const thumbnailPath = path.join(OUTPUT_DIR, thumbnailFile);

    if (!fs.existsSync(sourcePath)) throw new Error("Missing reviewed source avatar: " + sourceFile);

    await sharp(sourcePath, { failOn: "error", limitInputPixels: 25_000_000 })
      .rotate()
      .resize({ width: 160, height: 160, fit: "cover", position: "centre", withoutEnlargement: true })
      .webp({ quality: 78, effort: 6, smartSubsample: true })
      .toFile(thumbnailPath);

    const metadata = await sharp(thumbnailPath).metadata();
    if (metadata.width !== 160 || metadata.height !== 160 || metadata.format !== "webp") {
      throw new Error("Unexpected thumbnail output: " + thumbnailFile);
    }

    const sourceStat = fs.statSync(sourcePath);
    const thumbnailStat = fs.statSync(thumbnailPath);
    items.push({
      sourceFile,
      sourceBytes: sourceStat.size,
      sourceSha256: sha256(sourcePath),
      thumbnailFile,
      thumbnailBytes: thumbnailStat.size,
      thumbnailSha256: sha256(thumbnailPath),
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    });
  }

  const manifest = {
    schemaVersion: 1,
    derivation: {
      sourceDirectory: "../avatars",
      width: 160,
      height: 160,
      format: "webp",
      fit: "cover",
      position: "centre",
      quality: 78,
      effort: 6,
      metadataPolicy: "Public thumbnails omit source metadata; reviewed originals remain beside them.",
    },
    items,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const totalBytes = items.reduce((sum, item) => sum + item.thumbnailBytes, 0);
  process.stdout.write("Built " + items.length + " avatar thumbnails (" + totalBytes + " bytes).\n");
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
