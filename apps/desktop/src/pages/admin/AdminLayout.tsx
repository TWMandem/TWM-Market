import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import type { Role } from "@twm/shared";
import { Alert } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useLoad } from "../../lib/use-load";
import { TwoFactorGate } from "./TwoFactorGate";

const LEVEL: Record<Role, number> = { user: 0, moderator: 1, admin: 2, superadmin: 3 };

export function hasRole(role: Role | undefined, min: Role): boolean {
  return role !== undefined && LEVEL[role] >= LEVEL[min];
}

const NAV: Array<{ to: string; label: string; min: Role; group?: string }> = [
  { to: "/admin", label: "Дашборд", min: "moderator" },
  { to: "/admin/users", label: "Пользователи", min: "moderator" },
  { to: "/admin/audit", label: "Журнал действий", min: "admin" },
  { to: "/admin/servers", label: "Серверы", min: "moderator", group: "Справочники" },
  { to: "/admin/structure", label: "Разделы и типы", min: "moderator", group: "Справочники" },
  { to: "/admin/categories", label: "Категории и предметы", min: "moderator", group: "Справочники" },
  { to: "/admin/fields", label: "Конструктор полей", min: "moderator", group: "Справочники" },
];

const ROLE_LABELS: Record<Role, string> = {
  user: "игрок",
  moderator: "модератор",
  admin: "администратор",
  superadmin: "суперадминистратор",
};

/**
 * Каркас админ-панели. Доступ проверяет сервер на каждом запросе;
 * здесь — только понятные экраны: нет прав, нужно включить или ввести 2FA.
 */
export function AdminLayout() {
  const { user } = useAuth();
  const status = useLoad(() => api.twoFactorStatus(), []);

  if (!user || !hasRole(user.role, "moderator")) {
    return (
      <Alert>
        Админ-панель доступна только администрации площадки.
      </Alert>
    );
  }
  if (status.error) return <Alert>{status.error}</Alert>;
  if (!status.data) return <p className="text-muted">Загружаю…</p>;
  if (!status.data.enabled || !status.data.sessionVerified) {
    return <TwoFactorGate status={status.data} onDone={(next) => status.setData(next)} />;
  }

  const items = NAV.filter((item) => hasRole(user.role, item.min));
  const main = items.filter((i) => !i.group);
  const dictionaries = items.filter((i) => i.group === "Справочники");

  return (
    <div className="flex flex-wrap items-start gap-6">
      <aside aria-label="Меню админ-панели" className="flex min-w-0 flex-[1_1_220px] flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-[#111318] p-3.5 lg:max-w-[260px]">
        <div className="flex flex-col gap-0.5 px-2 pt-1">
          <span className="font-display text-[15px] font-bold">Админ-панель</span>
          <span className="text-[13px] text-muted">
            {user.login} · {ROLE_LABELS[user.role]}
          </span>
        </div>
        <NavGroup items={main} />
        <div className="flex flex-col gap-0.5">
          <span className="px-2.5 pb-1.5 text-[11px] font-extrabold tracking-[0.08em] text-faint">СПРАВОЧНИКИ</span>
          <NavGroup items={dictionaries} />
        </div>
      </aside>
      <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
        <Outlet />
      </section>
    </div>
  );
}

function NavGroup({ items }: { items: Array<{ to: string; label: string }> }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/admin"}
          className={({ isActive }) =>
            `flex min-h-10 items-center rounded-[10px] px-2.5 text-sm font-semibold no-underline ${
              isActive ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2"
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Заголовок страницы админ-панели. */
export function AdminTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="m-0 font-display text-[26px] font-bold">{title}</h1>
      {children}
    </div>
  );
}
