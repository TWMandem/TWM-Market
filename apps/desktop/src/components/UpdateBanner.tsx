import { useEffect, useRef, useState } from "react";
import { useAppUpdate } from "../lib/app-update";
import { IS_ANDROID, IS_WEB_APP } from "../lib/platform";
import { Modal } from "./ReportDialog";
import { Button } from "./ui";

/**
 * Обновление приложения: окно «Доступна новая версия» открывается само,
 * когда проверка при запуске нашла обновление (один раз за запуск),
 * а полоса под шапкой показывает ход загрузки и установки.
 */
export function UpdateBanner() {
  const { available, status, progress, error, dismissed, dismiss, install, version, downloadInBrowser } = useAppUpdate();
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string | null>(null);
  const working = status === "downloading" || status === "ready" || status === "installing" || status === "permission";

  // Нашлась новая версия — показать окно сразу, без поиска кнопки.
  useEffect(() => {
    if (available && status === "available" && shownFor.current !== available.version) {
      shownFor.current = available.version;
      setOpen(true);
    }
  }, [available, status]);

  if (!available || (dismissed && !working && status !== "error")) return null;

  const percent = progress !== null ? ` — ${Math.round(progress * 100)}%` : "…";
  const line =
    status === "downloading"
      ? `Скачиваю версию ${available.version}${percent}`
      : status === "ready"
        ? "Обновление скачано — открываю установку…"
        : status === "permission"
          ? "Разрешите установку приложений для TWM Market в открывшихся настройках и вернитесь — установка продолжится."
          : status === "installing"
            ? IS_ANDROID
              ? "Нажмите «Установить» в окне Android. Если окно закрылось — нажмите «Установить» здесь."
              : "Устанавливаю обновление — приложение перезапустится…"
            : `Доступна новая версия ${available.version}.`;

  return (
    <>
      <div className="border-b border-warn-line bg-warn-bg">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 py-2.5 text-sm text-warn-ink md:px-6">
          <span>{line}</span>
          {status === "downloading" && progress !== null && (
            <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-warn-line md:w-40">
              <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
          {!working && (
            <>
              <button type="button" onClick={() => setOpen(true)} className="font-bold text-accent-ink hover:text-accent-soft">
                {status === "error" ? "Попробовать ещё раз →" : "Что нового и обновить →"}
              </button>
              <button type="button" onClick={dismiss} className="ml-auto text-muted hover:text-ink">
                Позже
              </button>
            </>
          )}
          {IS_ANDROID && (status === "installing" || status === "permission") && (
            <button type="button" onClick={() => void install()} className="font-bold text-accent-ink hover:text-accent-soft">
              Установить
            </button>
          )}
          {status === "error" && error && (
            <span className="w-full text-danger">
              Не удалось обновить: {error}
              {downloadInBrowser && (
                <>
                  {" "}
                  <button type="button" onClick={() => void downloadInBrowser()} className="font-bold text-accent-ink underline-offset-2 hover:underline">
                    Скачать через браузер
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      </div>
      {open && (
        <Modal title={`Доступна версия ${available.version}`} onClose={() => setOpen(false)}>
          <p className="m-0 text-sm text-muted">
            Сейчас установлена {version ?? "—"}
            {available.date ? `, новая вышла ${new Date(available.date).toLocaleDateString("ru-RU")}` : ""}.
          </p>
          {available.notes ? (
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-line rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink-2">
              {available.notes}
            </div>
          ) : (
            <p className="m-0 text-sm text-ink-2">Исправления и улучшения.</p>
          )}
          <p className="m-0 text-[13px] text-faint">
            {IS_ANDROID
              ? "Обновление скачается прямо в приложение, затем Android попросит подтвердить установку. Вход и настройки сохранятся."
              : "Обновление скачивается с GitHub, его подпись проверяется перед установкой. Приложение закроется на несколько секунд и откроется снова."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Позже
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                void install();
              }}
            >
              Обновить сейчас
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Версия и ручная проверка обновлений — в подвале. */
export function VersionInfo() {
  const { version, status, checkNow, available } = useAppUpdate();
  // Веб-версия обновляется сама: после выпуска сразу открывается новая.
  if (IS_WEB_APP) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        Веб-версия {__APP_VERSION__} ·
        <a href="/" className="text-muted underline-offset-2 hover:text-ink hover:underline">
          приложение для Windows и Android
        </a>
      </span>
    );
  }
  if (!version) return null;
  const label =
    status === "checking"
      ? "проверяю…"
      : status === "none"
        ? "последняя версия"
        : status === "error"
          ? "не удалось проверить"
          : available
            ? `есть ${available.version}`
            : "проверить обновления";
  return (
    <span className="flex items-center gap-1.5">
      Версия {version} ·
      <button type="button" disabled={status === "checking"} onClick={() => void checkNow()} className="text-muted underline-offset-2 hover:text-ink hover:underline">
        {label}
      </button>
    </span>
  );
}
