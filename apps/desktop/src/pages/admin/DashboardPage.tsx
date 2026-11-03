import { useState } from "react";
import { ADMIN_METRIC_LABELS, STATS_PERIODS, type AdminMetricKey, type AdminStatsDto, type StatsPeriod } from "@twm/shared";
import { TimeChart } from "../../components/charts";
import { Alert, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { Segmented } from "../catalog/CatalogPage";
import { AdminTitle } from "./AdminLayout";

const fmt = (n: number) => n.toLocaleString("ru-RU");
const METRICS: AdminMetricKey[] = ["activeUsers", "registrations", "published", "views", "messages", "deals"];
const PERIOD_KEY = "admin.statsPeriod";

function savedPeriod(): StatsPeriod {
  try {
    const v = Number(localStorage.getItem(PERIOD_KEY));
    return (STATS_PERIODS as readonly number[]).includes(v) ? (v as StatsPeriod) : 30;
  } catch {
    return 30;
  }
}

export function DashboardPage() {
  const [days, setDays] = useState<StatsPeriod>(savedPeriod);
  const [metric, setMetric] = useState<AdminMetricKey>("activeUsers");
  const { data, error, loading } = useLoad(() => adminApi.stats(days), [days]);

  const changePeriod = (value: string) => {
    const next = Number(value) as StatsPeriod;
    setDays(next);
    try {
      localStorage.setItem(PERIOD_KEY, String(next));
    } catch {
      // Не запомнили — не страшно.
    }
  };

  return (
    <>
      <AdminTitle title="Дашборд">
        <Segmented
          label="Период"
          value={String(days)}
          options={STATS_PERIODS.map((d) => [String(d), `${d} дней`])}
          onChange={changePeriod}
        />
      </AdminTitle>
      {error && <Alert>{error}</Alert>}
      {!data && loading && <p className="text-muted">Загружаю…</p>}
      {data && (
        <div className={`flex flex-col gap-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            {METRICS.map((key) => (
              <MetricTile key={key} metric={key} data={data} active={metric === key} onClick={() => setMetric(key)} />
            ))}
          </div>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-base font-extrabold">{ADMIN_METRIC_LABELS[metric]} по дням</h2>
              <span className="text-[13px] text-muted">
                последние {days} дней, по московскому времени
              </span>
            </div>
            <TimeChart
              kind="bar"
              label={`${ADMIN_METRIC_LABELS[metric]} за ${days} дней`}
              points={data.metrics[metric].byDay.map((d) => ({ date: d.date, value: d.value }))}
            />
            {metric === "activeUsers" && (
              <p className="m-0 text-[13px] text-faint">
                Активный — тот, кто открывал приложение под своим аккаунтом. В плитке — разные игроки за весь период.
              </p>
            )}
          </Card>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Kpi label="Активных объявлений" value={fmt(data.listings.active)} note={data.listings.bySection.map((s) => `${s.name}: ${fmt(s.active)}`).join(" · ")} />
            <Kpi label="На проверке" value={fmt(data.listings.moderation)} />
            <Kpi
              label="Пользователей"
              value={fmt(data.users.total)}
              note={data.users.total ? `email подтвердили ${Math.round((data.users.verified / data.users.total) * 100)}%` : undefined}
            />
            <Kpi label="Игровых профилей" value={fmt(data.gameProfiles)} />
            <Kpi label="Активных сессий" value={fmt(data.activeSessions)} />
            <Kpi label="Заблокировано" value={fmt(data.users.blocked)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopTable
              title="Популярные категории"
              note="по новым объявлениям за период"
              empty="Новых объявлений за период нет"
              rows={data.topCategories.map((c) => ({ id: c.id, name: c.name, a: c.listings, b: c.views }))}
              columns={["Объявлений", "Просмотров"]}
            />
            <TopTable
              title="Популярные предметы и модели"
              note="по просмотрам за период"
              empty="Просмотров за период нет"
              rows={data.topItems.map((c) => ({ id: c.id, name: c.name, a: c.views, b: c.listings }))}
              columns={["Просмотров", "Объявлений"]}
            />
          </div>
        </div>
      )}
    </>
  );
}

function MetricTile({ metric, data, active, onClick }: { metric: AdminMetricKey; data: AdminStatsDto; active: boolean; onClick: () => void }) {
  const m = data.metrics[metric];
  const change = m.previous > 0 ? Math.round(((m.total - m.previous) / m.previous) * 100) : null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left ${active ? "border-accent" : "border-line hover:border-faint"}`}
    >
      <span className="text-[13px] text-muted">{ADMIN_METRIC_LABELS[metric]}</span>
      <span className="font-mono text-[26px] font-bold tabular">{fmt(m.total)}</span>
      <span className="text-[13px] font-bold text-muted">
        {change === null
          ? m.total > 0
            ? "раньше не было"
            : "—"
          : `${change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}${change}% к прошлому периоду`}
      </span>
    </button>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[26px] font-bold tabular">{value}</span>
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </div>
  );
}

function TopTable({
  title,
  note,
  empty,
  rows,
  columns,
}: {
  title: string;
  note: string;
  empty: string;
  rows: Array<{ id: number; name: string; a: number; b: number }>;
  columns: [string, string];
}) {
  const max = Math.max(1, ...rows.map((r) => r.a));
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-extrabold">{title}</h2>
        <span className="text-[13px] text-muted">{note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-faint">{empty}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[13px] text-muted">
              <th className="pb-2 font-semibold">Название</th>
              <th className="w-24 pb-2 text-right font-semibold">{columns[0]}</th>
              <th className="w-24 pb-2 text-right font-semibold">{columns[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-soft">
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{r.name}</span>
                    <span aria-hidden="true" className="h-1 rounded-full bg-accent" style={{ width: `${Math.max(3, (r.a / max) * 100)}%` }} />
                  </div>
                </td>
                <td className="py-2 text-right font-mono font-bold tabular">{fmt(r.a)}</td>
                <td className="py-2 text-right font-mono text-ink-2 tabular">{fmt(r.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
