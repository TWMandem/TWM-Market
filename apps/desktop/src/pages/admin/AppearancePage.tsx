import { useState } from "react";
import { SEASON_LABELS, SEASONS, type AdminAppearanceDto, type Season } from "@twm/shared";
import { Alert, Button, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { refreshSeason } from "../../lib/season";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle } from "./AdminLayout";

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** «2026-11-15T00:00» для поля datetime-local в часовом поясе компьютера. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Праздничное оформление приложения и сайта: включается без нового выпуска. */
export function AppearancePage() {
  const { data, setData, error } = useLoad(() => adminApi.appearance(), []);
  return (
    <>
      <AdminTitle title="Оформление" />
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        Праздничное оформление видно в приложении для Windows и Android, в веб-версии и на сайте — в течение получаса
        после сохранения, новый выпуск не нужен. Игрок может скрыть его у себя в личном кабинете.
      </p>
      {error && <Alert>{error}</Alert>}
      {data && <AppearanceForm key={data.updatedAt} value={data} onSaved={setData} />}
    </>
  );
}

function AppearanceForm({ value, onSaved }: { value: AdminAppearanceDto; onSaved: (v: AdminAppearanceDto) => void }) {
  const [season, setSeason] = useState<Season | null>(value.season);
  const [until, setUntil] = useState(toLocalInput(value.until));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    let next: AdminAppearanceDto | null = null;
    setError(
      await attempt(async () => {
        next = await adminApi.updateAppearance({ season, until: season && until ? new Date(until).toISOString() : null });
      }),
    );
    setBusy(false);
    if (next) {
      setSaved(true);
      onSaved(next);
      // Здесь — сразу, у остальных — в течение получаса.
      void refreshSeason();
    }
  };

  const options: Array<{ value: Season | null; label: string }> = [{ value: null, label: "Обычное" }, ...SEASONS.map((s) => ({ value: s, label: SEASON_LABELS[s] }))];

  return (
    <Card className="flex max-w-[620px] flex-col gap-4">
      <div role="radiogroup" aria-label="Оформление" className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={season === o.value}
            onClick={() => setSeason(o.value)}
            className={`rounded-xl border px-4 py-2.5 text-sm font-bold ${
              season === o.value ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {season && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Выключить само (необязательно)
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="h-11 max-w-[260px] rounded-xl border border-line bg-ground px-3 text-[15px] font-normal text-ink"
          />
          <span className="text-[13px] font-normal text-muted">Пусто — пока не выключите здесь.</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </Button>
        {saved && <span className="text-sm text-muted">Сохранено.</span>}
      </div>
      {error && <Alert>{error}</Alert>}
      <p className="m-0 text-[13px] text-muted">
        Сейчас: {value.season ? SEASON_LABELS[value.season] : "обычное"}
        {value.season && value.until ? `, до ${dateTime(value.until)}` : ""}
        {value.updatedBy ? ` · изменил ${value.updatedBy}, ${dateTime(value.updatedAt)}` : ""}
      </p>
    </Card>
  );
}
