import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { DEFAULT_SERVERS } from "@twm/shared";
import type { Config } from "./config.js";

export const API_VERSION = "0.1.0";

/**
 * Собирает приложение Fastify без запуска сетевого порта.
 * Так его удобно проверять в тестах через app.inject().
 */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            // Заголовки авторизации и cookie никогда не пишутся в логи.
            redact: ["req.headers.authorization", "req.headers.cookie"],
          },
    // Ограничение размера тела запроса. Скриншоты будут загружаться
    // отдельным маршрутом со своим лимитом.
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: false,
  });

  app.get("/health", async () => ({
    status: "ok" as const,
    version: API_VERSION,
    time: new Date().toISOString(),
  }));

  // Временный маршрут: пока справочник серверов не перенесён в базу данных
  // (шаг 3), приложение получает список отсюда.
  app.get("/v1/servers", async () => ({
    items: DEFAULT_SERVERS.map((server) => ({ ...server, isActive: true })),
  }));

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "not_found", message: `Маршрут ${request.method} ${request.url} не найден` });
  });

  return app;
}
