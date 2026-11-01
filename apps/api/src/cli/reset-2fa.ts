/**
 * Сброс двухфакторного входа, если администратор потерял телефон:
 *
 *   pnpm --filter @twm/api admin:reset-2fa -- --login admin_max
 *
 * Запускается только на сервере. После сброса все сессии пользователя
 * закрываются, а при следующем входе в админ-панель он заново настроит 2FA.
 */
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";

async function main() {
  const { values } = parseArgs({ options: { login: { type: "string" } } });
  if (!values.login) throw new Error("Укажите --login");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Не задан DATABASE_URL");

  const database = createDatabase(url, { max: 1 });
  try {
    const [user] = await database.sql<{ id: string; login: string }[]>`
      UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = now()
      WHERE lower(login) = lower(${values.login})
      RETURNING id, login`;
    if (!user) throw new Error(`Пользователь «${values.login}» не найден`);
    await database.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${user.id} AND revoked_at IS NULL`;
    await database.sql`
      INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
      VALUES (NULL, 'twofactor.reset_cli', 'user', ${user.id}, ${database.sql.json({ login: user.login })})`;
    console.log(`Готово: двухфакторный вход для «${user.login}» сброшен, сессии закрыты.`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Ошибка: ${(error as Error).message ?? String(error)}`);
  process.exit(1);
});
