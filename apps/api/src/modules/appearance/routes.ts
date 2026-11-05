import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SEASONS, type AdminAppearanceDto, type AppearanceDto, type Season } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Sql } from "../../db/client.js";
import { writeAudit } from "../../lib/audit.js";
import { parseBody } from "../../lib/errors.js";
import { requireStaff } from "../auth/guard.js";

/**
 * Праздничное оформление (например, на Хеллоуин в игре). Его включает и
 * выключает администратор — новый выпуск приложения для этого не нужен:
 * приложения и сайт спрашивают сервер при запуске и раз в полчаса.
 */
interface Row {
  season: string;
  until: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

async function readRow(sql: Sql): Promise<Row> {
  const [row] = await sql<Row[]>`
    SELECT a.season, a.until, a.updated_at, u.login AS updated_by
    FROM app_appearance a LEFT JOIN users u ON u.id = a.updated_by WHERE a.id = 1`;
  return row ?? { season: "none", until: null, updatedAt: new Date(0), updatedBy: null };
}

const isSeason = (value: string): value is Season => (SEASONS as readonly string[]).includes(value);

/** Оформление, которое видно сейчас: с учётом даты, когда оно выключается само. */
export async function currentSeason(sql: Sql): Promise<Season | null> {
  const row = await readRow(sql);
  if (!isSeason(row.season)) return null;
  if (row.until && row.until.getTime() <= Date.now()) return null;
  return row.season;
}

const updateSchema = z.object({
  season: z.enum(SEASONS).nullable(),
  until: z
    .string()
    .datetime({ offset: true, message: "Неверная дата" })
    .nullable()
    .refine((v) => v === null || new Date(v).getTime() > Date.now(), "Дата должна быть в будущем"),
});

export async function appearanceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  app.get("/v1/appearance", async (_request, reply): Promise<AppearanceDto> => {
    reply.header("Cache-Control", "public, max-age=60");
    return { season: await currentSeason(sql) };
  });

  const toDto = (row: Row): AdminAppearanceDto => ({
    season: isSeason(row.season) ? row.season : null,
    until: row.until ? row.until.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  });

  app.get("/v1/admin/appearance", { preHandler: requireStaff(ctx, "admin") }, async (): Promise<AdminAppearanceDto> => toDto(await readRow(sql)));

  app.put("/v1/admin/appearance", { preHandler: requireStaff(ctx, "admin") }, async (request): Promise<AdminAppearanceDto> => {
    const input = parseBody(updateSchema, request.body);
    const season = input.season ?? "none";
    const until = input.season ? input.until : null;
    await sql`
      INSERT INTO app_appearance (id, season, until, updated_at, updated_by)
      VALUES (1, ${season}, ${until}, now(), ${request.auth!.user.id})
      ON CONFLICT (id) DO UPDATE SET season = EXCLUDED.season, until = EXCLUDED.until,
        updated_at = now(), updated_by = EXCLUDED.updated_by`;
    await writeAudit(ctx, request, "appearance.updated", { type: "appearance", id: 1 }, { season, until });
    return toDto(await readRow(sql));
  });
}
