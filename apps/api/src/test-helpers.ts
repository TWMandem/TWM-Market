import type { FastifyInstance } from "fastify";
import type { AuthResponseDto } from "@twm/shared";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type Database } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { MemoryMailer } from "./mail/mailer.js";

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
  await database.sql`TRUNCATE users, sessions, email_codes, game_profiles, game_profile_history CASCADE`;

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
