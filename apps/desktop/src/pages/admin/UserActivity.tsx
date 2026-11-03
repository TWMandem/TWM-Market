import { Link } from "react-router";
import { LISTING_STATUS_LABELS, REPORT_REASON_LABELS, formatPrice, lastSeenText } from "@twm/shared";
import { Alert, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const REPORT_STATUS = { open: "открыта", resolved: "решена", dismissed: "отклонена" } as const;
const TARGET = { listing: "объявление", message: "сообщение", user: "игрок", review: "отзыв" } as const;

/** Действия в журнале — понятными словами. */
const ACTIONS: Record<string, string> = {
  "listing.approved": "Объявление одобрено",
  "listing.rejected": "Объявление отклонено",
  "user.blocked": "Аккаунт заблокирован",
  "user.unblocked": "Аккаунт разблокирован",
  "user.role_changed": "Изменена роль",
  "nickname.verified": "Ник подтверждён",
  "nickname.rejected": "В подтверждении ника отказано",
};

/** История игрока для модератора: всё, что нужно для решения по жалобе. */
export function UserActivity({ id }: { id: string }) {
  const { data, error } = useLoad(() => adminApi.userActivity(id), [id]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-muted">Загружаю историю…</p>;
  const s = data.stats;
  const listingTotal = Object.values(s.listings).reduce((a, b) => a + b, 0);

  return (
    <>
      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-extrabold">История игрока</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          <Stat label="Объявлений" value={String(listingTotal)} note={Object.entries(s.listings).map(([k, v]) => `${LISTING_STATUS_LABELS[k as keyof typeof LISTING_STATUS_LABELS]?.toLowerCase() ?? k}: ${v}`).join(", ")} />
          <Stat label="Подтверждённых сделок" value={String(s.deals)} />
          <Stat label="Отзывы о нём" value={`👍 ${s.reviewsReceived.positive} · 👎 ${s.reviewsReceived.negative}`} note={s.reviewsReceived.hidden ? `скрыто: ${s.reviewsReceived.hidden}` : undefined} />
          <Stat label="Жалоб на него" value={String(s.reportsAgainst.total)} note={s.reportsAgainst.open ? `открытых: ${s.reportsAgainst.open}` : undefined} danger={s.reportsAgainst.open > 0} />
          <Stat label="Его жалоб" value={String(s.reportsFiled)} />
          <Stat label="В чёрном списке у" value={`${s.blockedBy} игр.`} danger={s.blockedBy >= 3} />
          <Stat label="Был в сети" value={lastSeenText(s.lastSeenAt)?.replace(/^был\(а\) /, "") ?? "—"} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-extrabold">Жалобы на игрока</h2>
        {data.reportsAgainst.length === 0 ? (
          <p className="m-0 text-sm text-muted">Жалоб нет.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.reportsAgainst.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-bold">{REPORT_REASON_LABELS[r.reason]}</span>
                  <span className="text-muted">на {TARGET[r.targetType]}</span>
                  <span className={r.status === "open" ? "font-bold text-accent" : "text-muted"}>{REPORT_STATUS[r.status]}</span>
                  <span className="ml-auto text-xs text-faint">
                    {r.author ?? "площадка"} · {when(r.createdAt)}
                  </span>
                </span>
                {r.comment && <span className="whitespace-pre-line text-ink-2">{r.comment}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="m-0 text-[17px] font-extrabold">Объявления</h2>
          {data.listings.length === 0 && <p className="m-0 text-sm text-muted">Объявлений нет.</p>}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {data.listings.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2">
                <Link to={`/listing/${l.id}`} className="truncate font-semibold text-ink hover:text-accent">
                  {l.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{LISTING_STATUS_LABELS[l.status]}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-ink-2">{l.price !== null ? formatPrice(l.price) : "обмен"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="m-0 text-[17px] font-extrabold">Отзывы о нём</h2>
          {data.reviews.length === 0 && <p className="m-0 text-sm text-muted">Отзывов нет.</p>}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {data.reviews.map((r) => (
              <li key={r.id} className={r.hidden ? "opacity-60" : ""}>
                {r.positive ? "👍" : "👎"} <span className="font-bold">{r.author}</span>
                {r.hidden && <span className="text-xs text-muted"> (скрыт)</span>}
                {r.comment && <span className="text-ink-2">: {r.comment}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-extrabold">Решения модераторов</h2>
        {data.audit.length === 0 ? (
          <p className="m-0 text-sm text-muted">Решений не было.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {data.audit.map((a, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="font-semibold">{ACTIONS[a.action] ?? a.action}</span>
                {typeof a.details.reason === "string" && <span className="text-ink-2">— {a.details.reason}</span>}
                <span className="ml-auto text-xs text-faint">
                  {a.actor ?? "система"} · {when(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, note, danger }: { label: string; value: string; note?: string | undefined; danger?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl px-3.5 py-2.5 ${danger ? "bg-[#ff6b6b]/10" : "bg-surface-2"}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className="font-mono text-[17px] font-bold tabular">{value}</span>
      {note && <span className="text-xs text-ink-2">{note}</span>}
    </div>
  );
}
