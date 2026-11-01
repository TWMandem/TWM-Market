import type { FastifyInstance } from "fastify";
import type { AuthResponseDto } from "@twm/shared";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type Database } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { MemoryMailer } from "./mail/mailer.js";
import { currentStep, totpAt } from "./lib/totp.js";

/**
 * Интеграционные тесты работают с настоящей базой PostgreSQL.
 * Адрес берётся из TEST_DATABASE_URL; если он не задан, тесты пропускаются.
 * В GitHub Actions база поднимается автоматически.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const skipWithoutDb = TEST_DATABASE_URL ? false : "не задан TEST_DATABASE_URL";

export interface TestEnv {
  app: FastifyInstance;
  mailer: MemoryMailer;
  database: Database;
  close: () => Promise<void>;
}

export async function setupTestEnv(env: Record<string, string> = {}): Promise<TestEnv> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL не задан");
  const database = createDatabase(TEST_DATABASE_URL, { max: 5 });
  await migrate(database.sql);
  await database.sql`
    TRUNCATE users, sessions, email_codes, game_profiles, game_profile_history,
             audit_log, attribute_definitions, catalog_items, categories CASCADE`;
  // Убираем то, что тесты добавили к стартовым справочникам.
  await database.sql`DELETE FROM servers WHERE number > 13`;
  await database.sql`
    DELETE FROM listing_types WHERE code NOT IN (
      'item', 'vehicle', 'sim_card', 'house', 'apartment', 'business',
      'family_mansion', 'transport_company', 'taxi_company', 'diner', 'dorm_room')`;

  const config = loadConfig({ NODE_ENV: "test", RATE_LIMIT: "false", ...env });
  const mailer = new MemoryMailer();
  const app = await buildApp({ config, sql: database.sql, mailer });
  return {
    app,
    mailer,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

let counter = 0;

/** Регистрирует пользователя с уникальным логином и возвращает ответ API. */
export async function registerUser(
  env: TestEnv,
  overrides: Partial<{ login: string; email: string; password: string }> = {},
): Promise<AuthResponseDto & { password: string }> {
  counter += 1;
  const login = overrides.login ?? `player${counter}_${Date.now() % 100000}`;
  const body = {
    login,
    email: overrides.email ?? `${login}@example.com`,
    password: overrides.password ?? "correct-horse-battery",
    rulesAccepted: true,
  };
  const response = await env.app.inject({ method: "POST", url: "/v1/auth/register", payload: body });
  if (response.statusCode !== 201) {
    throw new Error(`Регистрация не удалась: ${response.statusCode} ${response.body}`);
  }
  return { ...(response.json() as AuthResponseDto), password: body.password };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Создаёт сотрудника с нужной ролью и включённым двухфакторным входом.
 * Возвращает токен сессии, в которой код уже введён.
 */
export async function createStaff(
  env: TestEnv,
  role: "moderator" | "admin" | "superadmin",
  options: { enable2fa?: boolean } = {},
): Promise<AuthResponseDto & { password: string; totpSecret: string | null }> {
  const user = await registerUser(env);
  await env.database.sql`UPDATE users SET role = ${role}, email_verified_at = now() WHERE id = ${user.user.id}`;
  if (options.enable2fa === false) return { ...user, totpSecret: null };

  const setup = await env.app.inject({ method: "POST", url: "/v1/me/2fa/setup", headers: bearer(user.accessToken) });
  const { secret } = setup.json() as { secret: string };
  const enable = await env.app.inject({
    method: "POST",
    url: "/v1/me/2fa/enable",
    headers: bearer(user.accessToken),
    payload: { code: totpAt(secret, currentStep()) },
  });
  if (enable.statusCode !== 200) throw new Error(`2FA не включилась: ${enable.body}`);
  return { ...user, totpSecret: secret };
}
