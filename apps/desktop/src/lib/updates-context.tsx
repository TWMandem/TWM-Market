import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NotificationDto } from "@twm/shared";
import { api } from "./api";
import { useAuth } from "./auth-context";
import { androidNotify, syncBackgroundNotifications } from "./background-notify";
import { appInBackground, showSystemNotification } from "./desktop-notify";
import { IS_ANDROID, IS_WEB_APP } from "./platform";
import { syncWebPush } from "./web-push";

const POLL_MS = 8_000;

interface UpdatesState {
  unreadMessages: number;
  unreadNotifications: number;
  /** Растёт, когда пришли новые уведомления: экраны переписки по нему обновляются. */
  version: number;
  /** Последние пришедшие уведомления (для всплывающей подсказки в приложении). */
  latest: NotificationDto[];
  refresh: () => void;
}

const UpdatesContext = createContext<UpdatesState>({
  unreadMessages: 0,
  unreadNotifications: 0,
  version: 0,
  latest: [],
  refresh: () => {},
});

/**
 * Опрос сервера раз в несколько секунд: счётчики непрочитанного и новые
 * уведомления. Если приложение в фоне или в трее — показываем уведомление Windows.
 */
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [version, setVersion] = useState(0);
  const [latest, setLatest] = useState<NotificationDto[]>([]);
  const cursor = useRef<number | undefined>(undefined);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await api.updates(cursor.current);
      setUnreadMessages(result.unreadMessages);
      setUnreadNotifications(result.unreadNotifications);
      cursor.current = result.cursor;
      if (IS_ANDROID) {
        // Android: если приложение свёрнуто, Android-часть покажет уведомления
        // (по нажатию — нужный экран); фоновая проверка их не повторит.
        await androidNotify(result.notifications, result.cursor, true);
      }
      if (result.notifications.length > 0) {
        setVersion((v) => v + 1);
        setLatest(result.notifications);
        // Веб-приложение: уведомления, когда оно закрыто или свёрнуто, присылает
        // сервер (Web Push) — здесь их не дублируем.
        if (!IS_ANDROID && !IS_WEB_APP && (await appInBackground())) {
          const first = result.notifications[0]!;
          const more = result.notifications.length - 1;
          await showSystemNotification(first.title, more > 0 ? `${first.body}\nИ ещё ${more}` : first.body);
        }
      }
    } catch {
      // Нет связи — попробуем при следующем опросе.
    } finally {
      busy.current = false;
    }
  }, []);

  // Android: фоновая проверка уведомлений, пока игрок вошёл в аккаунт.
  useEffect(() => {
    if (status === "authed") void syncBackgroundNotifications(true);
  }, [status]);

  // Веб-приложение: напомнить серверу о подписке на уведомления.
  useEffect(() => {
    if (status === "authed" && user) void syncWebPush(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id]);

  useEffect(() => {
    if (status !== "authed") {
      cursor.current = undefined;
      setUnreadMessages(0);
      setUnreadNotifications(0);
      setLatest([]);
      return;
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, poll]);

  const value = useMemo(
    () => ({ unreadMessages, unreadNotifications, version, latest, refresh: () => void poll() }),
    [unreadMessages, unreadNotifications, version, latest, poll],
  );
  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

export const useUpdates = () => useContext(UpdatesContext);
