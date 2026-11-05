import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

/** Понятные названия действий в журнале. */
const ACTIONS: Record<string, string> = {
  "user.blocked": "Блокировка пользователя",
  "user.unblocked": "Разблокировка пользователя",
  "user.role_changed": "Смена роли",
  "twofactor.enabled": "Включён двухфакторный вход",
  "twofactor.reset_cli": "Сброс 2FA командой на сервере",
  "server.created": "Добавлен сервер",
  "server.updated": "Изменён сервер",
  "section.updated": "Изменён раздел",
  "listing_type.created": "Добавлен тип имущества",
  "listing_type.updated": "Изменён тип имущества",
  "category.created": "Добавлена категория",
  "category.updated": "Изменена категория",
  "category.deleted": "Удалена категория",
  "catalog_item.created": "Добавлен предмет",
  "catalog_item.updated": "Изменён предмет",
  "catalog_item.deleted": "Удалён предмет",
  "attribute.created": "Добавлено поле характеристик",
  "attribute.updated": "Изменено поле характеристик",
  "attribute.deleted": "Удалено поле характеристик",
};

export function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(() => adminApi.audit({ page }), [page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <AdminTitle title="Журнал действий">
        {data && <span className="text-sm text-muted">Записей: {data.total.toLocaleString("ru-RU")}</span>}
      </AdminTitle>
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        Все изменения администрации записываются сюда. Записи нельзя изменить или удалить — это запрещено на уровне базы
        данных.
      </p>
      {error && <Alert>{error}</Alert>}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wider text-muted">
              <th className="px-4 py-3 font-bold">КОГДА</th>
              <th className="px-4 py-3 font-bold">КТО</th>
              <th className="px-4 py-3 font-bold">ДЕЙСТВИЕ</th>
              <th className="px-4 py-3 font-bold">ПОДРОБНОСТИ</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((entry) => (
              <tr key={entry.id} className="border-t border-line-soft align-top">
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                  {new Date(entry.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-4 py-3">
                  {entry.actor ? (
                    <Link to={`/admin/users/${entry.actor.id}`} className="font-bold text-ink hover:text-accent-ink">
                      {entry.actor.login}
                    </Link>
                  ) : (
                    <span className="text-muted">сервер</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {ACTIONS[entry.action] ?? entry.action}
                  {entry.targetType === "user" && entry.targetId && (
                    <>
                      {" · "}
                      <Link to={`/admin/users/${entry.targetId}`} className="text-accent-ink hover:text-accent-soft">
                        профиль
                      </Link>
                    </>
                  )}
                </td>
                <td className="max-w-[360px] px-4 py-3">
                  <code className="block whitespace-pre-wrap break-words font-mono text-xs text-muted">
                    {formatDetails(entry.details)}
                  </code>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  Журнал пуст
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Новее
          </Button>
          <span className="text-sm text-muted">
            Страница {page} из {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Старше →
          </Button>
        </div>
      )}
    </>
  );
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join("\n");
}
