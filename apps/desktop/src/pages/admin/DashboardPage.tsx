import { Alert, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function DashboardPage() {
  const { data, error } = useLoad(() => adminApi.stats(), []);

  return (
    <>
      <AdminTitle title="Дашборд" />
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Kpi label="Пользователей" value={fmt(data.users.total)} note={`+${fmt(data.users.new7d)} за 7 дней`} />
            <Kpi label="Новых за 30 дней" value={fmt(data.users.new30d)} />
            <Kpi
              label="Подтвердили email"
              value={fmt(data.users.verified)}
              note={data.users.total ? `${Math.round((data.users.verified / data.users.total) * 100)}%` : undefined}
            />
            <Kpi label="Игровых профилей" value={fmt(data.gameProfiles)} />
            <Kpi label="Активных сессий" value={fmt(data.activeSessions)} />
            <Kpi label="Заблокировано" value={fmt(data.users.blocked)} />
          </div>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="m-0 text-base font-extrabold">Регистрации по дням</h2>
              <span className="text-[13px] text-muted">последние 30 дней</span>
            </div>
            <RegistrationsChart days={data.registrationsByDay} />
          </Card>

          <p className="m-0 text-[13px] text-faint">
            Статистика объявлений, просмотров и сделок появится вместе с объявлениями (шаг 4).
          </p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[26px] font-bold tabular">{value}</span>
      {note && <span className="text-[13px] font-bold text-muted">{note}</span>}
    </div>
  );
}

function RegistrationsChart({ days }: { days: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const label = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Регистрации за 30 дней: всего ${total}, максимум ${max} в день`}
        className="flex h-[180px] items-end gap-[3px] border-b border-line"
      >
        {days.map((d, i) => (
          <div key={d.date} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div
              className={`w-full rounded-t-[3px] ${i === days.length - 1 ? "bg-accent" : "bg-[#4a5263] group-hover:bg-[#6b7487]"}`}
              style={{ height: `${Math.max(d.count ? 3 : 0, (d.count / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ground px-2 py-1 text-xs text-ink shadow-lg group-hover:block">
              {label(d.date)}: {d.count}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-faint">
        <span>{days[0] ? label(days[0].date) : ""}</span>
        <span>сегодня</span>
      </figcaption>
    </figure>
  );
}
