import { useState } from "react";
import { Alert, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { Segmented } from "../catalog/CatalogPage";
import { AdminTitle } from "./AdminLayout";

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Ошибки у игроков и внутренние ошибки сервера, сгруппированные. */
export function ErrorsPage() {
  const [days, setDays] = useState("7");
  const [source, setSource] = useState("");
  const { data, error, loading } = useLoad(() => adminApi.errors({ days: Number(days), ...(source ? { source } : {}) }), [days, source]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <AdminTitle title="Ошибки">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Источник" value={source} options={[["", "Все"], ["app", "Приложение"], ["server", "Сервер"]]} onChange={setSource} />
          <Segmented label="Период" value={days} options={[["1", "Сутки"], ["7", "7 дней"], ["30", "30 дней"]]} onChange={setDays} />
        </div>
      </AdminTitle>
      <p className="m-0 max-w-[760px] text-sm text-muted">
        Приложение само присылает свои сбои (без личных данных), сервер записывает внутренние ошибки. Одинаковые ошибки собраны в одну
        строку. Хранятся 30 дней.
      </p>
      {error && <Alert>{error}</Alert>}
      {data && data.items.length === 0 && <Card>Ошибок за этот период нет.</Card>}
      <div className={`flex flex-col gap-2 ${loading ? "opacity-60" : ""}`}>
        {data?.items.map((e) => (
          <Card key={e.fingerprint} className="flex flex-col gap-2 p-4">
            <button type="button" onClick={() => setOpen(open === e.fingerprint ? null : e.fingerprint)} aria-expanded={open === e.fingerprint} className="flex flex-wrap items-start gap-3 text-left">
              <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${e.source === "server" ? "bg-danger/15 text-danger-ink" : "bg-surface-2 text-ink-2"}`}>
                {e.source === "server" ? "сервер" : "приложение"}
              </span>
              <span className="min-w-[240px] flex-1 font-mono text-sm font-bold text-ink">{e.message}</span>
              <span className="text-right text-[13px] text-muted">
                <span className="font-mono font-bold text-ink">{e.count}</span> раз
                {e.users > 0 ? ` · у ${e.users} игр.` : ""}
                <br />
                последняя {when(e.lastAt)}
              </span>
            </button>
            <span className="text-[13px] text-muted">
              {e.route && <>Экран: <span className="font-mono">{e.route}</span> · </>}
              {e.versions.length > 0 && <>Версии: {e.versions.join(", ")} · </>}
              впервые {when(e.firstAt)}
            </span>
            {open === e.fingerprint && e.stack && (
              <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-ground p-3 font-mono text-xs text-ink-2">{e.stack}</pre>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
