import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
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

    const [row] = await ctx.sql<(UserRow & { sessionMfaVerifiedAt: Date | null })[]>`
      SELECT u.*, s.mfa_verified_at AS session_mfa_verified_at
      FROM users u
      JOIN sessions s ON s.user_id = u.id
      WHERE u.id = ${claims.sub} AND s.id = ${claims.sid}
        AND s.revoked_at IS NULL AND s.expires_at > now()`;
    if (!row) throw new AppError(401, "session_revoked", "Сессия завершена, войдите снова");
    if (row.status === "blocked") throw accountBlocked();

    const { sessionMfaVerifiedAt, ...user } = row;
    request.auth = { user, sessionId: claims.sid, sessionMfaVerified: sessionMfaVerifiedAt !== null };
  };
}

/**
 * Вход необязателен: если токен верный, данные пользователя доступны
 * (например, чтобы отметить избранное), иначе запрос идёт как от гостя.
 */
export function optionalAuth(ctx: AppContext) {
  const strict = requireAuth(ctx);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.headers.authorization) return;
    try {
      await strict(request, reply);
    } catch {
      request.auth = undefined;
    }
  };
}

export const ROLE_LEVEL: Record<Role, number> = { user: 0, moderator: 1, admin: 2, superadmin: 3 };

export function hasRole(role: Role, min: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[min];
}

/** Пропускает только пользователей с ролью не ниже указанной. Вызывается после requireAuth. */
export function requireRole(min: Role) {
  return async (request: FastifyRequest): Promise<void> => {
    const role = request.auth?.user.role;
    if (!role || !hasRole(role, min)) throw errors.forbidden();
  };
}

/** Для администрации обязателен двухфакторный вход, подтверждённый в текущей сессии. */
export async function requireMfa(request: FastifyRequest): Promise<void> {
  const auth = request.auth;
  if (!auth) throw errors.unauthorized();
  if (!auth.user.totpEnabledAt) {
    throw new AppError(403, "mfa_setup_required", "Для доступа к админ-панели включите двухфакторный вход");
  }
  if (!auth.sessionMfaVerified) {
    throw new AppError(403, "mfa_required", "Введите код из приложения-аутентификатора");
  }
}

/** Полная проверка для маршрутов админ-панели: вход, роль, двухфакторный код. */
export function requireStaff(ctx: AppContext, min: Role = "moderator"): preHandlerAsyncHookHandler[] {
  return [requireAuth(ctx), requireRole(min), requireMfa] as preHandlerAsyncHookHandler[];
}

export function accountBlocked(): AppError {
  return new AppError(403, "account_blocked", "Аккаунт заблокирован администрацией площадки");
}

/** Достаёт данные входа в обработчике после requireAuth. */
export function authOf(request: FastifyRequest): AuthState {
  if (!request.auth) throw errors.unauthorized();
  return request.auth;
}
