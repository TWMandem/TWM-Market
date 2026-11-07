import { useEffect, useState } from "react";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackDto,
  type FeedbackStatus,
} from "@twm/shared";
import { Alert, Button, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Очередь идей игроков и ответы администрации. */
export function FeedbackAdminPage() {
  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const list = useLoad(() => adminApi.feedback(status || undefined), [status]);

  return (
    <>
      <AdminTitle title="Предложения игроков">
        <select
          aria-label="Статус"
          value={status}
          onChange={(event) => setStatus(event.target.value as FeedbackStatus | "")}
          className="h-11 rounded-xl border border-line bg-ground px-3 text-sm text-ink"
        >
          <option value="">Все статусы</option>
          {FEEDBACK_STATUSES.map((item) => (
            <option key={item} value={item}>
              {FEEDBACK_STATUS_LABELS[item]}
            </option>
          ))}
        </select>
      </AdminTitle>
      <p className="m-0 max-w-[760px] text-sm text-muted">Идеи, замечания и пожелания, отправленные из приложения.</p>
      {list.error && <Alert>{list.error}</Alert>}
      {list.data?.items.length === 0 && <Card>Предложений с таким статусом нет.</Card>}
      <div className={`flex flex-col gap-3 ${list.loading ? "opacity-60" : ""}`}>
        {list.data?.items.map((item) => (
          <FeedbackAdminCard key={item.id} item={item} onSaved={list.reload} />
        ))}
      </div>
    </>
  );
}

function FeedbackAdminCard({ item, onSaved }: { item: FeedbackDto; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(item.status);
  const [response, setResponse] = useState(item.response);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(item.status);
    setResponse(item.response);
  }, [item]);

  const save = async () => {
    setSaving(true);
    const problem = await attempt(() => adminApi.updateFeedback(item.id, { status, response }));
    setError(problem);
    setSaving(false);
    if (!problem) await onSaved();
  };

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <h2 className="m-0 text-[17px] font-extrabold">{item.title}</h2>
          <span className="text-[13px] text-muted">
            {item.author?.login ?? "Удалённый аккаунт"} · {FEEDBACK_CATEGORY_LABELS[item.category]} · {when(item.createdAt)}
          </span>
        </div>
        <select
          aria-label={`Статус предложения «${item.title}»`}
          value={status}
          onChange={(event) => setStatus(event.target.value as FeedbackStatus)}
          className="h-10 rounded-xl border border-line bg-ground px-3 text-sm font-semibold text-ink"
        >
          {FEEDBACK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {FEEDBACK_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{item.description}</p>
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Ответ игроку
        <textarea
          rows={3}
          maxLength={2000}
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="Необязательно. Ответ появится у игрока в истории предложений."
          className="resize-y rounded-xl border border-line bg-ground px-3.5 py-3 text-sm leading-relaxed text-ink outline-none focus:border-accent"
        />
      </label>
      {error && <Alert>{error}</Alert>}
      <Button variant="secondary" loading={saving} onClick={() => void save()} className="self-start">
        Сохранить статус и ответ
      </Button>
    </Card>
  );
}

