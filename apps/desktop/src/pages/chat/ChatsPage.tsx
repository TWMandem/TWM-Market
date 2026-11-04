import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DEFAULT_CHAT_TEMPLATES, MESSAGE_MAX, formatPrice, parsePrice, type ConversationDto, type MessageDto } from "@twm/shared";
import { CopyButton } from "../../components/CopyButton";
import { Icon } from "../../components/Icon";
import { LastSeen } from "../../components/LastSeen";
import { Media, ServerDot, timeAgo } from "../../components/listing";
import { ReportDialog } from "../../components/ReportDialog";
import { Alert, Button } from "../../components/ui";
import { ApiError, api, mediaSrc } from "../../lib/api";
import { useLoad } from "../../lib/use-load";
import { useUpdates } from "../../lib/updates-context";

const THREAD_POLL_MS = 4_000;

/** Переписки: список слева, выбранный диалог справа. */
export function ChatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { version } = useUpdates();
  const list = useLoad(() => api.conversations(), []);

  // Новые уведомления — обновить список (счётчики, последние сообщения).
  useEffect(() => {
    if (version > 0) void list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const all = list.data?.items ?? [];
  const [filter, setFilter] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const needle = filter.trim().toLowerCase();
  const items = all.filter(
    (c) =>
      (!onlyUnread || c.unread > 0 || (c.offer && !c.offer.mine)) &&
      (!needle ||
        c.listing.title.toLowerCase().includes(needle) ||
        c.counterpart.login.toLowerCase().includes(needle) ||
        (c.counterpart.nickname ?? "").toLowerCase().includes(needle)),
  );
  const setList = list.setData;
  const update = useCallback(
    (c: ConversationDto) => setList((d) => (d ? { items: d.items.map((x) => (x.id === c.id ? c : x)) } : d)),
    [setList],
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-bold">Сообщения</h1>
      {list.error && <Alert>{list.error}</Alert>}
      <div className="flex min-h-[560px] flex-wrap items-stretch gap-4">
        <aside
          aria-label="Переписки"
          className={`flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:max-w-[360px] ${id ? "max-lg:hidden" : ""}`}
        >
          {all.length > 0 && (
            <div className="flex flex-col gap-2 border-b border-line-soft p-2.5">
              <label htmlFor="chat-filter" className="sr-only">
                Найти переписку
              </label>
              <input
                id="chat-filter"
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Предмет или ник"
                className="h-10 rounded-xl border border-line bg-ground px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
              />
              <div role="group" aria-label="Показать" className="flex gap-1">
                {(
                  [
                    [false, "Все"],
                    [true, "Ждут ответа"],
                  ] as const
                ).map(([v, text]) => (
                  <button
                    key={text}
                    type="button"
                    aria-pressed={onlyUnread === v}
                    onClick={() => setOnlyUnread(v)}
                    className={`h-8 rounded-lg px-3 text-[13px] font-bold transition-colors ${onlyUnread === v ? "bg-line text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {list.data && all.length === 0 && (
            <p className="m-0 p-5 text-sm leading-relaxed text-muted">
              Переписок пока нет. Откройте объявление и нажмите «Написать продавцу».
            </p>
          )}
          {all.length > 0 && items.length === 0 && <p className="m-0 p-5 text-sm text-muted">Ничего не нашлось.</p>}
          <ul className="m-0 flex list-none flex-col overflow-y-auto p-1.5">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === id ? "true" : undefined}
                  onClick={() => navigate(`/chats/${c.id}`)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left ${c.id === id ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
                >
                  <Media media={c.listing.image} alt="" fit="cover" className="size-12 shrink-0 rounded-lg" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-bold">{c.listing.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-faint">{c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ""}</span>
                    </span>
                    <span className="truncate text-xs text-muted">
                      {c.role === "buyer" ? "Продавец" : "Покупатель"}: {c.counterpart.nickname ?? c.counterpart.login}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-ink-2">{lastText(c)}</span>
                      {c.unread > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-accent px-2 text-xs font-extrabold text-on-accent">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section aria-label="Переписка" className={`flex min-w-0 flex-[999_1_480px] flex-col ${id ? "" : "max-lg:hidden"}`}>
          {id ? (
            <Thread key={id} id={id} onChange={update} />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line p-8 text-center text-muted">
              Выберите переписку слева
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function lastText(c: ConversationDto): string {
  const m = c.lastMessage;
  if (!m) return "Нет сообщений";
  if (m.kind === "image") return `${m.mine ? "Вы: " : ""}Скриншот`;
  if (m.mine === null) return m.body;
  return `${m.mine ? "Вы: " : ""}${m.body || "Сообщение скрыто модератором"}`;
}

const time = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Thread({ id, onChange }: { id: string; onChange: (c: ConversationDto) => void }) {
  const { version, refresh } = useUpdates();
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [report, setReport] = useState<{ type: "message" | "user"; id: string } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const templates = useLoad(() => api.chatTemplates(), []);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastAt = useRef<string | null>(null);

  const applyConversation = useCallback(
    (c: ConversationDto) => {
      setConversation(c);
      onChange(c);
    },
    [onChange],
  );

  const append = useCallback((items: MessageDto[]) => {
    if (items.length === 0) return;
    setMessages((list) => {
      const known = new Set(list.map((m) => m.id));
      const next = [...list, ...items.filter((m) => !known.has(m.id))];
      lastAt.current = next[next.length - 1]?.createdAt ?? lastAt.current;
      return next;
    });
    window.setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 0);
  }, []);

  // Первая загрузка.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.conversation(id), api.messages(id)])
      .then(([c, page]) => {
        if (cancelled) return;
        applyConversation(c);
        setMessages(page.items);
        setHasMore(page.hasMore);
        lastAt.current = page.items[page.items.length - 1]?.createdAt ?? null;
        window.setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 0);
        refresh();
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : "Не удалось открыть переписку"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Новые сообщения: опрос, пока переписка открыта, и сразу после нового уведомления.
  const pull = useCallback(async () => {
    try {
      const [page, c] = await Promise.all([
        api.messages(id, lastAt.current ? { after: lastAt.current } : {}),
        api.conversation(id),
      ]);
      append(page.items);
      applyConversation(c);
    } catch {
      // Попробуем в следующий раз.
    }
  }, [id, append, applyConversation]);

  useEffect(() => {
    const timer = window.setInterval(() => void pull(), THREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pull]);
  useEffect(() => {
    if (version > 0) void pull();
  }, [version, pull]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const page = await api.messages(id, { before: first.createdAt });
    setMessages((list) => [...page.items, ...list]);
    setHasMore(page.hasMore);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      append([await api.sendMessage(id, body)]);
      setText("");
      void pull();
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const sendImage = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Подходят изображения PNG, JPG и WebP");
      return;
    }
    setSending(true);
    setError(null);
    try {
      append([await api.sendImage(id, file, file.name || "screenshot.png")]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить скриншот");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (!conversation) {
    return error ? <Alert>{error}</Alert> : <p className="text-muted">Загружаю…</p>;
  }
  const c = conversation;

  const toggleBlock = async () => {
    setError(null);
    try {
      await api.blockUser(c.counterpart.login, c.blocked !== "by_me");
      applyConversation(await api.conversation(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось изменить чёрный список");
    }
  };

  const insertTemplate = (template: string) => {
    setText((current) => (current.trim() ? `${current.trimEnd()} ${template}` : template).slice(0, MESSAGE_MAX));
    setTemplatesOpen(false);
    window.setTimeout(() => textarea.current?.focus(), 0);
  };
  const templateList = templates.data && templates.data.items.length > 0 ? templates.data.items : DEFAULT_CHAT_TEMPLATES;

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line-soft p-3.5">
        <Link to="/chats" className="text-sm font-bold text-accent lg:hidden">
          ← Все
        </Link>
        <Media media={c.listing.image} alt="" fit="cover" className="size-12 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link to={`/listing/${c.listing.id}`} className="truncate font-bold text-ink hover:text-accent">
            {c.listing.title}
          </Link>
          <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className="font-mono font-bold text-accent-soft">{c.listing.price !== null ? formatPrice(c.listing.price) : "Обмен"}</span>
            <span className="flex items-center gap-1">
              <ServerDot color={c.listing.server.color} /> {c.listing.server.name}
            </span>
            {c.listing.status !== "active" && <span className="text-[#ffb4b4]">объявление снято</span>}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <Link to={`/user/${encodeURIComponent(c.counterpart.login)}`} className="text-sm font-bold text-ink hover:text-accent">
            {c.counterpart.login}
          </Link>
          {c.counterpart.nickname && (
            <span className="flex items-center gap-0.5">
              <CopyButton text={c.counterpart.nickname} label="Скопировать ник" done={`Ник ${c.counterpart.nickname} скопирован`} className="!size-7" />
              <span className="select-all font-mono text-xs text-muted">{c.counterpart.nickname}</span>
            </span>
          )}
          <LastSeen at={c.counterpart.lastSeenAt} className="text-xs" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setReport({ type: "user", id: c.counterpart.login })}
            className="text-xs text-faint hover:text-danger"
          >
            Пожаловаться
          </button>
          <button type="button" onClick={() => void toggleBlock()} className="text-xs text-faint hover:text-ink">
            {c.blocked === "by_me" ? "Убрать из чёрного списка" : "В чёрный список"}
          </button>
        </div>
      </header>

      <OfferBar conversation={c} onChange={applyConversation} onPulled={() => void pull()} onCounter={() => setOfferOpen(true)} />
      <DealBar conversation={c} onChange={applyConversation} />

      <div role="log" aria-live="polite" aria-label="Сообщения" className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {hasMore && (
          <button type="button" onClick={() => void loadOlder()} className="self-center text-sm font-bold text-accent">
            Показать раньше
          </button>
        )}
        {messages.length === 0 && (
          <p className="m-auto max-w-sm text-center text-sm leading-relaxed text-muted">
            Напишите {c.role === "buyer" ? "продавцу" : "покупателю"}: когда удобно встретиться в игре и на каком сервере. Не договаривайтесь об
            оплате реальными деньгами — это запрещено и часто бывает обманом.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} onZoom={setZoom} onReport={() => setReport({ type: "message", id: m.id })} />
        ))}
        <div ref={bottom} />
      </div>

      {c.blocked ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft p-3.5 text-sm text-ink-2">
          <span>
            {c.blocked === "by_me"
              ? "Вы добавили игрока в чёрный список — писать друг другу нельзя."
              : "Игрок ограничил переписку с вами."}{" "}
            Отметить сделку и оставить отзыв по-прежнему можно.
          </span>
          {c.blocked === "by_me" && (
            <Button variant="secondary" onClick={() => void toggleBlock()}>
              Убрать из чёрного списка
            </Button>
          )}
        </div>
      ) : (
      <form
        className="relative flex items-end gap-2 border-t border-line-soft p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          aria-label="Отправить скриншот"
          title="Скриншот (или Ctrl+V в поле ввода)"
          onClick={() => fileInput.current?.click()}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-lg text-ink-2 hover:border-faint"
        >
          <span aria-hidden="true">＋</span>
        </button>
        {c.canOffer && (
          <button
            type="button"
            aria-label="Предложить цену"
            aria-expanded={offerOpen}
            title="Предложить цену"
            onClick={() => {
              setTemplatesOpen(false);
              setOfferOpen((v) => !v);
            }}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line font-mono text-[17px] font-bold text-ink-2 hover:border-faint"
          >
            <span aria-hidden="true">₽</span>
          </button>
        )}
        {offerOpen && c.canOffer && (
          <OfferForm
            conversation={c}
            onClose={() => setOfferOpen(false)}
            onDone={(next) => {
              applyConversation(next);
              setOfferOpen(false);
              void pull();
            }}
          />
        )}
        <button
          type="button"
          aria-label="Шаблоны ответов"
          aria-expanded={templatesOpen}
          title="Шаблоны ответов"
          onClick={() => {
            setOfferOpen(false);
            setTemplatesOpen((v) => !v);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 hover:border-faint"
        >
          <Icon name="chat" size={18} />
        </button>
        {templatesOpen && (
          <div className="absolute bottom-full left-3 z-20 mb-2 flex w-[min(420px,calc(100%-24px))] flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-xl">
            <span className="px-2 pt-1 text-xs font-bold text-muted">ШАБЛОНЫ ОТВЕТОВ</span>
            {templateList.map((t, i) => (
              <button
                key={`${i}-${t}`}
                type="button"
                onClick={() => insertTemplate(t)}
                className="rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {t}
              </button>
            ))}
            <Link to="/account#templates" className="px-2.5 py-1.5 text-xs font-bold text-accent hover:text-accent-soft">
              Настроить свои шаблоны →
            </Link>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void sendImage(file);
          }}
        />
        <label htmlFor="chat-input" className="sr-only">
          Сообщение
        </label>
        <textarea
          ref={textarea}
          id="chat-input"
          rows={1}
          maxLength={MESSAGE_MAX}
          value={text}
          placeholder="Сообщение… Enter — отправить, Shift+Enter — новая строка"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (file) {
              e.preventDefault();
              void sendImage(file.name ? file : new File([file], `screenshot-${Date.now()}.png`, { type: file.type }));
            }
          }}
          className="max-h-40 min-h-11 flex-1 resize-y rounded-xl border border-line bg-ground px-3.5 py-2.5 text-ink outline-none focus:border-accent"
        />
        <Button type="submit" loading={sending} disabled={!text.trim()} className="h-11">
          Отправить
        </Button>
      </form>
      )}
      {error && (
        <div className="px-3 pb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Скриншот"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setZoom(null)}
        >
          <img src={mediaSrc(zoom)} alt="Скриншот из переписки" className="max-h-full max-w-full object-contain" />
          <button type="button" autoFocus onClick={() => setZoom(null)} className="absolute right-5 top-5 h-11 rounded-xl bg-surface px-4 font-bold text-ink">
            Закрыть
          </button>
        </div>
      )}
      {report && <ReportDialog targetType={report.type} targetId={report.id} onClose={() => setReport(null)} />}
    </div>
  );
}

function Bubble({ message: m, onZoom, onReport }: { message: MessageDto; onZoom: (url: string) => void; onReport: () => void }) {
  if (m.mine === null) {
    return (
      <div role="note" className="my-1 self-center rounded-xl bg-accent/10 px-3.5 py-2 text-center text-[13px] text-[#e8d3a6]">
        {m.body} <span className="text-faint">· {time(m.createdAt)}</span>
      </div>
    );
  }
  return (
    <div className={`group flex max-w-[78%] flex-col gap-1 ${m.mine ? "self-end items-end" : "self-start items-start"}`}>
      <div
        className={`rounded-2xl px-3.5 py-2.5 leading-relaxed ${
          m.mine ? "rounded-br-md bg-accent/15 text-ink" : "rounded-bl-md bg-surface-2 text-ink"
        }`}
      >
        {m.hidden ? (
          <span className="text-sm italic text-faint">Сообщение скрыто модератором</span>
        ) : m.kind === "price_offer" && m.offerPrice !== null ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              {m.body.startsWith("Встречное") ? "Встречное предложение" : "Предложение цены"}
            </span>
            <span className="font-mono text-[19px] font-bold tabular text-accent-soft">{formatPrice(m.offerPrice)}</span>
          </span>
        ) : m.image ? (
          <button type="button" onClick={() => onZoom(m.image!.url)} className="block overflow-hidden rounded-lg" aria-label="Открыть скриншот">
            <img
              src={mediaSrc(m.image.url)}
              alt="Скриншот"
              width={m.image.width}
              height={m.image.height}
              className="block h-auto max-h-[260px] w-auto max-w-[320px] object-contain"
            />
          </button>
        ) : (
          <span className="whitespace-pre-wrap break-words">{m.body}</span>
        )}
      </div>
      <span className="flex items-center gap-2 text-[11px] text-faint">
        {time(m.createdAt)}
        {!m.mine && !m.hidden && (
          <button type="button" onClick={onReport} className="opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100">
            Пожаловаться
          </button>
        )}
      </span>
    </div>
  );
}

/** Отметка сделки и отзывы. Площадка не участвует в сделке — это только подтверждение для отзывов. */
function DealBar({ conversation: c, onChange }: { conversation: ConversationDto; onChange: (c: ConversationDto) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positive, setPositive] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const deal = c.deal;
  const who = c.counterpart.nickname ?? c.counterpart.login;

  const run = async (action: () => Promise<ConversationDto>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  let content: ReactNode;
  if (!deal || deal.status === "cancelled") {
    content = (
      <>
        <span className="text-sm text-ink-2">Встретились в игре и обменялись? Отметьте сделку — после подтверждения второй стороной можно оставить отзыв.</span>
        <Button variant="secondary" loading={busy} onClick={() => void run(() => api.dealAction(c.id, "propose"))}>
          Сделка состоялась
        </Button>
      </>
    );
  } else if (deal.status === "proposed" && deal.proposedByMe) {
    content = (
      <>
        <span className="text-sm text-ink-2">Ждём, когда {who} подтвердит сделку.</span>
        <Button variant="ghost" loading={busy} onClick={() => void run(() => api.dealAction(c.id, "cancel"))}>
          Отменить отметку
        </Button>
      </>
    );
  } else if (deal.status === "proposed") {
    content = (
      <>
        <span className="text-sm font-bold text-ink">
          {who} отметил(а), что сделка состоялась{deal.price !== null ? ` по цене ${formatPrice(deal.price)}` : ""}.
        </span>
        <div className="flex gap-2">
          <Button loading={busy} onClick={() => void run(() => api.dealAction(c.id, "confirm"))}>
            Подтвердить
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.dealAction(c.id, "cancel"))}>
            Сделки не было
          </Button>
        </div>
      </>
    );
  } else {
    content = (
      <div className="flex w-full flex-col gap-3">
        <span className="text-sm font-bold text-[#9eebc0]">
          Сделка подтверждена обеими сторонами{deal.price !== null ? ` · ${formatPrice(deal.price)}` : ""}
        </span>
        {deal.canReview && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (positive === null) {
                setError("Выберите оценку");
                return;
              }
              void run(() => api.review(c.id, { positive, comment: comment.trim() }));
            }}
          >
            <div role="group" aria-label="Оценка" className="flex gap-1.5">
              <button
                type="button"
                aria-pressed={positive === true}
                onClick={() => setPositive(true)}
                className={`h-11 rounded-xl border px-3 text-sm font-bold ${positive === true ? "border-[#4cd48a] bg-[#4cd48a]/15 text-[#9eebc0]" : "border-line text-ink-2"}`}
              >
                👍 Всё хорошо
              </button>
              <button
                type="button"
                aria-pressed={positive === false}
                onClick={() => setPositive(false)}
                className={`h-11 rounded-xl border px-3 text-sm font-bold ${positive === false ? "border-[#ff6b6b] bg-[#ff6b6b]/15 text-[#ffc4c4]" : "border-line text-ink-2"}`}
              >
                👎 Были проблемы
              </button>
            </div>
            <label className="sr-only" htmlFor="review-comment">
              Отзыв
            </label>
            <input
              id="review-comment"
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={`Пара слов о сделке с ${who}`}
              className="h-11 min-w-[200px] flex-1 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
            />
            <Button type="submit" loading={busy} className="h-11">
              Оставить отзыв
            </Button>
          </form>
        )}
        {deal.myReview && (
          <span className="text-[13px] text-muted">
            Ваш отзыв: {deal.myReview.positive ? "👍" : "👎"} {deal.myReview.comment}
          </span>
        )}
        {deal.theirReview && (
          <span className="text-[13px] text-muted">
            Отзыв о вас: {deal.theirReview.positive ? "👍" : "👎"} {deal.theirReview.comment}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line-soft bg-ground/40 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">{content}</div>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}

/** Разница с ценой объявления: «на 10% ниже цены объявления». */
function priceDelta(price: number, listingPrice: number | null): string | null {
  if (listingPrice === null || listingPrice === price) return null;
  const percent = Math.round((Math.abs(price - listingPrice) / listingPrice) * 100);
  if (percent === 0) return null;
  return `на ${percent}% ${price < listingPrice ? "ниже" : "выше"} цены объявления`;
}

/**
 * Торг: предложение цены, ждущее ответа, и согласованная цена.
 * Площадка не проводит оплату — договорённость только фиксируется для сделки и отзывов.
 */
function OfferBar({
  conversation: c,
  onChange,
  onPulled,
  onCounter,
}: {
  conversation: ConversationDto;
  onChange: (c: ConversationDto) => void;
  onPulled: () => void;
  onCounter: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offer = c.offer;
  const who = c.counterpart.nickname ?? c.counterpart.login;
  const dealMarked = c.deal?.status === "proposed" || c.deal?.status === "confirmed";
  if (!offer && (c.agreedPrice === null || dealMarked)) return null;

  const run = async (action: "accept" | "decline" | "withdraw") => {
    if (!offer) return;
    setBusy(action);
    setError(null);
    try {
      onChange(await api.answerOffer(c.id, offer.id, action));
      onPulled();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось");
      onPulled();
    } finally {
      setBusy(null);
    }
  };

  let content: ReactNode;
  if (offer && !offer.mine) {
    const delta = priceDelta(offer.price, c.listing.price);
    content = (
      <>
        <span className="flex flex-col gap-0.5 text-sm text-ink-2">
          <span>
            {who} предлагает <b className="font-mono text-[15px] text-accent-soft">{formatPrice(offer.price)}</b>
          </span>
          {delta && <span className="text-xs text-muted">{delta}</span>}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button loading={busy === "accept"} disabled={busy !== null || c.blocked !== null} onClick={() => void run("accept")}>
            Принять
          </Button>
          {c.canOffer && (
            <Button variant="secondary" disabled={busy !== null} onClick={onCounter}>
              Своя цена
            </Button>
          )}
          <Button variant="ghost" loading={busy === "decline"} disabled={busy !== null} onClick={() => void run("decline")}>
            Отклонить
          </Button>
        </div>
      </>
    );
  } else if (offer) {
    content = (
      <>
        <span className="text-sm text-ink-2">
          Вы предложили <b className="font-mono text-[15px] text-ink">{formatPrice(offer.price)}</b>. Ждём ответа {who}.
        </span>
        <Button variant="ghost" loading={busy === "withdraw"} onClick={() => void run("withdraw")}>
          Отозвать
        </Button>
      </>
    );
  } else {
    content = (
      <span className="text-sm text-ink-2">
        Договорились о цене <b className="font-mono text-[15px] text-[#9eebc0]">{formatPrice(c.agreedPrice!)}</b>. Она будет указана в
        сделке, когда вы её отметите.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line-soft bg-accent/5 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">{content}</div>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}

/** Окошко над полем ввода: своя цена (или встречная). Суммы как в игре: 500к, 2.5кк. */
function OfferForm({
  conversation: c,
  onClose,
  onDone,
}: {
  conversation: ConversationDto;
  onClose: () => void;
  onDone: (c: ConversationDto) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = text.trim() ? parsePrice(text) : null;
  const counter = c.offer !== null && !c.offer.mine;
  const delta = parsed !== null ? priceDelta(parsed, c.listing.price) : null;

  const submit = async () => {
    if (parsed === null) {
      setError("Не понимаю сумму. Пример: 500к, 2.5кк, 18 000 000");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.offerPrice(c.id, parsed));
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : "Не удалось отправить предложение");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={counter ? "Встречное предложение цены" : "Предложить цену"}
      className="absolute bottom-full left-3 z-20 mb-2 flex w-[min(380px,calc(100%-24px))] flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5 shadow-xl"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <span className="text-xs font-bold text-muted">{counter ? "ВСТРЕЧНОЕ ПРЕДЛОЖЕНИЕ" : "ПРЕДЛОЖИТЬ ЦЕНУ"}</span>
      {c.listing.price !== null && (
        <span className="text-[13px] text-ink-2">
          Цена в объявлении: <b className="font-mono">{formatPrice(c.listing.price)}</b>
          {counter && c.offer && (
            <>
              {" "}
              · {c.counterpart.nickname ?? c.counterpart.login} предлагает <b className="font-mono">{formatPrice(c.offer.price)}</b>
            </>
          )}
        </span>
      )}
      {/* Окошко стоит внутри формы сообщения, поэтому своя форма здесь не нужна: Enter отправляет цену. */}
      <div className="flex gap-2">
        <label htmlFor="offer-price" className="sr-only">
          Ваша цена
        </label>
        <input
          id="offer-price"
          autoFocus
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder="Например, 2.3кк"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3 font-mono text-ink outline-none focus:border-accent"
        />
        <Button loading={busy} disabled={parsed === null} className="h-11" onClick={() => void submit()}>
          Предложить
        </Button>
      </div>
      <span className="min-h-4 text-xs text-muted">
        {error ? <span className="text-danger">{error}</span> : parsed !== null ? `${formatPrice(parsed)}${delta ? ` — ${delta}` : ""}` : "Собеседник сможет принять цену, отклонить или предложить свою."}
      </span>
    </div>
  );
}
