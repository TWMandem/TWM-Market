import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { CHAT_TEMPLATE_LIMIT, DEFAULT_CHAT_TEMPLATES } from "@twm/shared";
import { Alert, Button, Card } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";

/** Приватность, шаблоны ответов и чёрный список. after.privacy — что показать сразу после «Приватности». */
export function ChatSettingsSection({ after }: { after?: { privacy?: ReactNode } }) {
  return (
    <>
      <PrivacyCard />
      {after?.privacy}
      <TemplatesCard />
      <BlocksCard />
    </>
  );
}

function PrivacyCard() {
  const { user, setUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const toggle = async () => {
    setBusy(true);
    setError(await attempt(async () => setUser(await api.updateSettings({ showOnline: !user.showOnline }))));
    setBusy(false);
  };
  return (
    <Card id="privacy" className="flex flex-col gap-3">
      <h2 className="m-0 text-[17px] font-extrabold">Приватность</h2>
      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" checked={user.showOnline} disabled={busy} onChange={() => void toggle()} className="mt-1 size-4 accent-[var(--color-accent)]" />
        <span className="flex flex-col gap-0.5">
          Показывать, когда я в сети
          <span className="text-[13px] text-muted">Другие игроки видят «в сети» или «был(а) … назад» в объявлениях и переписке.</span>
        </span>
      </label>
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}

function TemplatesCard() {
  const { data, error } = useLoad(() => api.chatTemplates(), []);
  const [items, setItems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hash } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (data) setItems(data.items.length > 0 ? data.items : [...DEFAULT_CHAT_TEMPLATES]);
  }, [data]);
  // Переход из переписки «Настроить свои шаблоны».
  useEffect(() => {
    if (hash === "#templates" && data) heading.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [hash, data]);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    const cleaned = items.map((t) => t.trim()).filter(Boolean);
    const failed = await attempt(async () => setItems((await api.saveChatTemplates(cleaned)).items));
    setProblem(failed);
    setSaved(!failed);
    setBusy(false);
  };

  return (
    <Card className="flex flex-col gap-3">
      <h2 id="templates" ref={heading} className="m-0 scroll-mt-24 text-[17px] font-extrabold">
        Шаблоны ответов
      </h2>
      <p className="m-0 text-[13px] text-muted">
        Готовые фразы для переписки: кнопка рядом с полем сообщения вставляет их в текст. До {CHAT_TEMPLATE_LIMIT} шаблонов.
      </p>
      {error && <Alert>{error}</Alert>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <input
              aria-label={`Шаблон ${i + 1}`}
              value={t}
              maxLength={300}
              onChange={(e) => setItems((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
            />
            <Button variant="ghost" aria-label={`Удалить шаблон ${i + 1}`} onClick={() => setItems((list) => list.filter((_, k) => k !== i))}>
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={items.length >= CHAT_TEMPLATE_LIMIT} onClick={() => setItems((list) => [...list, ""])}>
          Добавить шаблон
        </Button>
        <Button loading={busy} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
      {saved && <Alert tone="success">Шаблоны сохранены.</Alert>}
      {problem && <Alert>{problem}</Alert>}
    </Card>
  );
}

function BlocksCard() {
  const { data, setData, error } = useLoad(() => api.blocks(), []);
  const [problem, setProblem] = useState<string | null>(null);
  const unblock = async (login: string) => {
    const failed = await attempt(() => api.blockUser(login, false));
    setProblem(failed);
    if (!failed) setData((d) => (d ? { items: d.items.filter((b) => b.login !== login) } : d));
  };
  return (
    <Card id="blocks" className="flex flex-col gap-3">
      <h2 className="m-0 text-[17px] font-extrabold">Чёрный список</h2>
      <p className="m-0 text-[13px] text-muted">
        Игроки из списка не могут писать вам и начинать переписку по вашим объявлениям. Добавить — в профиле игрока или в переписке.
      </p>
      {(error || problem) && <Alert>{error ?? problem}</Alert>}
      {data && data.items.length === 0 && <p className="m-0 text-sm text-faint">Список пуст.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {data?.items.map((b) => (
          <li key={b.login} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2">
            <Link to={`/user/${encodeURIComponent(b.login)}`} className="font-bold text-ink hover:text-accent-ink">
              {b.login}
            </Link>
            <span className="text-[13px] text-faint">с {new Date(b.createdAt).toLocaleDateString("ru-RU")}</span>
            <Button variant="ghost" className="ml-auto" onClick={() => void unblock(b.login)}>
              Убрать
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
