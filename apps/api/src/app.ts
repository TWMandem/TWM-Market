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

export const API_VERSION = "0.4.2";

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
  const ctx: AppContext = { config, sql, mailer: mailer ?? new ConsoleMailer(app.log), uploadDir };

  registerErrorHandler(app);

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE"],
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

  app.get("/health", async () => ({
    status: "ok" as const,
    version: API_VERSION,
    time: new Date().toISOString(),
  }));

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

  return app;
}
