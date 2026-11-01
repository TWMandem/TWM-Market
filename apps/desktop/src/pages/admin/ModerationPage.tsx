import { useState } from "react";
import { Link } from "react-router";
import { REPORT_REASON_LABELS, formatPrice, type ReportDto } from "@twm/shared";
import { Media, ServerDot } from "../../components/listing";
import { Modal } from "../../components/ReportDialog";
import { Alert, Button, Card } from "../../components/ui";
import { adminApi, mediaSrc } from "../../lib/api";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

type Tab = "listings" | "reports" | "messages";

const TARGET_LABELS: Record<ReportDto["targetType"], string> = {
  listing: "Объявление",
  message: "Сообщение",
  user: "Игрок",
  review: "Отзыв",
};

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Модерация: объявления на проверке (стоп-слова, жалобы), жалобы игроков,
 * сообщения со стоп-словами. Каждое решение попадает в журнал действий.
 */
export function ModerationPage() {
  const summary = useLoad(() => adminApi.moderationSummary(), []);
  const [tab, setTab] = useState<Tab>("listings");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const counts = summary.data;

  const tabs: Array<[Tab, string, number | undefined]> = [
    ["listings", "Объявления на проверке", counts?.listings],
    ["reports", "Жалобы", counts?.reports],
    ["messages", "Сообщения со стоп-словами", counts?.messages],
  ];

  return (
    <>
      <AdminTitle title="Модерация" />
      <p className="m-0 max-w-[760px] text-sm leading-relaxed text-muted">
        Объявления публикуются сразу. На проверку попадают те, где найдено стоп-слово, и те, на которые пожаловались несколько игроков.
        Переписку открывайте только по жалобе или стоп-слову — каждый просмотр записывается в журнал.
      </p>
      <div role="tablist" aria-label="Очереди" className="flex flex-wrap gap-2">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-10 rounded-xl border px-3.5 text-sm font-bold ${tab === key ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2"}`}
          >
            {label} <span className="font-mono opacity-80">{count ?? "…"}</span>
          </button>
        ))}
      </div>
      {tab === "listings" && <ListingsQueue onChanged={() => void summary.reload()} />}
      {tab === "reports" && <ReportsQueue onChanged={() => void summary.reload()} onOpenConversation={setConversationId} />}
      {tab === "messages" && <MessagesQueue onChanged={() => void summary.reload()} onOpenConversation={setConversationId} />}
      {conversationId && <ConversationViewer id={conversationId} onClose={() => setConversationId(null)} />}
    </>
  );
}

function ListingsQueue({ onChanged }: { onChanged: () => void }) {
  const queue = useLoad(() => adminApi.moderationListings(), []);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const done = (id: string) => {
    queue.setData((d) => (d ? { items: d.items.filter((x) => x.id !== id) } : d));
    onChanged();
  };

  if (queue.error) return <Alert>{queue.error}</Alert>;
  if (!queue.data) return <p className="text-muted">Загружаю…</p>;
  if (queue.data.items.length === 0) return <Card>Очередь пуста.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      {queue.data.items.map((l) => (
        <Card key={l.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <Media media={l.image} alt="" className="h-20 w-32 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link to={`/listing/${l.id}`} className="font-bold text-ink hover:text-accent">
                {l.title}
              </Link>
              <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                <span className="font-mono font-bold text-accent-soft">{l.price !== null ? formatPrice(l.price) : "Обмен"}</span>
                <span className="flex items-center gap-1">
                  <ServerDot color={l.server.color} /> {l.server.name}
                </span>
                <span>
                  {l.author.login} · {l.author.nickname}
                </span>
                <span>{when(l.updatedAt)}</span>
              </span>
              {l.moderationReason && <span className="text-sm font-bold text-[#e8d3a6]">{l.moderationReason}</span>}
              {l.description && <p className="m-0 line-clamp-4 whitespace-pre-line text-sm text-ink-2">{l.description}</p>}
            </div>
          </div>
          {rejecting === l.id ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const message = await attempt(() => adminApi.rejectListing(l.id, reason.trim()));
                setError(message);
                if (!message) {
                  setRejecting(null);
                  setReason("");
                  done(l.id);
                }
              }}
            >
              <input
                autoFocus
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина — её увидит автор"
                aria-label="Причина отклонения"
                className="h-11 min-w-[260px] flex-1 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
              />
              <Button type="submit" variant="danger" className="h-11">
                Отклонить
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setRejecting(null)}>
                Отмена
              </Button>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  const message = await attempt(() => adminApi.approveListing(l.id));
                  setError(message);
                  if (!message) done(l.id);
                }}
              >
                Одобрить
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(l.id)}>
                Отклонить…
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ReportsQueue({ onChanged, onOpenConversation }: { onChanged: () => void; onOpenConversation: (id: string) => void }) {
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const queue = useLoad(() => adminApi.reports(status), [status]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const decide = async (r: ReportDto, decision: "resolved" | "dismissed") => {
    const message = await attempt(() => adminApi.resolveReport(r.id, decision, notes[r.id]?.trim() ?? ""));
    setError(message);
    if (!message) {
      queue.setData((d) => (d ? { items: d.items.filter((x) => x.id !== r.id) } : d));
      onChanged();
    }
  };

  const hideTarget = async (r: ReportDto) => {
    const action =
      r.targetType === "message"
        ? () => adminApi.hideMessage(r.targetId)
        : r.targetType === "review"
          ? () => adminApi.hideReview(r.targetId)
          : () => adminApi.rejectListing(r.targetId, notes[r.id]?.trim() || "Нарушение правил площадки");
    const message = await attempt(action);
    setError(message);
    if (!message) {
      // Решение по объекту закрывает все жалобы на него.
      queue.setData((d) => (d ? { items: d.items.filter((x) => !(x.targetType === r.targetType && x.targetId === r.targetId)) } : d));
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        {(["open", "resolved", "dismissed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 font-bold ${status === s ? "bg-surface-2 text-ink" : "text-muted"}`}
          >
            {s === "open" ? "Открытые" : s === "resolved" ? "Принятые меры" : "Без нарушений"}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {queue.error && <Alert>{queue.error}</Alert>}
      {queue.data?.items.length === 0 && <Card>Жалоб нет.</Card>}
      {queue.data?.items.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-bold">{TARGET_LABELS[r.targetType]}</span>
            <span className="font-bold">{REPORT_REASON_LABELS[r.reason]}</span>
            {r.openCount > 1 && <span className="text-[#e8d3a6]">жалоб на этот объект: {r.openCount}</span>}
            <span className="ml-auto text-xs text-faint">
              {r.author ? r.author.login : "площадка"} · {when(r.createdAt)}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
            <span className="font-bold">
              {r.target.listingId ? (
                <Link to={`/listing/${r.target.listingId}`} className="text-ink hover:text-accent">
                  {r.target.title}
                </Link>
              ) : r.target.userLogin ? (
                <Link to={`/user/${encodeURIComponent(r.target.userLogin)}`} className="text-ink hover:text-accent">
                  {r.target.title}
                </Link>
              ) : (
                r.target.title
              )}
            </span>
            {r.target.text && <span className="whitespace-pre-line text-ink-2">{r.target.text}</span>}
            {r.target.conversationId && (
              <button type="button" onClick={() => onOpenConversation(r.target.conversationId!)} className="self-start text-[13px] font-bold text-accent">
                Открыть переписку (запишется в журнал)
              </button>
            )}
          </div>
          {r.comment && <p className="m-0 text-sm text-ink-2">Пояснение: {r.comment}</p>}
          {r.status === "open" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                placeholder="Комментарий к решению (необязательно)"
                aria-label="Комментарий к решению"
                maxLength={300}
                className="h-10 min-w-[220px] flex-1 rounded-xl border border-line bg-ground px-3 text-sm text-ink outline-none focus:border-accent"
              />
              {r.targetType !== "user" && (
                <Button variant="danger" onClick={() => void hideTarget(r)}>
                  {r.targetType === "listing" ? "Отклонить объявление" : "Скрыть"}
                </Button>
              )}
              {r.targetType === "user" && r.target.userLogin && (
                <Link to="/admin/users" className="text-sm font-bold text-accent">
                  К пользователям →
                </Link>
              )}
              <Button variant="secondary" onClick={() => void decide(r, "resolved")}>
                Меры приняты
              </Button>
              <Button variant="ghost" onClick={() => void decide(r, "dismissed")}>
                Нарушения нет
              </Button>
            </div>
          ) : (
            <span className="text-[13px] text-muted">
              {r.resolvedBy?.login ?? "—"}
              {r.resolvedAt ? `, ${when(r.resolvedAt)}` : ""}
              {r.resolution ? `: ${r.resolution}` : ""}
            </span>
          )}
        </Card>
      ))}
    </div>
  );
}

function MessagesQueue({ onChanged, onOpenConversation }: { onChanged: () => void; onOpenConversation: (id: string) => void }) {
  const queue = useLoad(() => adminApi.flaggedMessages(), []);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, action: () => Promise<unknown>) => {
    const message = await attempt(action);
    setError(message);
    if (!message) {
      queue.setData((d) => (d ? { items: d.items.filter((x) => x.id !== id) } : d));
      onChanged();
    }
  };

  if (queue.error) return <Alert>{queue.error}</Alert>;
  if (!queue.data) return <p className="text-muted">Загружаю…</p>;
  if (queue.data.items.length === 0) return <Card>Подозрительных сообщений нет.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      {queue.data.items.map((m) => (
        <Card key={m.id} className="flex flex-col gap-2.5">
          <span className="flex flex-wrap gap-x-3 text-[13px] text-muted">
            <span className="font-bold text-ink">{m.sender?.login ?? "—"}</span>
            <span>по «{m.listingTitle}»</span>
            <span className="font-bold text-[#e8d3a6]">{m.flagReason}</span>
            <span className="ml-auto">{when(m.createdAt)}</span>
          </span>
          <p className="m-0 whitespace-pre-wrap rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">{m.body}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void act(m.id, () => adminApi.hideMessage(m.id))}>
              Скрыть сообщение
            </Button>
            <Button variant="secondary" onClick={() => void act(m.id, () => adminApi.clearMessage(m.id))}>
              Ложное срабатывание
            </Button>
            <Button variant="ghost" onClick={() => onOpenConversation(m.conversationId)}>
              Вся переписка
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ConversationViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useLoad(() => adminApi.conversation(id), [id]);
  const c = data.data;
  return (
    <Modal title={c ? `Переписка по «${c.listing.title}»` : "Переписка"} onClose={onClose}>
      {data.error && <Alert>{data.error}</Alert>}
      {c && (
        <>
          <span className="text-[13px] text-muted">
            Покупатель: {c.buyer.login} · продавец: {c.seller.login}
          </span>
          <ul className="m-0 flex max-h-[60vh] list-none flex-col gap-2 overflow-y-auto p-0">
            {c.messages.map((m) => (
              <li
                key={m.id}
                className={`flex flex-col gap-0.5 rounded-xl px-3 py-2 text-sm ${m.flagged ? "bg-accent/10" : "bg-surface-2"} ${m.hidden ? "opacity-60" : ""}`}
              >
                <span className="text-xs text-faint">
                  {m.senderLogin ?? "Площадка"} · {when(m.createdAt)}
                  {m.hidden ? " · скрыто" : ""}
                  {m.flagged ? " · стоп-слово" : ""}
                </span>
                {m.image ? (
                  <img src={mediaSrc(m.image.url)} alt="Скриншот" className="max-h-48 max-w-full self-start rounded-lg object-contain" />
                ) : (
                  <span className="whitespace-pre-wrap">{m.body}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <Button variant="secondary" className="self-start" onClick={onClose}>
        Закрыть
      </Button>
    </Modal>
  );
}
