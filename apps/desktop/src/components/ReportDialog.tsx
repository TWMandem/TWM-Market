import { useEffect, useId, useState, type ReactNode } from "react";
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason, type ReportTarget } from "@twm/shared";
import { ApiError, api } from "../lib/api";
import { Alert, Button } from "./ui";

/** Простое модальное окно: Esc и щелчок по фону закрывают его. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="m-0 font-display text-xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

const TARGET_TITLES: Record<ReportTarget, string> = {
  listing: "Жалоба на объявление",
  message: "Жалоба на сообщение",
  user: "Жалоба на игрока",
  review: "Жалоба на отзыв",
};

/** Жалоба модераторам: причина и пояснение. */
export function ReportDialog({
  targetType,
  targetId,
  onClose,
}: {
  targetType: ReportTarget;
  targetId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!reason) {
      setError("Выберите причину");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.report({ targetType, targetId, reason, comment: comment.trim() });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : "Не удалось отправить жалобу");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={TARGET_TITLES[targetType]} onClose={onClose}>
      {sent ? (
        <>
          <Alert tone="success">Жалоба отправлена. Модератор рассмотрит её, решение придёт в уведомлениях.</Alert>
          <Button className="self-start" onClick={onClose}>
            Готово
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1.5 text-sm text-muted">Что не так</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px] text-ink-2">
                <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-accent" />
                {REPORT_REASON_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Пояснение {reason === "other" ? "" : "(необязательно)"}</span>
            <textarea
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="resize-y rounded-xl border border-line bg-ground px-3.5 py-2.5 text-ink outline-none focus:border-accent"
            />
          </label>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Отправить жалобу
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
