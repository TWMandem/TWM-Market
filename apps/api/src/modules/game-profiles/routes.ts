import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_GAME_PROFILES,
  NICKNAME_CHANGE_COOLDOWN_DAYS,
  createGameProfileSchema,
  updateGameProfileSchema,
  type GameProfileDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import { uniqueViolation } from "../../db/client.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { closeOpenVerifications } from "./verification.js";

const idParam = z.object({ id: z.string().uuid() });

interface ProfileRow {
  id: string;
  userId: string;
  nickname: string;
  verifiedAt: Date | null;
  nicknameChangedAt: Date | null;
  createdAt: Date;
  serverNumber: number;
  serverName: string;
  serverColor: string;
  sameNicknameCount: number;
}

const COOLDOWN_MS = NICKNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

function toDto(row: ProfileRow): GameProfileDto {
  const availableAt = row.nicknameChangedAt ? new Date(row.nicknameChangedAt.getTime() + COOLDOWN_MS) : null;
  return {
    id: row.id,
    nickname: row.nickname,
    server: { number: row.serverNumber, name: row.serverName, color: row.serverColor },
    verified: row.verifiedAt !== null,
    sameNicknameCount: row.sameNicknameCount,
    nicknameChangeAvailableAt: availableAt && availableAt.getTime() > Date.now() ? availableAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const duplicate = () =>
  errors.conflict("duplicate_profile", "У вас уже есть такой ник на этом сервере", {
    nickname: "Такой профиль уже добавлен",
  });

export async function gameProfileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = requireAuth(ctx);

  /** Профили пользователя вместе с сервером и счётчиком совпадений ника у других аккаунтов. */
  const loadProfiles = (userId: string, profileId?: string) => ctx.sql<ProfileRow[]>`
    SELECT
      p.id, p.user_id, p.nickname, p.verified_at, p.nickname_changed_at, p.created_at,
      s.number AS server_number, s.name AS server_name, s.color AS server_color,
      (SELECT count(DISTINCT o.user_id)::int FROM game_profiles o
        WHERE o.server_id = p.server_id AND lower(o.nickname) = lower(p.nickname)
          AND o.user_id <> p.user_id) AS same_nickname_count
    FROM game_profiles p
    JOIN servers s ON s.id = p.server_id
    WHERE p.user_id = ${userId} AND p.archived_at IS NULL
      ${profileId ? ctx.sql`AND p.id = ${profileId}` : ctx.sql``}
    ORDER BY p.created_at`;

  app.get("/v1/me/game-profiles", { preHandler: auth }, async (request) => {
    const { user } = authOf(request);
    const rows = await loadProfiles(user.id);
    return { items: rows.map(toDto) };
  });

  app.post("/v1/me/game-profiles", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const input = parseBody(createGameProfileSchema, request.body);

    const [server] = await ctx.sql<{ id: number }[]>`
      SELECT id FROM servers WHERE number = ${input.serverNumber}::smallint AND is_active`;
    if (!server) throw errors.validation({ serverNumber: "Такого сервера нет" });

    const counted = await ctx.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM game_profiles WHERE user_id = ${user.id} AND archived_at IS NULL`;
    if ((counted[0]?.count ?? 0) >= MAX_GAME_PROFILES) {
      throw errors.conflict("profile_limit", `Можно добавить не больше ${MAX_GAME_PROFILES} игровых профилей`);
    }

    // Профиль был удалён раньше (но остался в истории объявлений) — возвращаем его.
    const [archived] = await ctx.sql<{ id: string }[]>`
      UPDATE game_profiles SET archived_at = NULL, updated_at = now()
      WHERE user_id = ${user.id} AND server_id = ${server.id} AND lower(nickname) = lower(${input.nickname})
        AND archived_at IS NOT NULL
      RETURNING id`;
    if (archived) {
      const [restored] = await loadProfiles(user.id, archived.id);
      reply.code(201);
      return toDto(restored!);
    }

    let id: string | undefined;
    try {
      const inserted = await ctx.sql<{ id: string }[]>`
        INSERT INTO game_profiles (user_id, server_id, nickname)
        VALUES (${user.id}, ${server.id}, ${input.nickname})
        RETURNING id`;
      id = inserted[0]?.id;
    } catch (error) {
      if (uniqueViolation(error) === "game_profiles_user_nick_uq") throw duplicate();
      throw error;
    }
    if (!id) throw new Error("Профиль не создан");

    const [row] = await loadProfiles(user.id, id);
    if (!row) throw new Error("Профиль не найден после создания");
    reply.code(201);
    return toDto(row);
  });

  // Смена ника — не чаще раза в NICKNAME_CHANGE_COOLDOWN_DAYS дней; старый ник остаётся в истории.
  app.patch("/v1/me/game-profiles/:id", { preHandler: auth }, async (request) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Профиль не найден");
    const input = parseBody(updateGameProfileSchema, request.body);

    const [current] = await loadProfiles(user.id, params.data.id);
    if (!current) throw errors.notFound("Профиль не найден");
    if (current.nickname === input.nickname) return toDto(current);

    const dto = toDto(current);
    if (dto.nicknameChangeAvailableAt) {
      const date = new Date(dto.nicknameChangeAvailableAt).toLocaleDateString("ru-RU");
      throw new AppError(409, "nickname_cooldown", `Ник можно будет сменить ${date}`, {
        nickname: `Ник меняется не чаще раза в ${NICKNAME_CHANGE_COOLDOWN_DAYS} дней`,
      });
    }

    try {
      await ctx.sql.begin(async (tx) => {
        await tx`
          INSERT INTO game_profile_history (profile_id, old_nickname, new_nickname)
          VALUES (${current.id}, ${current.nickname}, ${input.nickname})`;
        await tx`
          UPDATE game_profiles SET
            nickname = ${input.nickname},
            -- Новый ник не подтверждён, даже если старый был.
            verified_at = NULL,
            nickname_changed_at = now(),
            updated_at = now()
          WHERE id = ${current.id}`;
      });
    } catch (error) {
      if (uniqueViolation(error) === "game_profiles_user_nick_uq") throw duplicate();
      throw error;
    }
    await closeOpenVerifications(ctx.sql, ctx.privateDir, current.id);

    const [row] = await loadProfiles(user.id, current.id);
    if (!row) throw errors.notFound("Профиль не найден");
    return toDto(row);
  });

  app.delete("/v1/me/game-profiles/:id", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Профиль не найден");
    const [profile] = await ctx.sql<{ id: string }[]>`
      SELECT id FROM game_profiles WHERE id = ${params.data.id} AND user_id = ${user.id} AND archived_at IS NULL`;
    if (!profile) throw errors.notFound("Профиль не найден");

    const [used] = await ctx.sql`SELECT 1 FROM listings WHERE game_profile_id = ${profile.id} LIMIT 1`;
    if (used) {
      // Профиль с объявлениями остаётся в истории, но скрывается; его активные объявления снимаются.
      await ctx.sql.begin(async (tx) => {
        await tx`UPDATE game_profiles SET archived_at = now(), updated_at = now() WHERE id = ${profile.id}`;
        await tx`
          UPDATE listings SET status = 'withdrawn', updated_at = now()
          WHERE game_profile_id = ${profile.id} AND status IN ('active', 'moderation')`;
      });
    } else {
      await ctx.sql`DELETE FROM game_profiles WHERE id = ${profile.id}`;
    }
    return reply.code(204).send();
  });
}
