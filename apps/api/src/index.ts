import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { migrate } from "./db/migrate.js";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("Не задан DATABASE_URL — адрес базы данных PostgreSQL");
  process.exit(1);
}

const database = createDatabase(config.DATABASE_URL);
// Новые миграции применяются при каждом запуске сервера.
await migrate(database.sql, (message) => console.log(message));

const app = await buildApp({ config, sql: database.sql });

const shutdown = async (signal: string) => {
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
