import { useState } from "react";
import { useAppUpdate } from "../lib/app-update";
import { Modal } from "./ReportDialog";
import { Button } from "./ui";

/** Полоса «Доступна новая версия» под шапкой и окно с описанием изменений. */
export function UpdateBanner() {
  const { available, status, progress, error, dismissed, dismiss, install, version } = useAppUpdate();
  const [open, setOpen] = useState(false);
  const working = status === "downloading" || status === "installing";

  if (!available || (dismissed && !working)) return null;

  return (
    <>
      <div className="border-b border-warn-line bg-warn-bg">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-6 py-2.5 text-sm text-warn-ink">
          <span>
            {working
              ? status === "installing"
                ? "Устанавливаю обновление — приложение перезапустится…"
                : `Скачиваю версию ${available.version}${progress !== null ? ` — ${Math.round(progress * 100)}%` : "…"}`
              : `Доступна новая версия ${available.version}.`}
          </span>
          {!working && (
            <>
              <button type="button" onClick={() => setOpen(true)} className="font-bold text-accent-ink hover:text-accent-soft">
                Что нового и обновить →
              </button>
              <button type="button" onClick={dismiss} className="ml-auto text-muted hover:text-ink">
                Позже
              </button>
            </>
          )}
          {status === "error" && error && <span className="w-full text-danger">Не удалось обновить: {error}</span>}
        </div>
      </div>
      {open && (
        <Modal title={`Версия ${available.version}`} onClose={() => setOpen(false)}>
          <p className="m-0 text-sm text-muted">
            Сейчас установлена {version ?? "—"}
            {available.date ? `, выпуск от ${new Date(available.date).toLocaleDateString("ru-RU")}` : ""}.
          </p>
          {available.notes ? (
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-line rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink-2">
              {available.notes}
            </div>
          ) : (
            <p className="m-0 text-sm text-ink-2">Исправления и улучшения.</p>
          )}
          <p className="m-0 text-[13px] text-faint">
            Обновление скачивается с GitHub, его подпись проверяется перед установкой. Приложение закроется на несколько секунд и откроется снова.
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
