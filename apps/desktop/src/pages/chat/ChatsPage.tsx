import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MESSAGE_MAX, formatPrice, type ConversationDto, type MessageDto } from "@twm/shared";
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

  const items = list.data?.items ?? [];
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
          {list.data && items.length === 0 && (
            <p className="m-0 p-5 text-sm leading-relaxed text-muted">
              Переписок пока нет. Откройте объявление и нажмите «Написать продавцу».
            </p>
          )}
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
          {c.counterpart.nickname && <span className="select-all font-mono text-xs text-muted">{c.counterpart.nickname}</span>}
        </div>
        <button
          type="button"
          onClick={() => setReport({ type: "user", id: c.counterpart.login })}
          className="text-xs text-faint hover:text-danger"
        >
          Пожаловаться
        </button>
      </header>

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

      <form
        className="flex items-end gap-2 border-t border-line-soft p-3"
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
        <span className="text-sm font-bold text-ink">{who} отметил(а), что сделка состоялась.</span>
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
        <span className="text-sm font-bold text-[#9eebc0]">Сделка подтверждена обеими сторонами</span>
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
