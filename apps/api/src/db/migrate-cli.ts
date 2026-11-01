import { createDatabase } from "./client.js";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Не задан DATABASE_URL");
  process.exit(1);
}

const database = createDatabase(url, { max: 1 });
try {
  const applied = await migrate(database.sql, console.log);
  console.log(applied.length ? `Готово: применено ${applied.length}` : "База уже в актуальном состоянии");
} finally {
  await database.close();
}
