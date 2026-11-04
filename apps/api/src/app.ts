import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "./config.js";
import type { AppContext } from "./context.js";
import type { Sql } from "./db/client.js";
import { logError } from "./lib/error-log.js";
import { registerErrorHandler } from "./lib/errors.js";
import { ConsoleMailer, type Mailer } from "./mail/mailer.js";
import { adminAuditRoutes } from "./modules/admin/audit.js";
import { adminCatalogRoutes } from "./modules/admin/catalog.js";
import { adminUserRoutes } from "./modules/admin/users.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { gameProfileRoutes } from "./modules/game-profiles/routes.js";
import { listingRoutes } from "./modules/listings/routes.js";
import { meRoutes } from "./modules/me/routes.js";
import { serverRoutes } from "./modules/servers/routes.js";
import { twoFactorRoutes } from "./modules/two-factor/routes.js";
import { chatRoutes } from "./modules/chat/routes.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { adminModerationRoutes } from "./modules/admin/moderation.js";
import { adminStatsRoutes } from "./modules/admin/stats.js";
import { adminActivityRoutes } from "./modules/admin/activity.js";
import { priceRoutes } from "./modules/stats/prices.js";
import { publicStatsRoutes } from "./modules/stats/public.js";
import { savedSearchRoutes } from "./modules/saved-searches/routes.js";
import { verificationRoutes } from "./modules/game-profiles/verification.js";
import { errorRoutes } from "./modules/errors/routes.js";

export const API_VERSION = "0.13.0";

export interface BuildOptions {
  config: Config;
  sql: Sql;
  mailer?: Mailer;
}

/**
 * Собирает приложение Fastify без запуска сетевого порта.
 * Так его удобно проверять в тестах через app.inject().
 */
export async function buildApp({ config, sql, mailer }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            // Заголовки авторизации, пароли и токены никогда не пишутся в журнал.
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
              "req.body.refreshToken",
            ],
          },
    trustProxy: config.TRUST_PROXY,
    // Ограничение размера тела запроса. Скриншоты будут загружаться
    // отдельным маршрутом со своим лимитом (шаг 4).
    bodyLimit: 64 * 1024,
  });

  const uploadDir = resolve(config.UPLOAD_DIR);
  await mkdir(uploadDir, { recursive: true });
  const privateDir = resolve(config.PRIVATE_DIR ?? `${uploadDir}-private`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const ctx: AppContext = { config, sql, mailer: mailer ?? new ConsoleMailer(app.log), uploadDir, privateDir };

  // Внутренние ошибки (500) записываются в журнал для админки.
  registerErrorHandler(app, (error, request) => {
    logError(sql, {
      source: "server",
      message: error.message || error.name,
      stack: error.stack ?? "",
      route: `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0]}`,
      appVersion: API_VERSION,
      userId: request.auth?.user.id ?? null,
    }).catch(() => undefined);
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  if (config.RATE_LIMIT) {
    // Лимиты задаются у отдельных маршрутов (вход, регистрация, коды).
    await app.register(rateLimit, { global: false });
  }

  // Загрузка файлов: по одному файлу на запрос, с ограничением размера.
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5, parts: 6 },
  });

  // Готовые изображения отдаются как статика. Имена файлов случайные и не меняются,
  // поэтому их можно надолго кешировать.
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: "/media/",
    decorateReply: false,
    index: false,
    dotfiles: "deny",
    immutable: true,
    maxAge: "30d",
  });

  // Проверка для мониторинга: сервер отвечает и база доступна.
  app.get("/health", async (_request, reply) => {
    try {
      await sql`SELECT 1`;
    } catch {
      return reply.code(503).send({ status: "error", version: API_VERSION, time: new Date().toISOString(), database: "unavailable" });
    }
    return { status: "ok" as const, version: API_VERSION, time: new Date().toISOString() };
  });

  await authRoutes(app, ctx);
  await meRoutes(app, ctx);
  await gameProfileRoutes(app, ctx);
  await serverRoutes(app, ctx);
  await listingRoutes(app, ctx);
  await twoFactorRoutes(app, ctx);
  await catalogRoutes(app, ctx);
  await adminUserRoutes(app, ctx);
  await adminCatalogRoutes(app, ctx);
  await adminAuditRoutes(app, ctx);
  await chatRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await adminModerationRoutes(app, ctx);
  await adminStatsRoutes(app, ctx);
  await adminActivityRoutes(app, ctx);
  await priceRoutes(app, ctx);
  await publicStatsRoutes(app, ctx);
  await savedSearchRoutes(app, ctx);
  await verificationRoutes(app, ctx);
  await errorRoutes(app, ctx);

  return app;
}
