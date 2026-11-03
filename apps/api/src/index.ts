import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { SmtpMailer, createMailer } from "./mail/mailer.js";
import { archiveExpired } from "./modules/listings/service.js";
import { snapshotPrices } from "./modules/stats/prices.js";
import { pruneErrors } from "./lib/error-log.js";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("Не задан DATABASE_URL — адрес базы данных PostgreSQL");
  process.exit(1);
}

const database = createDatabase(config.DATABASE_URL);
// Новые миграции применяются при каждом запуске сервера.
await migrate(database.sql, (message) => console.log(message));

// Почта: Postbox или SMTP на сервере, вывод в журнал при разработке.
const mailer = createMailer(config, console);
if (mailer instanceof SmtpMailer) {
  try {
    await mailer.verify();
    console.log(`Почта: подключение к ${config.SMTP_HOST} в порядке`);
  } catch (error) {
    // Сервер всё равно запускается: без почты работает всё, кроме писем с кодами.
    console.error(`Почта: не удалось подключиться к ${config.SMTP_HOST}:`, error);
  }
} else if (mailer) {
  console.log(`Почта: Yandex Cloud Postbox, отправитель ${config.MAIL_FROM}. Проверка: sudo twm mail-test ВАШ@EMAIL`);
}

const app = await buildApp({ config, sql: database.sql, ...(mailer ? { mailer } : {}) });

// Каждые 10 минут объявления с истёкшим сроком уходят в архив.
const archiveTimer = setInterval(() => {
  archiveExpired(database.sql)
    .then((count) => count > 0 && app.log.info(`В архив ушло объявлений: ${count}`))
    .catch((error: unknown) => app.log.error(error));
  pruneErrors(database.sql).catch((error: unknown) => app.log.error(error));
}, 10 * 60 * 1000);

// Раз в час — снимок цен для графиков «история цены» (и сразу после запуска).
const takeSnapshot = () => {
  snapshotPrices(database.sql).catch((error: unknown) => app.log.error(error, "Снимок цен не удался"));
};
takeSnapshot();
const priceTimer = setInterval(takeSnapshot, 60 * 60 * 1000);

const shutdown = async (signal: string) => {
  clearInterval(archiveTimer);
  clearInterval(priceTimer);
  app.log.info(`Получен ${signal}, останавливаю сервер`);
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
