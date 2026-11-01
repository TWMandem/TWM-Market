import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import type { Mailer } from "./mail/mailer.js";
import type { UserRow } from "./db/types.js";

/** Всё, что нужно обработчикам запросов: настройки, база, почта. */
export interface AppContext {
  config: Config;
  sql: Sql;
  mailer: Mailer;
}

export interface AuthState {
  user: UserRow;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Заполняется проверкой requireAuth. */
    auth?: AuthState;
  }
}
