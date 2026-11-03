import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { rejectVerificationSchema, type NicknameVerificationDto, type VerificationQueueItemDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Sql } from "../../db/client.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { readPrivate, removeMedia, saveVerificationImage } from "../../lib/media.js";
import { notify } from "../../lib/notify.js";
import { authOf, requireAuth, requireStaff } from "../auth/guard.js";

/**
 * Подтверждение ника в игре. Игрок присылает скриншот статистики персонажа,
 * на котором виден только ник (остальное замазано), по возможности —
 * с одноразовым кодом в игровом чате. Модератор сверяет и подтверждает.
 * Скриншот хранится в закрытой папке и удаляется после решения.
 */

const idParam = z.object({ id: z.string().uuid() });
// Без похожих символов (0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `TWM-${code}`;
}

interface VerificationRow {
  id: string;
  gameProfileId: string;
  userId: string;
  nickname: string;
  code: string;
  status: "draft" | "pending" | "approved" | "rejected";
  imagePath: string | null;
  rejectReason: string | null;
  submittedAt: Date | null;
}

/** Ник сменили — открытая заявка закрывается (вызывается при смене ника). */
export async function closeOpenVerifications(sql: Sql, privateDir: string, profileId: string): Promise<void> {
  const closed = await sql<{ imagePath: string | null }[]>`
    UPDATE nickname_verifications SET status = 'rejected', reject_reason = 'Ник изменён — пришлите новый скриншот', decided_at = now()
    WHERE game_profile_id = ${profileId} AND status IN ('draft', 'pending')
    RETURNING image_path`;
  await removeMedia(privateDir, closed.map((c) => c.imagePath));
}

export async function verificationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);
  const moderator = { preHandler: requireStaff(ctx, "moderator") };

  const ownProfile = async (request: FastifyRequest) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Профиль не найден");
    const [profile] = await sql<{ id: string; nickname: string; verifiedAt: Date | null }[]>`
      SELECT id, nickname, verified_at FROM game_profiles
      WHERE id = ${params.data.id} AND user_id = ${user.id} AND archived_at IS NULL`;
    if (!profile) throw errors.notFound("Профиль не найден");
    return { user, profile };
  };

  /** Открытая заявка или новая с кодом. */
  const openVerification = async (userId: string, profile: { id: string; nickname: string }): Promise<VerificationRow> => {
    const [open] = await sql<VerificationRow[]>`
      SELECT * FROM nickname_verifications WHERE game_profile_id = ${profile.id} AND status IN ('draft', 'pending')`;
    if (open) return open;
    const [created] = await sql<VerificationRow[]>`
      INSERT INTO nickname_verifications (game_profile_id, user_id, nickname, code)
      VALUES (${profile.id}, ${userId}, ${profile.nickname}, ${newCode()})
      ON CONFLICT DO NOTHING
      RETURNING *`;
    if (created) return created;
    const [again] = await sql<VerificationRow[]>`
      SELECT * FROM nickname_verifications WHERE game_profile_id = ${profile.id} AND status IN ('draft', 'pending')`;
    return again!;
  };

  const toDto = async (row: VerificationRow): Promise<NicknameVerificationDto> => {
    // Причина прошлого отказа видна, пока игрок не прислал новый скриншот.
    const [last] =
      row.status === "draft"
        ? await sql<{ rejectReason: string | null }[]>`
            SELECT reject_reason FROM nickname_verifications
            WHERE game_profile_id = ${row.gameProfileId} AND status = 'rejected'
            ORDER BY decided_at DESC NULLS LAST LIMIT 1`
        : [];
    return {
      status: row.status,
      code: row.code,
      rejectReason: last?.rejectReason ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
    };
  };

  app.get("/v1/me/game-profiles/:id/verification", { preHandler: auth }, async (request): Promise<NicknameVerificationDto> => {
    const { user, profile } = await ownProfile(request);
    if (profile.verifiedAt) return { status: "verified", code: null, rejectReason: null, submittedAt: null };
    return toDto(await openVerification(user.id, profile));
  });

  app.post(
    "/v1/me/game-profiles/:id/verification",
    { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request): Promise<NicknameVerificationDto> => {
      const { user, profile } = await ownProfile(request);
      if (profile.verifiedAt) throw errors.conflict("already_verified", "Ник уже подтверждён");
      const open = await openVerification(user.id, profile);
      const file = await request.file();
      if (!file) throw new AppError(400, "file_required", "Прикрепите скриншот");
      const path = await saveVerificationImage(ctx.privateDir, await file.toBuffer());
      const [updated] = await sql<VerificationRow[]>`
        UPDATE nickname_verifications SET status = 'pending', image_path = ${path}, submitted_at = now()
        WHERE id = ${open.id}
        RETURNING *`;
      await removeMedia(ctx.privateDir, [open.imagePath]);
      return toDto(updated!);
    },
  );

  // ── Очередь модератора ────────────────────────────────────────────────────

  app.get("/v1/admin/verifications", moderator, async (): Promise<{ items: VerificationQueueItemDto[] }> => {
    const rows = await sql<
      {
        id: string;
        nickname: string;
        code: string;
        submittedAt: Date;
        login: string;
        memberSince: Date;
        serverNumber: number;
        serverName: string;
        serverColor: string;
        sameNick: number;
      }[]
    >`
      SELECT v.id, v.nickname, v.code, v.submitted_at, u.login, u.created_at AS member_since,
        s.number AS server_number, s.name AS server_name, s.color AS server_color,
        (SELECT count(DISTINCT o.user_id)::int FROM game_profiles o
          WHERE o.server_id = p.server_id AND lower(o.nickname) = lower(p.nickname) AND o.user_id <> p.user_id) AS same_nick
      FROM nickname_verifications v
      JOIN game_profiles p ON p.id = v.game_profile_id
      JOIN users u ON u.id = v.user_id
      JOIN servers s ON s.id = p.server_id
      WHERE v.status = 'pending'
      ORDER BY v.submitted_at
      LIMIT 100`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        code: r.code,
        submittedAt: r.submittedAt.toISOString(),
        user: { login: r.login, memberSince: r.memberSince.toISOString() },
        server: { number: r.serverNumber, name: r.serverName, color: r.serverColor },
        sameNicknameCount: r.sameNick,
      })),
    };
  });

  const pending = async (request: FastifyRequest) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Заявка не найдена");
    const [row] = await sql<VerificationRow[]>`
      SELECT * FROM nickname_verifications WHERE id = ${params.data.id} AND status = 'pending'`;
    if (!row) throw errors.notFound("Заявка не найдена или уже рассмотрена");
    return row;
  };

  // Скриншот отдаётся только модератору и не кэшируется.
  app.get("/v1/admin/verifications/:id/image", moderator, async (request, reply) => {
    const row = await pending(request);
    if (!row.imagePath) throw errors.notFound("Скриншота нет");
    const data = await readPrivate(ctx.privateDir, row.imagePath);
    return reply.header("Cache-Control", "no-store").type("image/webp").send(data);
  });

  app.post("/v1/admin/verifications/:id/approve", moderator, async (request) => {
    const row = await pending(request);
    const [profile] = await sql<{ nickname: string }[]>`
      SELECT nickname FROM game_profiles WHERE id = ${row.gameProfileId} AND archived_at IS NULL`;
    if (!profile || profile.nickname !== row.nickname) {
      throw errors.conflict("nickname_changed", "Игрок сменил ник после заявки — подтвердить нельзя");
    }
    await sql.begin(async (tx) => {
      await tx`UPDATE game_profiles SET verified_at = now(), verified_by = ${request.auth!.user.id} WHERE id = ${row.gameProfileId}`;
      await tx`
        UPDATE nickname_verifications SET status = 'approved', image_path = NULL, decided_by = ${request.auth!.user.id}, decided_at = now()
        WHERE id = ${row.id}`;
    });
    await removeMedia(ctx.privateDir, [row.imagePath]);
    await writeAudit(ctx, request, "nickname.verified", { type: "game_profile", id: row.gameProfileId }, { nickname: row.nickname });
    await notify(sql, row.userId, "nickname_verified", "Ник подтверждён", `Ник ${row.nickname} подтверждён модератором.`, "/account");
    return { ok: true };
  });

  app.post("/v1/admin/verifications/:id/reject", moderator, async (request) => {
    const row = await pending(request);
    const { reason } = parseBody(rejectVerificationSchema, request.body);
    await sql`
      UPDATE nickname_verifications SET status = 'rejected', reject_reason = ${reason}, image_path = NULL,
        decided_by = ${request.auth!.user.id}, decided_at = now()
      WHERE id = ${row.id}`;
    await removeMedia(ctx.privateDir, [row.imagePath]);
    await writeAudit(ctx, request, "nickname.rejected", { type: "game_profile", id: row.gameProfileId }, { nickname: row.nickname, reason });
    await notify(sql, row.userId, "nickname_rejected", "Ник не подтверждён", `${row.nickname}: ${reason}`, "/account");
    return { ok: true };
  });
}
