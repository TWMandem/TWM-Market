import type { FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

/**
 * Запись в журнал действий администрации. Журнал нельзя изменить
 * или удалить (это запрещено на уровне базы данных).
 */
export async function writeAudit(
  ctx: AppContext,
  request: FastifyRequest,
  action: string,
  target: { type: string; id: string | number } | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await ctx.sql`
    INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip)
    VALUES (
      ${request.auth?.user.id ?? null},
      ${action},
      ${target?.type ?? null},
      ${target ? String(target.id) : null},
      ${ctx.sql.json(details as never)},
      ${request.ip ?? null}
    )`;
}
