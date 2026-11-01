import { useState } from "react";
import { Link } from "react-router";
import type { Role } from "@twm/shared";
import { Alert, Button } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

export const ROLE_NAMES: Record<Role, string> = {
  user: "Игрок",
  moderator: "Модератор",
  admin: "Администратор",
  superadmin: "Суперадмин",
};

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");

export function UsersPage() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState({ query: "", role: "", status: "", page: 1 });
  const { data, error, loading } = useLoad(() => adminApi.users(applied), [applied]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <AdminTitle title="Пользователи">
        {data && <span className="text-sm text-muted">Найдено: {data.total.toLocaleString("ru-RU")}</span>}
      </AdminTitle>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied((a) => ({ ...a, query: query.trim(), page: 1 }));
        }}
      >
        <div className="flex min-w-[220px] flex-[2_1_240px] flex-col gap-1.5">
          <label htmlFor="user-search" className="text-sm text-muted">
            Логин или email
          </label>
          <input
            id="user-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
          />
        </div>
        <Select
          label="Роль"
          value={applied.role}
          onChange={(role) => setApplied((a) => ({ ...a, role, page: 1 }))}
          options={[
            ["", "Все"],
            ["user", "Игроки"],
            ["staff", "Администрация"],
          ]}
        />
        <Select
          label="Статус"
          value={applied.status}
          onChange={(status) => setApplied((a) => ({ ...a, status, page: 1 }))}
          options={[
            ["", "Все"],
            ["active", "Активные"],
            ["blocked", "Заблокированные"],
          ]}
        />
        <Button type="submit">Найти</Button>
      </form>

      {error && <Alert>{error}</Alert>}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wider text-muted">
              <th className="px-4 py-3 font-bold">ЛОГИН</th>
              <th className="px-4 py-3 font-bold">EMAIL</th>
              <th className="px-4 py-3 font-bold">РОЛЬ</th>
              <th className="px-4 py-3 font-bold">ПРОФИЛИ</th>
              <th className="px-4 py-3 font-bold">РЕГИСТРАЦИЯ</th>
              <th className="px-4 py-3 font-bold">ПОСЛЕДНИЙ ВХОД</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id} className="border-t border-line-soft hover:bg-surface-2">
                <td className="px-4 py-3">
                  <Link to={`/admin/users/${u.id}`} className="font-bold text-ink hover:text-accent">
                    {u.login}
                  </Link>
                  {u.status === "blocked" && (
                    <span className="ml-2 rounded-md bg-[#ff6b6b]/15 px-2 py-0.5 text-xs font-bold text-[#ffb4b4]">
                      заблокирован
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-2">
                  {u.email}
                  {!u.emailVerified && <span className="ml-1 text-xs text-faint">(не подтверждён)</span>}
                </td>
                <td className="px-4 py-3">{ROLE_NAMES[u.role]}</td>
                <td className="px-4 py-3 font-mono">{u.gameProfiles}</td>
                <td className="px-4 py-3 text-ink-2">{date(u.createdAt)}</td>
                <td className="px-4 py-3 text-ink-2">{date(u.lastLoginAt)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Никого не нашли
                </td>
              </tr>
            )}
            {!data && loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Загружаю…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" disabled={applied.page <= 1} onClick={() => setApplied((a) => ({ ...a, page: a.page - 1 }))}>
            ← Назад
          </Button>
          <span className="text-sm text-muted">
            Страница {applied.page} из {pages}
          </span>
          <Button variant="secondary" disabled={applied.page >= pages} onClick={() => setApplied((a) => ({ ...a, page: a.page + 1 }))}>
            Вперёд →
          </Button>
        </div>
      )}
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  const id = `filter-${label}`;
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-line bg-ground px-3 text-ink"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
