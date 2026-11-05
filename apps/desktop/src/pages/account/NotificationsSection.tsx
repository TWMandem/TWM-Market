import { useState } from "react";
import { Alert, Card } from "../../components/ui";
import { WebPushToggle } from "../../components/WebPushToggle";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { syncBackgroundNotifications } from "../../lib/background-notify";
import { notificationsEnabled, setNotificationsEnabled } from "../../lib/desktop-notify";
import { IS_ANDROID, IS_WEB_APP } from "../../lib/platform";
import { attempt } from "../../lib/use-load";

/** Что присылать: изменения в избранном (на сервере) и уведомления этого устройства (Windows, Android или веб-приложение). */
export function NotificationsSection() {
  const { user, setUser } = useAuth();
  const [system, setSystem] = useState(notificationsEnabled());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const toggleFavorites = async () => {
    setBusy(true);
    setError(await attempt(async () => setUser(await api.updateSettings({ notifyFavorites: !user.notifyFavorites }))));
    setBusy(false);
  };

  return (
    <Card id="notifications" className="flex scroll-mt-24 flex-col gap-3">
      <h2 className="m-0 text-[17px] font-extrabold">Уведомления</h2>
      <label className="flex items-start gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={user.notifyFavorites}
          disabled={busy}
          onChange={() => void toggleFavorites()}
          className="mt-1 size-4 accent-[var(--color-accent)]"
        />
        <span className="flex flex-col gap-0.5">
          Изменения в избранном
          <span className="text-[13px] text-muted">
            Объявление подешевело (у скупки — выросла цена), его продали, сняли или снова опубликовали.
          </span>
        </span>
      </label>
      {IS_WEB_APP ? (
        <WebPushToggle />
      ) : (
        <label className="flex items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={system}
            onChange={(e) => {
              setNotificationsEnabled(e.target.checked);
              setSystem(e.target.checked);
              void syncBackgroundNotifications(true);
            }}
            className="mt-1 size-4 accent-[var(--color-accent)]"
          />
          <span className="flex flex-col gap-0.5">
            {IS_ANDROID ? "Уведомления на телефоне" : "Всплывающие уведомления Windows"}
            <span className="text-[13px] text-muted">
              {IS_ANDROID
                ? "И когда приложение закрыто: телефон проверяет новые сообщения примерно раз в 15 минут. Настройка этого телефона."
                : "Когда приложение свёрнуто или в трее. Настройка этого компьютера."}
            </span>
          </span>
        </label>
      )}
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}
