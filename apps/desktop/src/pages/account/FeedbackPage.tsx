import { useState } from "react";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  feedbackCreateSchema,
  type FeedbackCategory,
  type FeedbackDto,
  type FeedbackStatus,
} from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useForm } from "../../lib/use-form";
import { useLoad } from "../../lib/use-load";

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  new: "bg-surface-2 text-ink-2",
  reviewing: "bg-warn-bg text-warn-ink",
  planned: "bg-accent/15 text-accent-ink",
  done: "bg-success-bg text-success-ink",
  declined: "bg-danger-bg text-danger-ink",
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Форма идеи и история предложений текущего игрока. */
export function FeedbackPage() {
  const history = useLoad(() => api.feedback(), []);
  const [sent, setSent] = useState(false);
  const form = useForm(
    feedbackCreateSchema,
    { category: "improvement" as FeedbackCategory, title: "", description: "" },
    async (data) => {
      await api.createFeedback(data);
      form.setValues({ category: "improvement", title: "", description: "" });
      setSent(true);
      await history.reload();
    },
  );

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-[clamp(26px,4vw,36px)] font-bold">Предложить улучшение</h1>
        <p className="m-0 max-w-[720px] leading-relaxed text-muted">
          Расскажите, чего не хватает или что можно сделать удобнее. Предложение увидит администрация площадки, а его статус появится ниже.
        </p>
      </div>

      <Card className="flex flex-col gap-5">
        {sent && <Alert tone="success">Спасибо! Предложение отправлено и появилось в истории.</Alert>}
        {form.formError && <Alert>{form.formError}</Alert>}
        <form
          onSubmit={(event) => {
            setSent(false);
            void form.onSubmit(event);
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Тип обращения
            <select
              value={form.values.category}
              onChange={(event) => form.set("category", event.target.value as (typeof FEEDBACK_CATEGORIES)[number])}
              className="h-12 rounded-xl border border-line bg-ground px-3.5 text-[15px] text-ink outline-none focus:border-accent"
            >
              {FEEDBACK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {FEEDBACK_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Короткий заголовок"
            placeholder="Например: сохранять выбранные фильтры"
            autoFocus
            maxLength={120}
            value={form.values.title}
            onChange={(event) => form.set("title", event.target.value)}
            error={form.errors.title}
          />
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Что предлагаете изменить
            <textarea
              rows={7}
              maxLength={4000}
              value={form.values.description}
              onChange={(event) => form.set("description", event.target.value)}
              aria-invalid={form.errors.description ? true : undefined}
              className={`min-h-40 resize-y rounded-xl border bg-ground px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent ${
                form.errors.description ? "border-danger-strong" : "border-line"
              }`}
              placeholder="Опишите ситуацию, желаемый результат и чем это поможет игрокам."
            />
            <span className={`flex justify-between gap-3 text-[13px] ${form.errors.description ? "text-danger" : "text-faint"}`}>
              <span>{form.errors.description ?? "Не добавляйте пароли и другие личные данные."}</span>
              <span>{form.values.description.length}/4000</span>
            </span>
          </label>
          <Button type="submit" size="lg" loading={form.submitting} className="self-start max-sm:w-full">
            Отправить предложение
          </Button>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-xl font-extrabold">Мои предложения</h2>
        {history.error && <Alert>{history.error}</Alert>}
        {history.loading && !history.data && <p className="text-muted">Загружаю…</p>}
        {history.data?.items.length === 0 && <Card className="text-muted">Отправленных предложений пока нет.</Card>}
        {history.data?.items.map((item) => <FeedbackHistoryItem key={item.id} item={item} />)}
      </section>
    </div>
  );
}

function FeedbackHistoryItem({ item }: { item: FeedbackDto }) {
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1">
          <h3 className="m-0 text-base font-extrabold">{item.title}</h3>
          <span className="text-[13px] text-muted">
            {FEEDBACK_CATEGORY_LABELS[item.category]} · {when(item.createdAt)}
          </span>
        </div>
        <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[item.status]}`}>
          {FEEDBACK_STATUS_LABELS[item.status]}
        </span>
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{item.description}</p>
      {item.response && (
        <div className="rounded-xl border border-line-soft bg-ground-2 px-4 py-3 text-sm leading-relaxed">
          <strong className="block text-ink">Ответ администрации</strong>
          <span className="whitespace-pre-wrap text-ink-2">{item.response}</span>
        </div>
      )}
    </Card>
  );
}

