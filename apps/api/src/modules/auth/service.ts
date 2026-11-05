import type { FastifyRequest } from "fastify";
import type { AuthResponseDto, MeDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { EmailCodeRow, SessionRow, UserRow } from "../../db/types.js";
import { AppError } from "../../lib/errors.js";
import {
  generateCode,
  generateRefreshToken,
  hashCode,
  hashToken,
  safeEqualHex,
  signAccessToken,
} from "../../lib/tokens.js";

export const CODE_TTL_MINUTES = 15;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 60;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function toMeDto(user: UserRow): MeDto {
  return {
    id: user.id,
    login: user.login,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    showOnline: user.showOnline,
    notifyFavorites: user.notifyFavorites,
  };
}

function clientInfo(request: FastifyRequest) {
  const ua = request.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 300) : null,
    ip: request.ip ?? null,
  };
}

/** Создаёт сессию (новое устройство) и выдаёт пару токенов. */
export async function createSession(ctx: AppContext, user: UserRow, request: FastifyRequest): Promise<AuthResponseDto> {
  const refreshToken = generateRefreshToken();
  const { userAgent, ip } = clientInfo(request);
  const [session] = await ctx.sql<SessionRow[]>`
    INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
    VALUES (${user.id}, ${hashToken(refreshToken)}, ${userAgent}, ${ip},
            now() + make_interval(days => ${ctx.config.REFRESH_TOKEN_TTL_DAYS}::int))
    RETURNING *`;
  if (!session) throw new Error("Не удалось создать сессию");
  return issueTokens(ctx, user, session.id, refreshToken);
}

export async function issueTokens(
  ctx: AppContext,
  user: UserRow,
  sessionId: string,
  refreshToken: string,
): Promise<AuthResponseDto> {
  const ttl = ctx.config.ACCESS_TOKEN_TTL_MIN;
  const accessToken = await signAccessToken({ sub: user.id, sid: sessionId }, ctx.config.JWT_SECRET, ttl);
  return { accessToken, expiresIn: ttl * 60, refreshToken, user: toMeDto(user) };
}

/**
 * Завершить сеансы на всех (или всех других) устройствах. Ключи фоновых
 * уведомлений Android тоже отзываются: текущее устройство зарегистрирует
 * новый при следующем запуске приложения.
 */
export async function revokeAllSessions(ctx: AppContext, userId: string, exceptSessionId?: string): Promise<void> {
  await ctx.sql`DELETE FROM push_devices WHERE user_id = ${userId}`;
  if (exceptSessionId) {
    await ctx.sql`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL AND id <> ${exceptSessionId}`;
  } else {
    await ctx.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
  }
}

/**
 * Создаёт новый код для письма. Предыдущие неиспользованные коды
 * того же назначения перестают действовать.
 */
export async function issueCode(
  ctx: AppContext,
  userId: string,
  purpose: EmailCodeRow["purpose"],
): Promise<string> {
  const code = generateCode();
  await ctx.sql.begin(async (tx) => {
    await tx`
      UPDATE email_codes SET used_at = now()
      WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL`;
    await tx`
      INSERT INTO email_codes (user_id, purpose, code_hash, expires_at)
      VALUES (${userId}, ${purpose}, ${hashCode(code, ctx.config.CODE_SECRET)},
              now() + make_interval(mins => ${CODE_TTL_MINUTES}::int))`;
  });
  return code;
}

/** Сколько секунд осталось до возможности запросить новый код (0 — можно сейчас). */
export async function secondsUntilResend(
  ctx: AppContext,
  userId: string,
  purpose: EmailCodeRow["purpose"],
): Promise<number> {
  const [row] = await ctx.sql<{ wait: number }[]>`
    SELECT GREATEST(0, ${CODE_RESEND_SECONDS}::int - EXTRACT(EPOCH FROM now() - created_at))::int AS wait
    FROM email_codes
    WHERE user_id = ${userId} AND purpose = ${purpose}
    ORDER BY created_at DESC
    LIMIT 1`;
  return row?.wait ?? 0;
}

/**
 * Проверяет код и помечает его использованным.
 * После CODE_MAX_ATTEMPTS ошибок код сгорает.
 */
export async function consumeCode(
  ctx: AppContext,
  userId: string,
  purpose: EmailCodeRow["purpose"],
  code: string,
): Promise<void> {
  const [row] = await ctx.sql<EmailCodeRow[]>`
    SELECT * FROM email_codes
    WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1`;

  const invalid = new AppError(400, "invalid_code", "Неверный код", { code: "Неверный код" });
  if (!row) throw invalid;
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, "code_expired", "Срок действия кода истёк. Запросите новый.", {
      code: "Код истёк",
    });
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new AppError(400, "too_many_attempts", "Слишком много неверных попыток. Запросите новый код.", {
      code: "Запросите новый код",
    });
  }
  if (!safeEqualHex(row.codeHash, hashCode(code, ctx.config.CODE_SECRET))) {
    await ctx.sql`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
    throw invalid;
  }
  const used = await ctx.sql`UPDATE email_codes SET used_at = now() WHERE id = ${row.id} AND used_at IS NULL`;
  if (used.count === 0) throw invalid;
}

export async function findUserByIdentifier(ctx: AppContext, identifier: string): Promise<UserRow | undefined> {
  const value = identifier.trim();
  const [user] = value.includes("@")
    ? await ctx.sql<UserRow[]>`SELECT * FROM users WHERE lower(email) = lower(${value})`
    : await ctx.sql<UserRow[]>`SELECT * FROM users WHERE lower(login) = lower(${value})`;
  return user;
}
