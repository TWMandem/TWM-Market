import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { NotificationDto } from "@twm/shared";
import { api } from "../lib/api";
import { syncBackgroundNotifications } from "../lib/background-notify";
import { notificationsEnabled, setNotificationsEnabled } from "../lib/desktop-notify";
import { IS_ANDROID, IS_WEB_APP } from "../lib/platform";
import { useUpdates } from "../lib/updates-context";
import { Icon } from "./Icon";
import { WebPushToggle } from "./WebPushToggle";
import { timeAgo } from "./listing";

/** Колокольчик: последние уведомления, переход по щелчку, отметка «прочитано». */
export function NotificationsMenu() {
  const { unreadNotifications, version, refresh } = useUpdates();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [systemOn, setSystemOn] = useState(notificationsEnabled());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api
      .notifications()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [open, version]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = async (n: NotificationDto) => {
    setOpen(false);
    if (!n.read) {
      await api.readNotifications([n.id]).catch(() => {});
      refresh();
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await api.readNotifications().catch(() => {});
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
    refresh();
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={unreadNotifications > 0 ? `Уведомления: ${unreadNotifications} новых` : "Уведомления"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="bell" />
        {unreadNotifications > 0 && <Badge count={unreadNotifications} />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 flex w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-2xl max-md:fixed max-md:inset-x-3 max-md:top-[calc(var(--safe-top,0px)+64px)] max-md:w-auto max-md:max-w-none">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="font-bold">Уведомления</span>
            {unreadNotifications > 0 && (
              <button type="button" onClick={() => void readAll()} className="text-[13px] font-bold text-accent-ink">
                Прочитать все
              </button>
            )}
          </div>
          <ul className="m-0 flex max-h-[420px] list-none flex-col overflow-y-auto p-1.5 max-md:max-h-[55vh]">
            {items === null && <li className="p-3 text-sm text-muted">Загружаю…</li>}
            {items?.length === 0 && <li className="p-3 text-sm text-muted">Уведомлений пока нет</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void go(n)}
                  className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2 ${n.read ? "" : "bg-accent/5"}`}
                >
                  <span className="flex items-baseline gap-2">
                    {!n.read && <span aria-label="Новое" className="size-2 shrink-0 rounded-full bg-accent" />}
                    <span className="truncate text-sm font-bold">{n.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-faint">{timeAgo(n.createdAt)}</span>
                  </span>
                  {n.body && <span className="line-clamp-2 text-[13px] text-muted">{n.body}</span>}
                </button>
              </li>
            ))}
          </ul>
          {IS_WEB_APP ? (
            <div className="border-t border-line-soft px-4 py-3">
              <WebPushToggle compact />
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-2.5 border-t border-line-soft px-4 py-3 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={systemOn}
                onChange={(e) => {
                  setNotificationsEnabled(e.target.checked);
                  setSystemOn(e.target.checked);
                  void syncBackgroundNotifications(true);
                }}
                className="size-4 accent-accent"
              />
              {IS_ANDROID ? "Уведомления на телефоне, даже когда приложение закрыто" : "Всплывающие уведомления Windows, когда приложение свёрнуто"}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function Badge({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-extrabold text-on-accent"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
