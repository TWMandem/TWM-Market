import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PushPollDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { AppError, parseBody } from "../../lib/errors.js";
import { generateRefreshToken, hashToken } from "../../lib/tokens.js";
import { authOf, requireAuth } from "../auth/guard.js";

/** Сколько устройств может быть у игрока: старые вытесняются. */
const MAX_DEVICES = 5;
/** Не показываем уведомления старше суток — после долгого перерыва не засыпаем ими. */
const FRESH = "24 hours";
const POLL_LIMIT = 5;

interface DeviceRow {
  id: string;
  userId: string;
}

/**
 * Фоновые уведомления на Android. Приложение регистрирует устройство и
 * получает отдельный ключ (не токен входа). По нему фоновая задача Android
 * раз в ~15 минут забирает новые непрочитанные уведомления.
 */
export async function pushRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { sql } = ctx;
  const auth = requireAuth(ctx);

  const deviceOf = async (request: FastifyRequest): Promise<DeviceRow> => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Device ") ? header.slice(7).trim() : "";
    if (!token || token.length > 100) throw new AppError(401, "device_unknown", "Устройство не зарегистрировано");
    const [row] = await sql<DeviceRow[]>`
      SELECT d.id, d.user_id FROM push_devices d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ${hashToken(token)} AND u.status = 'active'`;
    if (!row) throw new AppError(401, "device_unknown", "Устройство не зарегистрировано");
    return row;
  };

  app.post(
    "/v1/me/push-devices",
    { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (request, reply): Promise<{ token: string }> => {
      const { user } = authOf(request);
      parseBody(z.object({ platform: z.literal("android") }), request.body);
      const token = generateRefreshToken();
      await sql.begin(async (tx) => {
        await tx`INSERT INTO push_devices (user_id, token_hash, platform) VALUES (${user.id}, ${hashToken(token)}, 'android')`;
        await tx`
          DELETE FROM push_devices WHERE user_id = ${user.id} AND id NOT IN (
            SELECT id FROM push_devices WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT ${MAX_DEVICES})`;
      });
      reply.code(201);
      return { token };
    },
  );

  // Выход на телефоне: ключ устройства больше не действует.
  app.delete("/v1/push/device", async (request, reply) => {
    const device = await deviceOf(request).catch(() => null);
    if (device) await sql`DELETE FROM push_devices WHERE id = ${device.id}`;
    return reply.code(204).send();
  });

  /**
   * Новые непрочитанные уведомления с номером больше after.
   * Без after — только текущая отметка: при первом опросе старое не показываем.
   */
  app.get("/v1/push/poll", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request): Promise<PushPollDto> => {
    const device = await deviceOf(request);
    const { after } = z.object({ after: z.coerce.number().int().min(0).optional() }).parse(request.query);
    await sql`UPDATE push_devices SET last_seen_at = now() WHERE id = ${device.id}`;
    const [last] = await sql<{ max: string | null }[]>`SELECT max(id)::text AS max FROM notifications WHERE user_id = ${device.userId}`;
    const cursor = Number(last?.max ?? 0);
    if (after === undefined) return { items: [], cursor };
    const rows = await sql<{ id: string; title: string; body: string; link: string | null }[]>`
      SELECT id::text, title, body, link FROM notifications
      WHERE user_id = ${device.userId} AND id > ${after}::bigint AND read_at IS NULL
        AND created_at > now() - ${FRESH}::interval
      ORDER BY id DESC LIMIT ${POLL_LIMIT}`;
    return {
      items: rows.reverse().map((r) => ({ id: Number(r.id), title: r.title, body: r.body, link: r.link })),
      cursor: Math.max(cursor, after),
    };
  });
}
