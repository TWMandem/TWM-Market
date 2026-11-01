import { z } from "zod";

/**
 * Настройки сервера читаются только из переменных окружения.
 * Если что-то задано неверно, сервер не стартует и пишет, что именно не так,
 * вместо того чтобы молча работать с ошибочной конфигурацией.
 */
const envSchema = z.object({
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
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Неверные переменные окружения:\n${details}`);
  }
  return parsed.data;
}
