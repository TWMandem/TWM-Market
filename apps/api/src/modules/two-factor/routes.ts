import type { FastifyInstance } from "fastify";
import { totpVerifySchema, type TwoFactorSetupDto, type TwoFactorStatusDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUrl, verifyTotp } from "../../lib/totp.js";
import { authOf, requireAuth } from "../auth/guard.js";

const invalidCode = () => new AppError(400, "invalid_code", "Неверный код", { code: "Неверный код" });

/**
 * Двухфакторный вход через приложение-аутентификатор.
 * Для администрации он обязателен: без него админ-панель недоступна.
 */
export async function twoFactorRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = requireAuth(ctx);
  const limited = { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } };

  app.get("/v1/me/2fa", { preHandler: auth }, async (request): Promise<TwoFactorStatusDto> => {
    const { user, sessionMfaVerified } = authOf(request);
    return { enabled: user.totpEnabledAt !== null, sessionVerified: sessionMfaVerified };
  });

  // Шаг 1: новый секрет. Пока код не подтверждён, двухфакторный вход не включён.
  app.post("/v1/me/2fa/setup", { preHandler: auth, ...limited }, async (request): Promise<TwoFactorSetupDto> => {
    const { user } = authOf(request);
    if (user.totpEnabledAt) throw errors.conflict("already_enabled", "Двухфакторный вход уже включён");
    const secret = generateTotpSecret();
    await ctx.sql`
      UPDATE users SET totp_secret_enc = ${encryptSecret(secret, ctx.config.CODE_SECRET)}, totp_last_step = NULL
      WHERE id = ${user.id}`;
    return { secret, otpauthUrl: otpauthUrl(secret, user.login) };
  });

  // Шаг 2: код из приложения подтверждает, что секрет сохранён. Включаем.
  app.post("/v1/me/2fa/enable", { preHandler: auth, ...limited }, async (request): Promise<TwoFactorStatusDto> => {
    const { user, sessionId } = authOf(request);
    if (user.totpEnabledAt) throw errors.conflict("already_enabled", "Двухфакторный вход уже включён");
    if (!user.totpSecretEnc) throw errors.conflict("setup_required", "Сначала получите секрет для приложения");
    const { code } = parseBody(totpVerifySchema, request.body);

    const step = verifyTotp(decryptSecret(user.totpSecretEnc, ctx.config.CODE_SECRET), code, null);
    if (step === null) throw invalidCode();

    await ctx.sql.begin(async (tx) => {
      await tx`UPDATE users SET totp_enabled_at = now(), totp_last_step = ${step}::bigint WHERE id = ${user.id}`;
      await tx`UPDATE sessions SET mfa_verified_at = now() WHERE id = ${sessionId}`;
    });
    await writeAudit(ctx, request, "twofactor.enabled", { type: "user", id: user.id });
    return { enabled: true, sessionVerified: true };
  });

  // Ввод кода в текущей сессии — нужен администрации перед работой в админ-панели.
  app.post("/v1/me/2fa/verify", { preHandler: auth, ...limited }, async (request): Promise<TwoFactorStatusDto> => {
    const { user, sessionId } = authOf(request);
    if (!user.totpEnabledAt || !user.totpSecretEnc) {
      throw errors.conflict("not_enabled", "Двухфакторный вход не включён");
    }
    const { code } = parseBody(totpVerifySchema, request.body);
    const lastStep = user.totpLastStep === null ? null : Number(user.totpLastStep);
    const step = verifyTotp(decryptSecret(user.totpSecretEnc, ctx.config.CODE_SECRET), code, lastStep);
    if (step === null) throw invalidCode();

    // Условие на last_step защищает от одновременного двойного использования кода.
    const updated = await ctx.sql`
      UPDATE users SET totp_last_step = ${step}::bigint
      WHERE id = ${user.id} AND (totp_last_step IS NULL OR totp_last_step < ${step}::bigint)`;
    if (updated.count === 0) throw invalidCode();
    await ctx.sql`UPDATE sessions SET mfa_verified_at = now() WHERE id = ${sessionId}`;
    return { enabled: true, sessionVerified: true };
  });
}
