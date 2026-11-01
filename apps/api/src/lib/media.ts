import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import sharp from "sharp";
import { AppError } from "./errors.js";

/**
 * Хранение загруженных файлов на диске сервера.
 *
 * Каждая картинка заново перекодируется в WebP: из файла пропадают
 * метаданные (EXIF, координаты) и всё, что могло быть спрятано под видом
 * изображения. Исходный файл не сохраняется.
 */

export const MEDIA_PREFIX = "/media";

/** Путь в API для файла в хранилище. */
export function mediaUrl(relativePath: string): string {
  return `${MEDIA_PREFIX}/${relativePath.split(sep).join("/")}`;
}

function resolveInside(root: string, relative: string): string {
  const full = normalize(join(root, relative));
  if (!full.startsWith(normalize(root) + sep)) throw new Error("Путь вне хранилища");
  return full;
}

async function save(root: string, relative: string, data: Buffer): Promise<void> {
  const full = resolveInside(root, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function removeMedia(root: string, relatives: Array<string | null | undefined>): Promise<void> {
  await Promise.all(
    relatives.filter((r): r is string => Boolean(r)).map((r) => rm(resolveInside(root, r), { force: true })),
  );
}

export async function removeMediaDir(root: string, relativeDir: string): Promise<void> {
  await rm(resolveInside(root, relativeDir), { recursive: true, force: true });
}

const badImage = () =>
  new AppError(400, "invalid_image", "Файл не похож на изображение. Подходят PNG, JPG и WebP.");

async function readImage(buffer: Buffer) {
  const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" });
  let meta: sharp.Metadata;
  try {
    meta = await image.metadata();
  } catch {
    throw badImage();
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format) || !meta.width || !meta.height) {
    throw badImage();
  }
  if (meta.width < 200 || meta.height < 150) {
    throw new AppError(400, "image_too_small", "Изображение слишком маленькое: нужно хотя бы 200×150 точек.");
  }
  // Учитываем поворот из EXIF, после чего метаданные отбрасываются.
  return image.rotate();
}

export interface SavedListingImage {
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
  bytes: number;
}

/** Фото объявления: полный размер (до 1920 точек по ширине) и превью для карточек 480×300. */
export async function saveListingImage(root: string, listingId: string, buffer: Buffer): Promise<SavedListingImage> {
  const image = await readImage(buffer);
  const full = await image
    .clone()
    .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await image
    .clone()
    .resize({ width: 480, height: 300, fit: "cover", position: "attention" })
    .webp({ quality: 76 })
    .toBuffer();

  const name = randomUUID();
  const fullPath = join("listings", listingId, `${name}.webp`);
  const thumbPath = join("listings", listingId, `${name}-thumb.webp`);
  await save(root, fullPath, full.data);
  await save(root, thumbPath, thumb);
  return { fullPath, thumbPath, width: full.info.width, height: full.info.height, bytes: full.data.length };
}

/** Видео WebM начинается с заголовка EBML и указывает тип документа «webm». */
function isWebm(buffer: Buffer): boolean {
  return (
    buffer.length > 64 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3 &&
    buffer.subarray(0, 64).includes(Buffer.from("webm"))
  );
}

export const ICON_VIDEO_MAX_BYTES = 4 * 1024 * 1024;

/** Иконка предмета: картинка → WebP 256×256, видео WebM сохраняется как есть после проверки. */
export async function saveIcon(
  root: string,
  itemId: number,
  buffer: Buffer,
): Promise<{ path: string; kind: "image" | "video" }> {
  const name = randomUUID();
  if (isWebm(buffer)) {
    if (buffer.length > ICON_VIDEO_MAX_BYTES) {
      throw new AppError(400, "file_too_large", "Видео-иконка должна быть не больше 4 МБ.");
    }
    const path = join("icons", String(itemId), `${name}.webm`);
    await save(root, path, buffer);
    return { path, kind: "video" };
  }

  const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" });
  let meta: sharp.Metadata;
  try {
    meta = await image.metadata();
  } catch {
    throw new AppError(400, "invalid_icon", "Подходят PNG, JPG, WebP или видео WebM.");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
    throw new AppError(400, "invalid_icon", "Подходят PNG, JPG, WebP или видео WebM.");
  }
  const data = await image
    .rotate()
    .resize({ width: 256, height: 256, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85 })
    .toBuffer();
  const path = join("icons", String(itemId), `${name}.webp`);
  await save(root, path, data);
  return { path, kind: "image" };
}

export const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Предпросмотр предмета (анимации, одежды): видео WebM — как есть после
 * проверки заголовка, картинка или гиф — перекодируется в WebP (гиф
 * остаётся анимированным) не больше 640×640.
 */
export async function savePreview(
  root: string,
  itemId: number,
  buffer: Buffer,
): Promise<{ path: string; kind: "image" | "video" }> {
  if (buffer.length > PREVIEW_MAX_BYTES) {
    throw new AppError(400, "file_too_large", "Предпросмотр должен быть не больше 8 МБ.");
  }
  const name = randomUUID();
  if (isWebm(buffer)) {
    const path = join("icons", String(itemId), `preview-${name}.webm`);
    await save(root, path, buffer);
    return { path, kind: "video" };
  }
  const invalid = () => new AppError(400, "invalid_preview", "Подходят видео WebM, GIF, PNG, JPG или WebP.");
  const image = sharp(buffer, { animated: true, limitInputPixels: 40_000_000, failOn: "error" });
  let meta: sharp.Metadata;
  try {
    meta = await image.metadata();
  } catch {
    throw invalid();
  }
  if (!meta.format || !["jpeg", "png", "webp", "gif"].includes(meta.format)) throw invalid();
  const data = await image
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const path = join("icons", String(itemId), `preview-${name}.webp`);
  await save(root, path, data);
  return { path, kind: "image" };
}

/** Формат звука по первым байтам: MP3, OGG или WAV. */
function audioExtension(buffer: Buffer): "mp3" | "ogg" | "wav" | null {
  if (buffer.length < 16) return null;
  if (buffer.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
  if (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) return "mp3";
  if (buffer.subarray(0, 4).toString("latin1") === "OggS") return "ogg";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WAVE") {
    return "wav";
  }
  return null;
}

/** Звук к предпросмотру. Сохраняется как есть после проверки формата. */
export async function saveAudio(root: string, itemId: number, buffer: Buffer): Promise<string> {
  if (buffer.length > AUDIO_MAX_BYTES) {
    throw new AppError(400, "file_too_large", "Звук должен быть не больше 5 МБ.");
  }
  const ext = audioExtension(buffer);
  if (!ext) throw new AppError(400, "invalid_audio", "Подходят MP3, OGG или WAV.");
  const path = join("icons", String(itemId), `audio-${randomUUID()}.${ext}`);
  await save(root, path, buffer);
  return path;
}
