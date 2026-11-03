import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { LISTING_STATUSES, LISTING_STATUS_LABELS, formatPrice } from "@twm/shared";
import { ServerDot } from "../../components/listing";
import { Alert, Button, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Все объявления площадки: поиск по названию, описанию, нику, логину или ID,
 * фильтры и массовые действия (одобрить, отклонить с причиной).
 */
export function AdminListingsPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const page = Number(get("page")) || 1;
  const query = { q: get("q") || undefined, status: get("status") || undefined, login: get("login") || undefined, reported: get("reported") || undefined, page };
  const { data, error, reload } = useLoad(() => adminApi.listings(query), [params.toString()]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(get("q"));
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (action: "approve" | "reject") => {
    setBusy(true);
    let result: { done: number; skipped: number } | null = null;
    const failed = await attempt(async () => {
      result = await adminApi.bulkListings({ ids: [...selected], action, ...(action === "reject" ? { reason: reason.trim() } : {}) });
    });
    setBusy(false);
    if (failed || !result) {
      setMessage({ tone: "error", text: failed ?? "Не удалось" });
      return;
    }
    const r = result as { done: number; skipped: number };
    setMessage({
      tone: "success",
      text: `${action === "approve" ? "Одобрено" : "Отклонено"}: ${r.done}.${r.skipped ? ` Пропущено: ${r.skipped} (не подходит статус).` : ""}`,
    });
    setSelected(new Set());
    setRejecting(false);
    setReason("");
    void reload();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const allOnPage = data?.items.length ? data.items.every((i) => selected.has(i.id)) : false;

  return (
    <>
      <AdminTitle title="Все объявления" />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() || null });
        }}
      >
        <input
          aria-label="Поиск"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название, описание, ник, логин или ID объявления"
          className="h-11 min-w-[280px] flex-1 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
        />
        <select aria-label="Статус" value={get("status")} onChange={(e) => set({ status: e.target.value || null })} className="h-11 rounded-xl border border-line bg-ground px-3 text-ink">
          <option value="">Любой статус</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LISTING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(get("reported"))} onChange={(e) => set({ reported: e.target.checked ? "1" : null })} className="size-4 accent-[var(--color-accent)]" />
          С открытыми жалобами
        </label>
        <Button type="submit" variant="secondary">
          Найти
        </Button>
        {get("login") && (
          <Button variant="ghost" onClick={() => set({ login: null })}>
            Игрок: {get("login")} ✕
          </Button>
        )}
      </form>

      {error && <Alert>{error}</Alert>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {selected.size > 0 && (
        <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-2 py-3">
          <span className="text-sm font-bold">Выбрано: {selected.size}</span>
          {rejecting ? (
            <>
              <input
                autoFocus
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина — её увидят авторы"
                aria-label="Причина отклонения"
                className="h-10 min-w-[240px] flex-1 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
              />
              <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void bulk("reject")}>
                Отклонить выбранные
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <>
              <Button loading={busy} onClick={() => void bulk("approve")} title="Только объявления на проверке">
                Одобрить
              </Button>
              <Button variant="danger" onClick={() => setRejecting(true)}>
                Отклонить…
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Снять выбор
              </Button>
            </>
          )}
        </Card>
      )}

      {data && (
        <Card className="flex flex-col gap-0 p-0">
          <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 text-[13px] text-muted">
            <input
              type="checkbox"
              aria-label="Выбрать все на странице"
              checked={allOnPage}
              onChange={() => setSelected(allOnPage ? new Set() : new Set(data.items.map((i) => i.id)))}
              className="size-4 accent-[var(--color-accent)]"
            />
            Найдено: {data.total.toLocaleString("ru-RU")}
          </div>
          {data.items.length === 0 && <p className="m-0 p-4 text-sm text-muted">Ничего не найдено.</p>}
          <ul className="m-0 list-none p-0">
            {data.items.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
                <input type="checkbox" aria-label={`Выбрать «${l.title}»`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-[var(--color-accent)]" />
                <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
                  <Link to={`/listing/${l.id}`} className="font-bold text-ink hover:text-accent">
                    {l.title}
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-2.5 text-[13px] text-muted">
                    <span className="font-mono text-accent-soft">{l.price !== null ? formatPrice(l.price) : "обмен"}</span>
                    <span className="flex items-center gap-1">
                      <ServerDot color={l.server.color} />
                      {l.server.name}
                    </span>
                    <button type="button" onClick={() => set({ login: l.author.login })} className="hover:text-ink" title="Все объявления игрока">
                      {l.author.login} · {l.author.nickname}
                    </button>
                    {l.author.blocked && <span className="font-bold text-danger">заблокирован</span>}
                    <span>{when(l.createdAt)}</span>
                    <span>{l.views} просм.</span>
                  </span>
                  {l.reason && <span className="text-[13px] text-[#e8d3a6]">{l.reason}</span>}
                </div>
                {l.openReports > 0 && <span className="rounded-md bg-[#ff6b6b]/15 px-2 py-0.5 text-xs font-bold text-[#ffc4c4]">жалоб: {l.openReports}</span>}
                <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">{LISTING_STATUS_LABELS[l.status]}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
            ← Назад
          </Button>
          <span className="text-sm text-muted">
            {page} из {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
            Вперёд →
          </Button>
        </div>
      )}
    </>
  );
}
