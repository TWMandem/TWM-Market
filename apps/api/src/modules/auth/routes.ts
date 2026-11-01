import type { FastifyInstance } from "fastify";
import {
  forgotPasswordSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  signInSchema,
  verifyEmailSchema,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import { uniqueViolation } from "../../db/client.js";
import type { SessionRow, UserRow } from "../../db/types.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { hashPassword, verifyDummy, verifyPassword } from "../../lib/passwords.js";
import { generateRefreshToken, hashToken } from "../../lib/tokens.js";
import { mailTemplates } from "../../mail/mailer.js";
import { accountBlocked, authOf, requireAuth } from "./guard.js";
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  consumeCode,
  createSession,
  findUserByIdentifier,
  issueCode,
  issueTokens,
  revokeAllSessions,
  secondsUntilResend,
  toMeDto,
} from "./service.js";

const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

const loginTaken = () =>
  errors.conflict("login_taken", "Этот логин уже занят", { login: "Этот логин уже занят" });
const emailTaken = () =>
  errors.conflict("email_taken", "Этот email уже зарегистрирован", { email: "Этот email уже зарегистрирован" });

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = requireAuth(ctx);

  // Регистрация. Сразу входит в аккаунт и отправляет код подтверждения email.
  app.post("/v1/auth/register", limit(5, "1 hour"), async (request, reply) => {
    const input = parseBody(registerSchema, request.body);

    const [existing] = await ctx.sql<{ login: boolean; email: boolean }[]>`
      SELECT
        bool_or(lower(login) = lower(${input.login})) AS login,
        bool_or(lower(email) = lower(${input.email})) AS email
      FROM users
      WHERE lower(login) = lower(${input.login}) OR lower(email) = lower(${input.email})`;
    if (existing?.login) throw loginTaken();
    if (existing?.email) throw emailTaken();

    const passwordHash = await hashPassword(input.password);
    let user: UserRow | undefined;
    try {
      [user] = await ctx.sql<UserRow[]>`
        INSERT INTO users (login, email, password_hash)
        VALUES (${input.login}, ${input.email}, ${passwordHash})
        RETURNING *`;
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === "users_login_lower_uq") throw loginTaken();
      if (constraint === "users_email_lower_uq") throw emailTaken();
      throw error;
    }
    if (!user) throw new Error("Пользователь не создан");

    const code = await issueCode(ctx, user.id, "verify_email");
    // Если почта временно не отправляется, аккаунт всё равно создан: код можно запросить повторно.
    await ctx.mailer
      .send({ to: user.email, ...mailTemplates.verifyEmail(user.login, code) })
      .catch((error: unknown) => request.log.error(error, "Письмо с кодом подтверждения не отправлено"));

    reply.code(201);
    return createSession(ctx, user, request);
  });

  // Вход по логину или email.
  app.post("/v1/auth/login", limit(10, "1 minute"), async (request) => {
    const input = parseBody(signInSchema, request.body);
    const invalid = new AppError(401, "invalid_credentials", "Неверный логин или пароль");

    const user = await findUserByIdentifier(ctx, input.identifier);
    if (!user) {
      await verifyDummy(input.password);
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new AppError(
        423,
        "account_locked",
        `Слишком много неудачных попыток входа. Попробуйте через ${minutes} мин. или восстановите пароль.`,
      );
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await ctx.sql`
        UPDATE users SET
          failed_login_count = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED_LOGINS}::int THEN 0
                                    ELSE failed_login_count + 1 END,
          locked_until = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED_LOGINS}::int
                              THEN now() + make_interval(mins => ${LOCK_MINUTES}::int)
                              ELSE locked_until END
        WHERE id = ${user.id}`;
      throw invalid;
    }

    if (user.status === "blocked") throw accountBlocked();

    const [fresh] = await ctx.sql<UserRow[]>`
      UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
      WHERE id = ${user.id}
      RETURNING *`;
    return createSession(ctx, fresh ?? user, request);
  });

  // Обновление токенов. Старый refresh-токен перестаёт действовать.
  app.post("/v1/auth/refresh", limit(30, "1 minute"), async (request) => {
    const { refreshToken } = parseBody(refreshSchema, request.body);
    const tokenHash = hashToken(refreshToken);
    const expired = new AppError(401, "session_revoked", "Сессия завершена, войдите снова");

    const [session] = await ctx.sql<SessionRow[]>`SELECT * FROM sessions WHERE token_hash = ${tokenHash}`;
    if (!session) {
      // Предъявлен уже заменённый токен: возможно, его украли. Закрываем эту сессию.
      await ctx.sql`
        UPDATE sessions SET revoked_at = now()
        WHERE prev_token_hash = ${tokenHash} AND revoked_at IS NULL`;
      throw expired;
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw expired;

    const [user] = await ctx.sql<UserRow[]>`SELECT * FROM users WHERE id = ${session.userId}`;
    if (!user) throw expired;
    if (user.status === "blocked") throw accountBlocked();

    const nextToken = generateRefreshToken();
    const rotated = await ctx.sql`
      UPDATE sessions SET
        prev_token_hash = token_hash,
        token_hash = ${hashToken(nextToken)},
        last_used_at = now(),
        expires_at = now() + make_interval(days => ${ctx.config.REFRESH_TOKEN_TTL_DAYS}::int)
      WHERE id = ${session.id} AND token_hash = ${tokenHash} AND revoked_at IS NULL`;
    if (rotated.count === 0) throw expired;

    return issueTokens(ctx, user, session.id, nextToken);
  });

  // Выход с текущего устройства.
  app.post("/v1/auth/logout", { preHandler: auth }, async (request, reply) => {
    const { sessionId } = authOf(request);
    await ctx.sql`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId}`;
    return reply.code(204).send();
  });

  // Подтверждение email кодом из письма.
  app.post("/v1/auth/verify-email", { preHandler: auth, ...limit(10, "15 minutes") }, async (request) => {
    const { user } = authOf(request);
    if (user.emailVerifiedAt) return toMeDto(user);
    const { code } = parseBody(verifyEmailSchema, request.body);
    await consumeCode(ctx, user.id, "verify_email", code);
    const [updated] = await ctx.sql<UserRow[]>`
      UPDATE users SET email_verified_at = now(), updated_at = now()
      WHERE id = ${user.id}
      RETURNING *`;
    return toMeDto(updated ?? user);
  });

  app.post("/v1/auth/verify-email/resend", { preHandler: auth, ...limit(5, "15 minutes") }, async (request, reply) => {
    const { user } = authOf(request);
    if (user.emailVerifiedAt) {
      throw errors.conflict("already_verified", "Email уже подтверждён");
    }
    const wait = await secondsUntilResend(ctx, user.id, "verify_email");
    if (wait > 0) {
      throw new AppError(429, "resend_too_soon", `Новый код можно запросить через ${wait} сек.`);
    }
    const code = await issueCode(ctx, user.id, "verify_email");
    await ctx.mailer.send({ to: user.email, ...mailTemplates.verifyEmail(user.login, code) });
    return reply.code(204).send();
  });

  // Сброс пароля: шаг 1 — письмо с кодом. Ответ одинаковый, есть такой email или нет,
  // чтобы по нему нельзя было проверить, кто зарегистрирован.
  app.post("/v1/auth/password/forgot", limit(5, "15 minutes"), async (request, reply) => {
    const { email } = parseBody(forgotPasswordSchema, request.body);
    const [user] = await ctx.sql<UserRow[]>`SELECT * FROM users WHERE lower(email) = lower(${email})`;
    if (user && user.status === "active" && (await secondsUntilResend(ctx, user.id, "reset_password")) === 0) {
      const code = await issueCode(ctx, user.id, "reset_password");
      // Ошибку отправки не показываем: ответ должен быть одинаковым для любого email.
      await ctx.mailer
        .send({ to: user.email, ...mailTemplates.resetPassword(user.login, code) })
        .catch((error: unknown) => request.log.error(error, "Письмо для сброса пароля не отправлено"));
    }
    reply.code(202);
    return { message: "Если такой email зарегистрирован, мы отправили на него код." };
  });

  // Сброс пароля: шаг 2 — код и новый пароль. Все устройства выходят из аккаунта.
  app.post("/v1/auth/password/reset", limit(10, "15 minutes"), async (request) => {
    const input = parseBody(resetPasswordSchema, request.body);
    const [user] = await ctx.sql<UserRow[]>`SELECT * FROM users WHERE lower(email) = lower(${input.email})`;
    if (!user || user.status !== "active") {
      throw new AppError(400, "invalid_code", "Неверный код", { code: "Неверный код" });
    }
    await consumeCode(ctx, user.id, "reset_password", input.code);

    const passwordHash = await hashPassword(input.password);
    const [updated] = await ctx.sql<UserRow[]>`
      UPDATE users SET
        password_hash = ${passwordHash},
        failed_login_count = 0,
        locked_until = NULL,
        -- Код пришёл на почту, значит адрес рабочий.
        email_verified_at = COALESCE(email_verified_at, now()),
        updated_at = now()
      WHERE id = ${user.id}
      RETURNING *`;
    await revokeAllSessions(ctx, user.id);
    return createSession(ctx, updated ?? user, request);
  });
}
