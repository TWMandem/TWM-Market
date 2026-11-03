import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  blockUserSchema,
  changeRoleSchema,
  type AdminUserDetailDto,
  type AdminUserListItemDto,
  type Paged,
  type Role,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Fragment } from "../../db/client.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { ROLE_LEVEL, authOf, requireStaff } from "../auth/guard.js";
import { revokeAllSessions } from "../auth/service.js";

const listQuery = z.object({
  query: z.string().trim().max(100).optional(),
  role: z.enum(["user", "moderator", "admin", "superadmin", "staff"]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

const idParam = z.object({ id: z.string().uuid() });

interface UserListRow {
  id: string;
  login: string;
  email: string;
  role: Role;
  status: "active" | "blocked";
  emailVerifiedAt: Date | null;
  totpEnabledAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  gameProfiles: number;
}

function toListItem(row: UserListRow): AdminUserListItemDto {
  return {
    id: row.id,
    login: row.login,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    twoFactorEnabled: row.totpEnabledAt !== null,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    gameProfiles: row.gameProfiles,
  };
}

/** Экранирует %, _ и \ для поиска через ILIKE. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function adminUserRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  // ── Список пользователей ──────────────────────────────────────────────────
  app.get("/v1/admin/users", { preHandler: requireStaff(ctx) }, async (request): Promise<Paged<AdminUserListItemDto>> => {
    const q = listQuery.parse(request.query);
    // Фрагменты запроса одноразовые, поэтому условие собирается заново для каждого запроса.
    const where = () => {
      const conditions: Fragment[] = [];
      if (q.query) conditions.push(sql`(u.login ILIKE ${likePattern(q.query)} OR u.email ILIKE ${likePattern(q.query)})`);
      if (q.role === "staff") conditions.push(sql`u.role <> 'user'`);
      else if (q.role) conditions.push(sql`u.role = ${q.role}`);
      if (q.status) conditions.push(sql`u.status = ${q.status}`);
      return conditions.reduce((acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`), sql``);
    };

    const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM users u ${where()}`;
    const rows = await sql<UserListRow[]>`
      SELECT u.id, u.login, u.email, u.role, u.status, u.email_verified_at, u.totp_enabled_at,
             u.created_at, u.last_login_at,
             (SELECT count(*)::int FROM game_profiles p WHERE p.user_id = u.id) AS game_profiles
      FROM users u
      ${where()}
      ORDER BY u.created_at DESC
      LIMIT ${q.pageSize}::int OFFSET ${(q.page - 1) * q.pageSize}::int`;

    return { items: rows.map(toListItem), total: count?.total ?? 0, page: q.page, pageSize: q.pageSize };
  });

  // ── Карточка пользователя ─────────────────────────────────────────────────
  app.get("/v1/admin/users/:id", { preHandler: requireStaff(ctx) }, async (request): Promise<AdminUserDetailDto> => {
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Пользователь не найден");
    return loadDetail(params.data.id);
  });

  async function loadDetail(id: string): Promise<AdminUserDetailDto> {
    const [row] = await sql<(UserListRow & { blockedReason: string | null; blockedAt: Date | null; activeSessions: number })[]>`
      SELECT u.id, u.login, u.email, u.role, u.status, u.email_verified_at, u.totp_enabled_at,
             u.created_at, u.last_login_at, u.blocked_reason, u.blocked_at,
             (SELECT count(*)::int FROM game_profiles p WHERE p.user_id = u.id) AS game_profiles,
             (SELECT count(*)::int FROM sessions s
               WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
      FROM users u WHERE u.id = ${id}`;
    if (!row) throw errors.notFound("Пользователь не найден");

    const profiles = await sql<
      { id: string; nickname: string; createdAt: Date; serverNumber: number; serverName: string; serverColor: string }[]
    >`
      SELECT p.id, p.nickname, p.created_at, s.number AS server_number, s.name AS server_name, s.color AS server_color
      FROM game_profiles p JOIN servers s ON s.id = p.server_id
      WHERE p.user_id = ${id}
      ORDER BY p.created_at`;
    const history = profiles.length
      ? await sql<{ profileId: string; oldNickname: string; newNickname: string; changedAt: Date }[]>`
          SELECT profile_id, old_nickname, new_nickname, changed_at FROM game_profile_history
          WHERE profile_id IN ${sql(profiles.map((p) => p.id))}
          ORDER BY changed_at DESC`
      : [];

    return {
      ...toListItem(row),
      blockedReason: row.blockedReason,
      blockedAt: row.blockedAt?.toISOString() ?? null,
      activeSessions: row.activeSessions,
      profiles: profiles.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        server: { number: p.serverNumber, name: p.serverName, color: p.serverColor },
        createdAt: p.createdAt.toISOString(),
        history: history
          .filter((h) => h.profileId === p.id)
          .map((h) => ({ oldNickname: h.oldNickname, newNickname: h.newNickname, changedAt: h.changedAt.toISOString() })),
      })),
    };
  }

  /** Нельзя действовать над собой и над тем, чья роль не ниже твоей. */
  async function targetFor(actorId: string, actorRole: Role, id: string) {
    if (id === actorId) throw errors.forbidden("Это действие нельзя применить к своему аккаунту");
    const [target] = await sql<{ id: string; login: string; role: Role; status: string }[]>`
      SELECT id, login, role, status FROM users WHERE id = ${id}`;
    if (!target) throw errors.notFound("Пользователь не найден");
    if (ROLE_LEVEL[target.role] >= ROLE_LEVEL[actorRole]) {
      throw errors.forbidden("Нельзя изменять пользователя с такой же или более высокой ролью");
    }
    return target;
  }

  // ── Блокировка ────────────────────────────────────────────────────────────
  app.post("/v1/admin/users/:id/block", { preHandler: requireStaff(ctx, "admin") }, async (request) => {
    const { user: actor } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Пользователь не найден");
    const { reason } = parseBody(blockUserSchema, request.body);
    const target = await targetFor(actor.id, actor.role, params.data.id);
    if (target.status === "blocked") throw errors.conflict("already_blocked", "Пользователь уже заблокирован");

    await sql`
      UPDATE users SET status = 'blocked', blocked_reason = ${reason}, blocked_at = now(), updated_at = now()
      WHERE id = ${target.id}`;
    await revokeAllSessions(ctx, target.id);
    await writeAudit(ctx, request, "user.blocked", { type: "user", id: target.id }, { login: target.login, reason });
    return loadDetail(target.id);
  });

  app.post("/v1/admin/users/:id/unblock", { preHandler: requireStaff(ctx, "admin") }, async (request) => {
    const { user: actor } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Пользователь не найден");
    const target = await targetFor(actor.id, actor.role, params.data.id);
    if (target.status !== "blocked") throw errors.conflict("not_blocked", "Пользователь не заблокирован");

    await sql`
      UPDATE users SET status = 'active', blocked_reason = NULL, blocked_at = NULL, updated_at = now()
      WHERE id = ${target.id}`;
    await writeAudit(ctx, request, "user.unblocked", { type: "user", id: target.id }, { login: target.login });
    return loadDetail(target.id);
  });

  // ── Роли (только суперадминистратор) ──────────────────────────────────────
  app.post("/v1/admin/users/:id/role", { preHandler: requireStaff(ctx, "superadmin") }, async (request) => {
    const { user: actor } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Пользователь не найден");
    const { role } = parseBody(changeRoleSchema, request.body);
    const target = await targetFor(actor.id, actor.role, params.data.id);
    if (target.role === role) return loadDetail(target.id);
    if (target.status === "blocked" && role !== "user") {
      throw new AppError(409, "user_blocked", "Заблокированному пользователю нельзя выдать роль");
    }

    await sql`UPDATE users SET role = ${role}, updated_at = now() WHERE id = ${target.id}`;
    // Новая роль вступает в силу с чистого листа: старые сессии закрываются.
    await revokeAllSessions(ctx, target.id);
    await writeAudit(ctx, request, "user.role_changed", { type: "user", id: target.id }, {
      login: target.login,
      from: target.role,
      to: role,
    });
    return loadDetail(target.id);
  });
}
