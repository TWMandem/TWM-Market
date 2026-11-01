import type { FastifyInstance } from "fastify";
import type { ServerDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { ServerRow } from "../../db/types.js";

export function toServerDto(row: ServerRow): ServerDto {
  return {
    number: row.number,
    name: row.name,
    color: row.color,
    isActive: row.isActive,
    transferOpen: row.transferOpen,
  };
}

export async function serverRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Активные игровые серверы. Список меняется в админ-панели (шаг 3).
  app.get("/v1/servers", async (): Promise<{ items: ServerDto[] }> => {
    const rows = await ctx.sql<ServerRow[]>`
      SELECT * FROM servers WHERE is_active ORDER BY sort_order, number`;
    return { items: rows.map(toServerDto) };
  });
}
