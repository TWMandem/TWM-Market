import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import {
  SAVED_SEARCH_LIMIT,
  savedSearchSchema,
  savedSearchUpdateSchema,
  type SavedSearchDto,
  type SavedSearchSection,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Sql } from "../../db/client.js";
import { errors, parseBody } from "../../lib/errors.js";
import { notify } from "../../lib/notify.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { countNewMatches, listingMatches, validSearchParams } from "../listings/search.js";

interface SavedSearchRow {
  id: string;
  userId: string;
  name: string;
  section: SavedSearchSection;
  params: string;
  notify: boolean;
  createdAt: Date;
  lastSeenAt: Date;
}

/** Не чаще одного уведомления по одной подписке за это время: остальные видны счётчиком «новых». */
const NOTIFY_PAUSE = "10 minutes";

const idParam = z.object({ id: z.string().uuid() });

/**
 * Новое объявление опубликовано: уведомляем владельцев подходящих подписок.
 * Вызывается без ожидания, чтобы публикация не тормозила.
 */
export async function notifySavedSearches(sql: Sql, listingId: string): Promise<number> {
  const [listing] = await sql<{ userId: string; title: string; sectionCode: string }[]>`
    SELECT l.user_id, l.title, s.code AS section_code
    FROM listings l JOIN listing_types t ON t.id = l.listing_type_id JOIN sections s ON s.id = t.section_id
    WHERE l.id = ${listingId} AND l.status = 'active'`;
  if (!listing) return 0;

  const subscriptions = await sql<{ id: string; userId: string; name: string; params: string }[]>`
    SELECT ss.id, ss.user_id, ss.name, ss.params
    FROM saved_searches ss JOIN users u ON u.id = ss.user_id
    WHERE ss.notify AND u.status = 'active' AND ss.user_id <> ${listing.userId}
      AND (ss.section = ${listing.sectionCode} OR ss.section = 'search')
      AND (ss.last_notified_at IS NULL OR ss.last_notified_at < now() - ${NOTIFY_PAUSE}::interval)
    ORDER BY ss.created_at
    LIMIT 5000`;

  let sent = 0;
  const notified = new Set<string>();
  for (const sub of subscriptions) {
    // Одному игроку — одно уведомление о каждом объявлении, даже если подошло несколько подписок.
    if (notified.has(sub.userId)) continue;
    if (!(await listingMatches(sql, listingId, sub.params))) continue;
    notified.add(sub.userId);
    await sql`UPDATE saved_searches SET last_notified_at = now() WHERE id = ${sub.id}`;
    await notify(sql, sub.userId, "saved_search", `Новое по подписке «${sub.name}»`, listing.title, `/listing/${listingId}`);
    sent += 1;
  }
  return sent;
}

/** Запуск рассылки «в фоне» с записью ошибки в журнал. */
export function notifySavedSearchesLater(ctx: AppContext, listingId: string, log: FastifyBaseLogger): void {
  setImmediate(() => {
    notifySavedSearches(ctx.sql, listingId).catch((error: unknown) => log.error(error, "Подписки на поиск: ошибка рассылки"));
  });
}

export async function savedSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);

  const toDto = async (row: SavedSearchRow): Promise<SavedSearchDto> => ({
    id: row.id,
    name: row.name,
    section: row.section,
    params: row.params,
    notify: row.notify,
    createdAt: row.createdAt.toISOString(),
    newCount: await countNewMatches(sql, row.params, row.lastSeenAt),
  });

  const own = async (userId: string, rawId: unknown): Promise<SavedSearchRow> => {
    const params = idParam.safeParse(rawId);
    if (!params.success) throw errors.notFound("Подписка не найдена");
    const [row] = await sql<SavedSearchRow[]>`
      SELECT * FROM saved_searches WHERE id = ${params.data.id} AND user_id = ${userId}`;
    if (!row) throw errors.notFound("Подписка не найдена");
    return row;
  };

  app.get("/v1/me/saved-searches", { preHandler: auth }, async (request): Promise<{ items: SavedSearchDto[] }> => {
    const { user } = authOf(request);
    const rows = await sql<SavedSearchRow[]>`
      SELECT * FROM saved_searches WHERE user_id = ${user.id} ORDER BY created_at DESC`;
    return { items: await Promise.all(rows.map(toDto)) };
  });

  app.post("/v1/me/saved-searches", { preHandler: auth }, async (request, reply): Promise<SavedSearchDto> => {
    const { user } = authOf(request);
    const input = parseBody(savedSearchSchema, request.body);
    if (!validSearchParams(input.params)) throw errors.validation({ params: "Не удалось сохранить фильтр — обновите страницу" });

    const [count] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM saved_searches WHERE user_id = ${user.id}`;
    if ((count?.count ?? 0) >= SAVED_SEARCH_LIMIT) {
      throw errors.conflict("too_many_saved_searches", `Можно сохранить не больше ${SAVED_SEARCH_LIMIT} подписок. Удалите ненужные.`);
    }
    const [same] = await sql`
      SELECT 1 FROM saved_searches WHERE user_id = ${user.id} AND section = ${input.section} AND params = ${input.params}`;
    if (same) throw errors.conflict("saved_search_exists", "Такой поиск уже сохранён");

    const [row] = await sql<SavedSearchRow[]>`
      INSERT INTO saved_searches (user_id, name, section, params, notify)
      VALUES (${user.id}, ${input.name}, ${input.section}, ${input.params}, ${input.notify})
      RETURNING *`;
    reply.code(201);
    return toDto(row!);
  });

  app.patch("/v1/me/saved-searches/:id", { preHandler: auth }, async (request): Promise<SavedSearchDto> => {
    const { user } = authOf(request);
    const row = await own(user.id, request.params);
    const input = parseBody(savedSearchUpdateSchema, request.body);
    const [updated] = await sql<SavedSearchRow[]>`
      UPDATE saved_searches SET
        name = ${input.name ?? row.name},
        notify = ${input.notify ?? row.notify}
      WHERE id = ${row.id}
      RETURNING *`;
    return toDto(updated!);
  });

  // Игрок открыл подписку: новые объявления просмотрены.
  app.post("/v1/me/saved-searches/:id/seen", { preHandler: auth }, async (request): Promise<SavedSearchDto> => {
    const { user } = authOf(request);
    const row = await own(user.id, request.params);
    const [updated] = await sql<SavedSearchRow[]>`
      UPDATE saved_searches SET last_seen_at = now() WHERE id = ${row.id} RETURNING *`;
    return toDto(updated!);
  });

  app.delete("/v1/me/saved-searches/:id", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const row = await own(user.id, request.params);
    await sql`DELETE FROM saved_searches WHERE id = ${row.id}`;
    return reply.code(204).send();
  });
}
