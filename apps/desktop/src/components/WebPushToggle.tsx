import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { IS_IOS } from "../lib/platform";
import { disableWebPush, enableWebPush, webPushState, type WebPushState } from "../lib/web-push";

const HINT: Record<WebPushState, string> = {
  unsupported: "Этот браузер не умеет присылать уведомления, когда сайт закрыт.",
  "needs-install": "На iPhone уведомления работают в приложении с экрана «Домой»: в Safari нажмите «Поделиться» → «На экран „Домой“» и откройте TWM Market оттуда.",
  denied: IS_IOS
    ? "Уведомления запрещены. Разрешите их: Настройки iPhone → Уведомления → TWM Market."
    : "Уведомления запрещены в настройках браузера для этого сайта.",
  off: "Новые сообщения, предложения цены и изменения в избранном — даже когда приложение закрыто.",
  on: "Приходят, даже когда приложение закрыто. Настройка этого устройства.",
};

/**
 * Уведомления веб-приложения (iPhone и браузеры). Включаются только кнопкой:
 * iPhone спрашивает разрешение лишь в ответ на нажатие.
 */
export function WebPushToggle({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void webPushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  if (!state || !user) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (state === "on") {
        await disableWebPush();
        setState("off");
      } else {
        setState(await enableWebPush(user.id));
      }
    } catch {
      setError("Не получилось. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const canToggle = state === "on" || state === "off";
  return (
    <div className={`flex flex-col gap-2 ${compact ? "text-[13px]" : "text-[15px]"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={compact ? "font-bold text-ink-2" : ""}>Уведомления на этом устройстве</span>
          <span className="text-[13px] text-muted">{HINT[state]}</span>
        </span>
        {canToggle && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-60 ${
              state === "on" ? "border border-line bg-surface-2 text-ink-2" : "bg-accent text-on-accent"
            }`}
          >
            {busy ? "…" : state === "on" ? "Выключить" : "Включить"}
          </button>
        )}
      </div>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}
