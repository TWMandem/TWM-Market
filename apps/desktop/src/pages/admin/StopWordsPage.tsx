import { useState } from "react";
import { findStopWord, type StopWordDto } from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";
import { Toggle } from "./ServersPage";

/**
 * Стоп-слова против торговли за реальные деньги и выманивания оплаты вне игры.
 * Объявление с таким словом уходит на проверку, сообщение — в очередь модератора.
 */
export function StopWordsPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user?.role, "admin");
  const words = useLoad(() => adminApi.stopWords(), []);
  const [phrase, setPhrase] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("");

  const add = async () => {
    setBusy(true);
    let created: StopWordDto | null = null;
    setError(
      await attempt(async () => {
        created = await adminApi.createStopWord({ phrase: phrase.trim(), isRegex, note: note.trim() || null });
      }),
    );
    setBusy(false);
    if (created) {
      words.setData((d) => (d ? { items: [...d.items, created!].sort((a, b) => a.phrase.localeCompare(b.phrase, "ru")) } : d));
      setPhrase("");
      setNote("");
      setIsRegex(false);
    }
  };

  const remove = async (id: number) => {
    const message = await attempt(() => adminApi.deleteStopWord(id));
    setError(message);
    if (!message) words.setData((d) => (d ? { items: d.items.filter((w) => w.id !== id) } : d));
  };

  const hit = sample.trim() && words.data ? findStopWord(sample, words.data.items) : null;

  return (
    <>
      <AdminTitle title="Стоп-слова" />
      <p className="m-0 max-w-[760px] text-sm leading-relaxed text-muted">
        Фраза ищется без учёта регистра в названии и описании объявления и в сообщениях. Регулярные выражения — для номеров карт, ссылок и
        похожих шаблонов. Стоп-слово не блокирует, а отправляет на проверку человеку.
      </p>
      {error && <Alert>{error}</Alert>}

      <Card className="flex flex-col gap-3">
        <Field label="Проверить текст" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Вставьте текст объявления или сообщения" />
        {sample.trim() && (
          <span className={`text-sm font-bold ${hit ? "text-warn-ink" : "text-success-ink"}`}>
            {hit ? `Сработает: ${hit.phrase}${hit.note ? ` (${hit.note})` : ""}` : "Стоп-слов не найдено"}
          </span>
        )}
      </Card>

      {canEdit && (
        <Card className="flex flex-col gap-3">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Field label="Фраза или выражение" value={phrase} onChange={(e) => setPhrase(e.target.value)} className="min-w-[220px] flex-1" />
            <Field label="Пояснение (видит модератор)" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-[220px] flex-1" />
            <Toggle label="Регулярное выражение" checked={isRegex} onChange={setIsRegex} />
            <Button type="submit" loading={busy} disabled={phrase.trim().length < 2} className="h-12">
              Добавить
            </Button>
          </form>
        </Card>
      )}

      {words.error && <Alert>{words.error}</Alert>}
      <Card className="flex flex-col gap-1.5">
        {words.data?.items.map((w) => (
          <div key={w.id} className="group flex flex-wrap items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
            <span className={`font-semibold ${w.isRegex ? "font-mono text-sm" : ""}`}>{w.phrase}</span>
            {w.isRegex && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">выражение</span>}
            {w.note && <span className="text-[13px] text-muted">{w.note}</span>}
            {canEdit && (
              <button type="button" onClick={() => void remove(w.id)} className="ml-auto text-sm text-faint opacity-60 hover:text-danger group-hover:opacity-100">
                Удалить
              </button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
