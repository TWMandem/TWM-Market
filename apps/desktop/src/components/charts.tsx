import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

/**
 * Графики по дням без сторонних библиотек: столбцы или линия,
 * у линии — необязательная полоса «от … до» (минимум и максимум цены).
 * Наведение показывает значение дня; для экранного диктора — скрытая таблица.
 */

export interface ChartPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number | null;
  /** Полоса вокруг линии (например, минимальная и максимальная цена). */
  low?: number | null;
  high?: number | null;
  /** Дополнительная строка в подсказке. */
  note?: string;
}

interface TimeChartProps {
  points: ChartPoint[];
  kind: "bar" | "line";
  /** Подпись для диктора и заголовок скрытой таблицы. */
  label: string;
  format?: (value: number) => string;
  /** Короткий формат для оси (по умолчанию — как format). */
  axisFormat?: (value: number) => string;
  height?: number;
  bandLabel?: [string, string];
}

const ACCENT = "var(--color-accent)";
const fmtDefault = (n: number) => n.toLocaleString("ru-RU");
export const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/** «Круглые» деления оси: 0, 5, 10… или 0, 2 млн, 4 млн… */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function TimeChart({ points, kind, label, format = fmtDefault, axisFormat, height = 200, bandLabel }: TimeChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const axis = axisFormat ?? format;

  const values = points.flatMap((p) => [p.value, p.low ?? null, p.high ?? null]).filter((v): v is number => v !== null);
  const dataMax = values.length ? Math.max(...values) : 0;
  const dataMin = values.length ? Math.min(...values) : 0;
  // Столбцы всегда от нуля; линия цены — от «круглого» значения ниже минимума.
  const ticks = niceTicks(kind === "bar" || dataMin === dataMax ? 0 : dataMin, Math.max(dataMax, kind === "bar" ? 1 : dataMin + 1));
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;

  const labelWidth = Math.min(90, Math.max(28, ...ticks.map((t) => axis(t).length * 7 + 8)));
  const pad = { top: 10, right: 8, bottom: 24, left: labelWidth };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const n = Math.max(1, points.length);
  const slot = plotW / n;
  const x = (i: number) => pad.left + slot * i + slot / 2;
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * n);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  // Линия рвётся там, где за день нет данных.
  const segments: Array<Array<[number, number]>> = [];
  let currentSegment: Array<[number, number]> = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (currentSegment.length) segments.push(currentSegment);
      currentSegment = [];
    } else currentSegment.push([x(i), y(p.value)]);
  });
  if (currentSegment.length) segments.push(currentSegment);

  const band = points
    .map((p, i) => (p.low != null && p.high != null ? { i, low: p.low, high: p.high } : null))
    .filter((b): b is { i: number; low: number; high: number } => b !== null);

  const xLabels = points.length > 0 ? [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i) : [];
  const hovered = hover !== null ? points[hover] : undefined;
  const barW = Math.max(2, Math.min(28, slot - 2));

  return (
    <figure className="m-0 flex flex-col gap-1">
      <div ref={ref} className="relative w-full">
        <svg width={width} height={height} role="img" aria-label={label} aria-describedby={tableId} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line-soft)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-faint)" className="tabular">
                {axis(t)}
              </text>
            </g>
          ))}

          {kind === "bar" &&
            points.map((p, i) => {
              if (!p.value) return null;
              const top = y(p.value);
              const h = Math.max(2, y(yMin) - top);
              const r = Math.min(4, barW / 2, h);
              const left = x(i) - barW / 2;
              const bottom = y(yMin);
              // Скругляем только верх столбца.
              const d = `M${left},${bottom} V${bottom - h + r} Q${left},${bottom - h} ${left + r},${bottom - h} H${left + barW - r} Q${left + barW},${bottom - h} ${left + barW},${bottom - h + r} V${bottom} Z`;
              return <path key={p.date} d={d} fill={ACCENT} opacity={hover === null || hover === i ? 1 : 0.55} />;
            })}

          {kind === "line" && band.length > 0 && (
            <>
              {/* Полоса строится по соседним дням; одиночные дни — короткой чертой. */}
              {groupRuns(band).map((run, k) =>
                run.length === 1 ? (
                  <line
                    key={k}
                    x1={x(run[0]!.i)}
                    x2={x(run[0]!.i)}
                    y1={y(run[0]!.low)}
                    y2={y(run[0]!.high)}
                    stroke={ACCENT}
                    strokeOpacity={0.3}
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    key={k}
                    d={`M${run.map((b) => `${x(b.i)},${y(b.high)}`).join(" L")} L${[...run].reverse().map((b) => `${x(b.i)},${y(b.low)}`).join(" L")} Z`}
                    fill={ACCENT}
                    fillOpacity={0.14}
                  />
                ),
              )}
            </>
          )}

          {kind === "line" &&
            segments.map((seg, k) =>
              seg.length === 1 ? (
                <circle key={k} cx={seg[0]![0]} cy={seg[0]![1]} r={4} fill={ACCENT} stroke="var(--color-surface)" strokeWidth={2} />
              ) : (
                <polyline key={k} points={seg.map(([a, b]) => `${a},${b}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ),
            )}

          {hovered && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="3 3" />
              {kind === "line" && hovered.value !== null && (
                <circle cx={x(hover)} cy={y(hovered.value)} r={5} fill={ACCENT} stroke="var(--color-surface)" strokeWidth={2} />
              )}
            </>
          )}

          <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--color-line)" strokeWidth={1} />
          {xLabels.map((i, k) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={k === 0 && xLabels.length > 1 ? "start" : k === xLabels.length - 1 && xLabels.length > 1 ? "end" : "middle"}
              fontSize={11}
              fill="var(--color-faint)"
            >
              {dayLabel(points[i]!.date)}
            </text>
          ))}

          {/* Зона наведения шире самих меток. */}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 whitespace-nowrap rounded-lg border border-line bg-ground px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(0, x(hover) - 70), Math.max(0, width - 160)),
            }}
          >
            <span className="text-muted">{dayLabel(hovered.date)}</span>
            <span className="font-mono font-bold text-ink tabular">{hovered.value === null ? "нет данных" : format(hovered.value)}</span>
            {hovered.low != null && hovered.high != null && (
              <span className="text-ink-2 tabular">
                {bandLabel?.[0] ?? "от"} {format(hovered.low)} {bandLabel?.[1] ?? "до"} {format(hovered.high)}
              </span>
            )}
            {hovered.note && <span className="text-ink-2">{hovered.note}</span>}
          </div>
        )}
      </div>

      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{dayLabel(p.date)}</th>
              <td>{p.value === null ? "нет данных" : format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function groupRuns<T extends { i: number }>(items: T[]): T[][] {
  const runs: T[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1]!.i === item.i - 1) last.push(item);
    else runs.push([item]);
  }
  return runs;
}

/** Все дни периода с пропусками там, где данных нет (для графика цены). */
export function fillDays<T extends { date: string }>(from: string, to: string, rows: T[]): Array<{ date: string; row: T | null }> {
  const map = new Map(rows.map((r) => [r.date, r]));
  const out: Array<{ date: string; row: T | null }> = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (d.getTime() <= end && out.length < 400) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, row: map.get(key) ?? null });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Сегодняшняя дата по Москве — как считает сервер. */
export function mskToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function daysBefore(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
