import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@twm/shared";
import type { AppContext, AuthState } from "../../context.js";
import type { UserRow } from "../../db/types.js";
import { AppError, errors } from "../../lib/errors.js";
import { verifyAccessToken } from "../../lib/tokens.js";

/**
 * Проверка входа для защищённых маршрутов.
 * Токен доступа проверяется по подписи, а сессия и пользователь —
 * по базе: так выход с устройства и блокировка аккаунта действуют сразу,
 * не дожидаясь истечения токена.
 */
export function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) throw errors.unauthorized();

    const claims = await verifyAccessToken(token, ctx.config.JWT_SECRET);
    if (!claims) throw new AppError(401, "token_expired", "Сессия устарела, войдите снова");

    const [user] = await ctx.sql<UserRow[]>`
      SELECT u.* FROM users u
      JOIN sessions s ON s.user_id = u.id
      WHERE u.id = ${claims.sub} AND s.id = ${claims.sid}
        AND s.revoked_at IS NULL AND s.expires_at > now()`;
    if (!user) throw new AppError(401, "session_revoked", "Сессия завершена, войдите снова");
    if (user.status === "blocked") throw accountBlocked();

    request.auth = { user, sessionId: claims.sid };
  };
}

const ROLE_LEVEL: Record<Role, number> = { user: 0, moderator: 1, admin: 2, superadmin: 3 };

/** Пропускает только пользователей с ролью не ниже указанной. Вызывается после requireAuth. */
export function requireRole(min: Role) {
  return async (request: FastifyRequest): Promise<void> => {
    const role = request.auth?.user.role;
    if (!role || ROLE_LEVEL[role] < ROLE_LEVEL[min]) throw errors.forbidden();
  };
}

export function accountBlocked(): AppError {
  return new AppError(403, "account_blocked", "Аккаунт заблокирован администрацией площадки");
}

/** Достаёт данные входа в обработчике после requireAuth. */
export function authOf(request: FastifyRequest): AuthState {
  if (!request.auth) throw errors.unauthorized();
  return request.auth;
}
