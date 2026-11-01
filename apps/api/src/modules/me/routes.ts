import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { changePasswordSchema, type SessionDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { SessionRow } from "../../db/types.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { revokeAllSessions, toMeDto } from "../auth/service.js";

const idParam = z.object({ id: z.string().uuid() });

export async function meRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = requireAuth(ctx);

  app.get("/v1/me", { preHandler: auth }, async (request) => toMeDto(authOf(request).user));

  // Устройства, с которых выполнен вход.
  app.get("/v1/me/sessions", { preHandler: auth }, async (request): Promise<{ items: SessionDto[] }> => {
    const { user, sessionId } = authOf(request);
    const rows = await ctx.sql<SessionRow[]>`
      SELECT * FROM sessions
      WHERE user_id = ${user.id} AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`;
    return {
      items: rows.map((s) => ({
        id: s.id,
        current: s.id === sessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
      })),
    };
  });

  app.delete("/v1/me/sessions/:id", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const parsed = idParam.safeParse(request.params);
    if (!parsed.success) throw errors.notFound("Сессия не найдена");
    const result = await ctx.sql`
      UPDATE sessions SET revoked_at = now()
      WHERE id = ${parsed.data.id} AND user_id = ${user.id} AND revoked_at IS NULL`;
    if (result.count === 0) throw errors.notFound("Сессия не найдена");
    return reply.code(204).send();
  });

  // Выйти на всех устройствах, кроме текущего.
  app.post("/v1/me/sessions/revoke-others", { preHandler: auth }, async (request, reply) => {
    const { user, sessionId } = authOf(request);
    await revokeAllSessions(ctx, user.id, sessionId);
    return reply.code(204).send();
  });

  // Смена пароля. Остальные устройства выходят из аккаунта.
  app.post(
    "/v1/me/password",
    { preHandler: auth, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const { user, sessionId } = authOf(request);
      const input = parseBody(changePasswordSchema, request.body);
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError(400, "invalid_password", "Текущий пароль указан неверно", {
          currentPassword: "Неверный пароль",
        });
      }
      if (input.newPassword.toLowerCase() === user.login.toLowerCase()) {
        throw errors.validation({ newPassword: "Пароль не должен совпадать с логином" });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await ctx.sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${user.id}`;
      await revokeAllSessions(ctx, user.id, sessionId);
      return reply.code(204).send();
    },
  );
}
