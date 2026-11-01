// Генерирует иконки приложения из apps/desktop/src-tauri/icons/icon.svg.
// Запуск: node scripts/generate-icons.mjs (нужен пакет sharp).
// Результат уже лежит в репозитории; скрипт нужен только при смене иконки.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop", "src-tauri", "icons");
const svg = await readFile(join(dir, "icon.svg"));

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

const files = { "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512 };
for (const [name, size] of Object.entries(files)) {
  await writeFile(join(dir, name), await png(size));
}

// ICO с вложенными PNG (поддерживается Windows Vista и новее).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(icoSizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + 16 * images.length;
images.forEach((img, i) => {
  const size = icoSizes[i];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(img.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += img.length;
  entries.push(entry);
});
await writeFile(join(dir, "icon.ico"), Buffer.concat([header, ...entries, ...images]));
console.log("Иконки обновлены в", dir);
