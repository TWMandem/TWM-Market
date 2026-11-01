import { z } from "zod";

/**
 * Настройки сервера читаются только из переменных окружения.
 * Если что-то задано неверно, сервер не стартует и пишет, что именно не так,
 * вместо того чтобы молча работать с ошибочной конфигурацией.
 */

// Значения только для тестов. В разработке и на сервере секреты задаются в .env.
const TEST_SECRET = "test-secret-not-for-production-0123456789abcdef";

const bool = z
  .enum(["true", "false", "1", "0", "on", "off"])
  .transform((value) => value === "true" || value === "1" || value === "on");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGINS: z
    .string()
    .default("http://tauri.localhost,https://tauri.localhost,tauri://localhost,http://localhost:1420")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Сервер стоит за обратным прокси (nginx, Caddy, хостинг) — брать IP из X-Forwarded-For. */
  TRUST_PROXY: bool.default("false"),

  DATABASE_URL: z.string().url().optional(),

  /** Секрет подписи токенов доступа. Минимум 32 символа случайных данных. */
  JWT_SECRET: z.string().min(32, "JWT_SECRET — минимум 32 символа").optional(),
  /** Секрет для хеширования кодов из писем. Минимум 32 символа. */
  CODE_SECRET: z.string().min(32, "CODE_SECRET — минимум 32 символа").optional(),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** console — письма выводятся в журнал сервера (для разработки). */
  MAIL_TRANSPORT: z.enum(["console"]).default("console"),

  /** Папка для загруженных файлов (фото объявлений, иконки предметов). */
  UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
  /** Максимальный размер одного загружаемого файла, МБ. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),

  /** Ограничение частоты запросов к входу и регистрации. */
  RATE_LIMIT: bool.default("true"),
});

export type Config = Omit<z.infer<typeof baseSchema>, "JWT_SECRET" | "CODE_SECRET"> & {
  JWT_SECRET: string;
  CODE_SECRET: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = baseSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Неверные переменные окружения:\n${details}`);
  }
  const data = parsed.data;
  const isTest = data.NODE_ENV === "test";

  const missing: string[] = [];
  if (!data.JWT_SECRET && !isTest) missing.push("JWT_SECRET");
  if (!data.CODE_SECRET && !isTest) missing.push("CODE_SECRET");
  for (const key of ["JWT_SECRET", "CODE_SECRET"] as const) {
    if (data[key]?.startsWith("замените") && data.NODE_ENV === "production") {
      missing.push(`${key} (оставлено значение из примера)`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Неверные переменные окружения:\n${missing.map((k) => `  ${k}: не задан`).join("\n")}`);
  }

  return {
    ...data,
    JWT_SECRET: data.JWT_SECRET ?? TEST_SECRET,
    CODE_SECRET: data.CODE_SECRET ?? TEST_SECRET,
  };
}
