import { useState } from "react";
import { Link } from "react-router";
import type { SavedSearchSection } from "@twm/shared";
import { attempt } from "../lib/use-load";
import { api } from "../lib/api";
import { Modal } from "./ReportDialog";
import { Alert, Button, Field } from "./ui";

/**
 * Сохранение текущего фильтра каталога как подписки. Когда появится
 * подходящее объявление, придёт уведомление.
 */
export function SaveSearchDialog({
  section,
  params,
  suggestedName,
  onClose,
}: {
  section: SavedSearchSection;
  /** Параметры запроса к поиску: раздел, тип, сервер и фильтры. */
  params: string;
  suggestedName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(suggestedName.slice(0, 60));
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    const problem = await attempt(() => api.createSavedSearch({ name: name.trim(), section, params, notify }));
    setBusy(false);
    if (problem) setError(problem);
    else setSaved(true);
  };

  return (
    <Modal title="Подписка на поиск" onClose={onClose}>
      {saved ? (
        <>
          <Alert tone="success">
            Подписка сохранена.{notify ? " Когда появится подходящее объявление, придёт уведомление." : ""}
          </Alert>
          <div className="flex flex-wrap justify-end gap-2">
            <Link to="/my/searches" className="inline-flex h-11 items-center rounded-xl px-4 font-bold text-accent no-underline hover:text-accent-soft">
              Мои подписки →
            </Link>
            <Button onClick={onClose}>Готово</Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="m-0 text-sm leading-relaxed text-ink-2">
            Сохраним текущие фильтры. Подписку можно открыть в один клик, а новые подходящие объявления будут отмечены.
          </p>
          <Field label="Название" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="flex items-center gap-2.5 text-[15px]">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            Уведомлять о новых объявлениях
          </label>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              Сохранить
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
