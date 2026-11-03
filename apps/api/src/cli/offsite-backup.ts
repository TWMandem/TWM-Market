/**
 * Копии базы вне сервера: загружает зашифрованные файлы копии в Object Storage
 * (Yandex Cloud) и удаляет там копии старше BACKUP_KEEP_DAYS.
 *
 *   twm offsite-backup ФАЙЛ…        — загрузить (вызывает `twm backup`)
 *   twm offsite-backup --check      — проверить доступ: загрузить и удалить пробный файл
 *   twm offsite-backup --list       — список копий в хранилище
 *
 * Настройки в /etc/twm/twm.env: S3_BUCKET, S3_KEY_ID, S3_SECRET,
 * необязательно S3_ENDPOINT (https://storage.yandexcloud.net), S3_REGION (ru-central1),
 * BACKUP_KEEP_DAYS (30).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../db/client.js";
import { logError } from "../lib/error-log.js";
import { deleteObject, fileName, listObjects, uploadFile, type StorageOptions } from "../lib/object-storage.js";

const env = process.env;
const missing = ["S3_BUCKET", "S3_KEY_ID", "S3_SECRET"].filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`Хранилище для копий не настроено: нет ${missing.join(", ")} в /etc/twm/twm.env (см. deploy/README.md).`);
  process.exit(2);
}
const options: StorageOptions = {
  endpoint: env.S3_ENDPOINT || "https://storage.yandexcloud.net",
  region: env.S3_REGION || "ru-central1",
  bucket: env.S3_BUCKET!,
  keyId: env.S3_KEY_ID!,
  secret: env.S3_SECRET!,
};
const PREFIX = "twm-backups/";
const keepDays = Math.max(1, Number(env.BACKUP_KEEP_DAYS) || 30);
const args = process.argv.slice(2);

try {
  if (args[0] === "--check") {
    const dir = await mkdtemp(join(tmpdir(), "twm-check-"));
    const file = join(dir, "check.txt");
    await writeFile(file, `TWM Market: проверка доступа ${new Date().toISOString()}\n`);
    const key = `${PREFIX}check-${Date.now()}.txt`;
    await uploadFile(options, key, file);
    await deleteObject(options, key);
    await rm(dir, { recursive: true, force: true });
    console.log(`Хранилище «${options.bucket}» доступно: пробный файл загружен и удалён.`);
  } else if (args[0] === "--list") {
    const items = (await listObjects(options, PREFIX)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    if (items.length === 0) console.log("Копий в хранилище пока нет.");
    for (const o of items) console.log(`${o.lastModified.toISOString().slice(0, 16).replace("T", " ")}  ${(o.size / 1024 / 1024).toFixed(1).padStart(8)} МБ  ${o.key}`);
  } else {
    if (args.length === 0) throw new Error("Укажите файлы для загрузки");
    const day = new Date().toISOString().slice(0, 10);
    for (const path of args) {
      const key = `${PREFIX}${day}/${fileName(path)}`;
      await uploadFile(options, key, path);
      console.log(`Загружено в хранилище: ${key}`);
    }
    // Старые копии удаляем, но не трогаем, если свежая загрузка не удалась.
    const border = Date.now() - keepDays * 86_400_000;
    let removed = 0;
    for (const o of await listObjects(options, PREFIX)) {
      if (o.lastModified.getTime() < border) {
        await deleteObject(options, o.key);
        removed += 1;
      }
    }
    if (removed) console.log(`Удалено старых копий (старше ${keepDays} дн.): ${removed}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  // Ночная загрузка не удалась — пусть администратор увидит это в разделе «Ошибки».
  if (env.DATABASE_URL && args[0] !== "--check" && args[0] !== "--list") {
    try {
      const database = createDatabase(env.DATABASE_URL, { max: 1 });
      await logError(database.sql, { source: "server", message: `Копия вне сервера не загружена: ${message}`, route: "twm backup" });
      await database.close();
    } catch {
      // База недоступна — остаётся запись в /var/log/twm-backup.log.
    }
  }
  process.exit(1);
}
