/**
 * Удаление аккаунта по просьбе игрока (письмо на support@):
 *
 *   sudo twm delete-user --login ЛОГИН
 *
 * Сначала показывает, что будет удалено, и спрашивает подтверждение
 * (или --yes). Что удаляется и что обезличивается — lib/account-deletion.ts.
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { deleteAccount } from "../lib/account-deletion.js";

async function main() {
  const { values } = parseArgs({ options: { login: { type: "string" }, yes: { type: "boolean", default: false } } });
  if (!values.login) throw new Error("Укажите --login");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Не задан DATABASE_URL");
  const uploadDir = resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  const privateDir = resolve(process.env.PRIVATE_DIR ?? `${uploadDir}-private`);

  const database = createDatabase(url, { max: 1 });
  try {
    const [user] = await database.sql<{ id: string; login: string; email: string; role: string; listings: number; conversations: number }[]>`
      SELECT u.id, u.login, u.email, u.role,
        (SELECT count(*)::int FROM listings WHERE user_id = u.id) AS listings,
        (SELECT count(*)::int FROM conversations WHERE buyer_id = u.id OR seller_id = u.id) AS conversations
      FROM users u WHERE lower(u.login) = lower(${values.login})`;
    if (!user) throw new Error(`Пользователь «${values.login}» не найден`);
    if (user.role !== "user") throw new Error("Это сотрудник площадки: сначала снимите роль в админ-панели");

    console.log(`Аккаунт: ${user.login} <${user.email}>`);
    console.log(`Объявлений: ${user.listings}, переписок: ${user.conversations}`);
    console.log("Будут удалены профиль, игровые профили, объявления с фото, избранное, подписки, уведомления и сеансы.");
    console.log("Переписка, сделки и отзывы останутся у собеседников, но без логина и email.");
    if (!values.yes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Чтобы удалить, введите логин «${user.login}»: `);
      rl.close();
      if (answer.trim().toLowerCase() !== user.login.toLowerCase()) throw new Error("Логин не совпал — ничего не удалено");
    }
    const result = await deleteAccount(database.sql, user.id, { uploadDir, privateDir });
    console.log(
      `Готово: аккаунт «${result.login}» удалён. Объявлений удалено: ${result.listingsDeleted}, снято: ${result.listingsWithdrawn}. ` +
        `Игровых профилей удалено: ${result.profilesDeleted}, обезличено: ${result.profilesKept}.`,
    );
    console.log("Данные исчезнут из резервных копий по истечении срока их хранения (до 30 дней).");
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Ошибка: ${(error as Error).message ?? String(error)}`);
  process.exit(1);
});
