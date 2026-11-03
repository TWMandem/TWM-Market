import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AdminUserDetailDto } from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";
import { UserActivity } from "./UserActivity";
import { ROLE_NAMES } from "./UsersPage";

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function UserDetailPage() {
  const { id = "" } = useParams();
  const { user: me } = useAuth();
  const { data: target, setData, error } = useLoad(() => adminApi.user(id), [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!target || !me) return <p className="text-muted">Загружаю…</p>;

  const isSelf = target.id === me.id;
  const canBlock = !isSelf && hasRole(me.role, "admin") && roleRank(target.role) < roleRank(me.role);
  const canChangeRole = !isSelf && me.role === "superadmin" && target.role !== "superadmin";

  return (
    <>
      <Link to="/admin/users" className="text-sm font-semibold text-muted hover:text-ink">
        ← Все пользователи
      </Link>
      <AdminTitle title={target.login}>
        <span
          className={`rounded-lg px-3 py-1 text-sm font-bold ${
            target.status === "blocked" ? "bg-[#ff6b6b]/15 text-[#ffb4b4]" : "bg-[#4cd48a]/15 text-success"
          }`}
        >
          {target.status === "blocked" ? "Заблокирован" : "Активен"}
        </span>
      </AdminTitle>

      <Card className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-[minmax(0,200px)_1fr] gap-x-6 gap-y-2.5 text-[15px]">
          <dt className="text-muted">Email</dt>
          <dd className="m-0">
            {target.email} {target.emailVerified ? "· подтверждён" : "· не подтверждён"}
          </dd>
          <dt className="text-muted">Роль</dt>
          <dd className="m-0">{ROLE_NAMES[target.role]}</dd>
          <dt className="text-muted">Двухфакторный вход</dt>
          <dd className="m-0">{target.twoFactorEnabled ? "включён" : "выключен"}</dd>
          <dt className="text-muted">Регистрация</dt>
          <dd className="m-0">{dateTime(target.createdAt)}</dd>
          <dt className="text-muted">Последний вход</dt>
          <dd className="m-0">{dateTime(target.lastLoginAt)}</dd>
          <dt className="text-muted">Активных сессий</dt>
          <dd className="m-0 font-mono">{target.activeSessions}</dd>
          {target.status === "blocked" && (
            <>
              <dt className="text-muted">Причина блокировки</dt>
              <dd className="m-0">
                {target.blockedReason} <span className="text-faint">({dateTime(target.blockedAt)})</span>
              </dd>
            </>
          )}
        </dl>
      </Card>

      {(canBlock || canChangeRole) && (
        <Card className="flex flex-col gap-5">
          <h2 className="m-0 text-base font-extrabold">Действия</h2>
          {canBlock && <BlockControl target={target} onChange={setData} />}
          {canChangeRole && <RoleControl target={target} onChange={setData} />}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-extrabold">Игровые профили</h2>
        {target.profiles.length === 0 && <p className="m-0 text-sm text-muted">Профилей нет.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {target.profiles.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: p.server.color }} />
                <span className="font-mono font-bold">{p.nickname}</span>
                <span className="text-sm text-muted">
                  {p.server.number} · {p.server.name}
                </span>
                <span className="ml-auto text-[13px] text-faint">добавлен {dateTime(p.createdAt)}</span>
              </div>
              {p.history.length > 0 && (
                <div className="flex flex-col gap-1 text-[13px] text-muted">
                  <span className="font-bold text-ink-2">История ников:</span>
                  {p.history.map((h) => (
                    <span key={h.changedAt}>
                      {dateTime(h.changedAt)}: <span className="font-mono">{h.oldNickname}</span> →{" "}
                      <span className="font-mono">{h.newNickname}</span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <UserActivity id={target.id} />
    </>
  );
}

const RANK = { user: 0, moderator: 1, admin: 2, superadmin: 3 } as const;
const roleRank = (role: keyof typeof RANK) => RANK[role];

function BlockControl({ target, onChange }: { target: AdminUserDetailDto; onChange: (u: AdminUserDetailDto) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<AdminUserDetailDto>) => {
    setBusy(true);
    let result: AdminUserDetailDto | null = null;
    const message = await attempt(async () => {
      result = await action();
    });
    setBusy(false);
    setError(message);
    if (result) {
      onChange(result);
      setReason("");
    }
  };

  if (target.status === "blocked") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={busy} onClick={() => void run(() => adminApi.unblockUser(target.id))}>
          Разблокировать
        </Button>
        {error && <span className="text-[13px] text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => adminApi.blockUser(target.id, reason));
      }}
    >
      <Field
        label="Причина блокировки (видна в журнале)"
        className="min-w-[260px] flex-1"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? undefined}
        hint="Все сессии пользователя будут закрыты сразу."
      />
      <Button type="submit" variant="danger" loading={busy} className="mt-[26px] h-12">
        Заблокировать
      </Button>
    </form>
  );
}

function RoleControl({ target, onChange }: { target: AdminUserDetailDto; onChange: (u: AdminUserDetailDto) => void }) {
  const [role, setRole] = useState(target.role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    let result: AdminUserDetailDto | null = null;
    const message = await attempt(async () => {
      result = await adminApi.changeRole(target.id, role);
    });
    setBusy(false);
    setError(message);
    if (result) onChange(result);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-5">
      <div className="flex min-w-[200px] flex-col gap-1.5">
        <label htmlFor="role-select" className="text-sm text-muted">
          Роль
        </label>
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className="h-12 rounded-xl border border-line bg-ground px-3 text-ink"
        >
          <option value="user">Игрок</option>
          <option value="moderator">Модератор</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <Button variant="secondary" loading={busy} disabled={role === target.role} onClick={() => void save()} className="h-12">
        Сохранить роль
      </Button>
      <span className="basis-full text-[13px] text-faint">
        После смены роли пользователь выйдет со всех устройств. Новым сотрудникам нужно будет включить двухфакторный вход.
      </span>
      {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
    </div>
  );
}
