import { useState } from "react";
import { Link, useParams } from "react-router";
import { ReportDialog } from "../../components/ReportDialog";
import { Alert, Card } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useLoad } from "../../lib/use-load";

const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Публичный профиль игрока: отзывы по подтверждённым сделкам. */
export function UserPage() {
  const { login = "" } = useParams();
  const { user } = useAuth();
  const profile = useLoad(() => api.publicUser(login), [login]);
  const [report, setReport] = useState<{ type: "user" | "review"; id: string } | null>(null);

  if (profile.error) return <Alert>{profile.error}</Alert>;
  const p = profile.data;
  if (!p) return <p className="text-muted">Загружаю…</p>;
  const total = p.reviews.positive + p.reviews.negative;
  const isMe = user?.login.toLowerCase() === p.login.toLowerCase();

  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-5">
        <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-line text-xl font-extrabold uppercase">
          {p.login.slice(0, 2)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 font-display text-[26px] font-bold">{p.login}</h1>
          <span className="text-sm text-muted">
            На площадке с {date(p.memberSince)} · сделок: {p.deals} · активных объявлений: {p.activeListings}
          </span>
        </div>
        <div className="flex gap-3 font-mono text-lg font-bold">
          <span className="rounded-xl bg-[#4cd48a]/10 px-3.5 py-2 text-[#9eebc0]" title="Положительные отзывы">
            👍 {p.reviews.positive}
          </span>
          <span className="rounded-xl bg-[#ff6b6b]/10 px-3.5 py-2 text-[#ffc4c4]" title="Отрицательные отзывы">
            👎 {p.reviews.negative}
          </span>
        </div>
        {user && !isMe && (
          <button type="button" onClick={() => setReport({ type: "user", id: p.login })} className="text-sm text-faint hover:text-danger">
            Пожаловаться
          </button>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-[19px] font-bold">Отзывы {total > 0 ? `(${total})` : ""}</h2>
        {p.recentReviews.length === 0 ? (
          <p className="m-0 text-sm text-muted">Отзывов пока нет. Отзыв оставляют после сделки, подтверждённой обеими сторонами.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {p.recentReviews.map((r) => (
              <li key={r.id} className="group flex flex-col gap-1 rounded-xl bg-surface-2 px-4 py-3">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span aria-label={r.positive ? "Положительный" : "Отрицательный"}>{r.positive ? "👍" : "👎"}</span>
                  <Link to={`/user/${encodeURIComponent(r.author.login)}`} className="font-bold text-ink hover:text-accent">
                    {r.author.login}
                  </Link>
                  <span className="text-muted">о сделке «{r.listingTitle}»</span>
                  <span className="ml-auto text-xs text-faint">{date(r.createdAt)}</span>
                </span>
                {r.comment && <p className="m-0 whitespace-pre-line leading-relaxed text-ink-2">{r.comment}</p>}
                {user && isMe && (
                  <button
                    type="button"
                    onClick={() => setReport({ type: "review", id: r.id })}
                    className="self-start text-xs text-faint opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    Оспорить отзыв
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {report && <ReportDialog targetType={report.type} targetId={report.id} onClose={() => setReport(null)} />}
    </div>
  );
}
