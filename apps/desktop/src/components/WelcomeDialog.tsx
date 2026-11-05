import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createGameProfileSchema, fieldErrors } from "@twm/shared";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useServers } from "../lib/server-context";
import { readSetting, writeSetting } from "../lib/storage";
import { useToast } from "../lib/toast";
import { Icon } from "./Icon";
import { ServerDot } from "./listing";
import { Button } from "./ui";

const doneKey = (userId: string) => `welcome:${userId}`;

/**
 * Первый вход игрока: выбрать сервер, указать ник персонажа и понять, что
 * делать дальше. Показывается, пока у игрока нет игрового профиля и он
 * не нажал «Позже». Сотрудникам площадки не показывается.
 */
export function WelcomeDialog() {
  const { status, user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status !== "authed" || !user || user.role !== "user" || readSetting(doneKey(user.id))) return;
    let cancelled = false;
    api
      .gameProfiles()
      .then((r) => !cancelled && setOpen(r.items.length === 0))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  if (!open || !user) return null;
  const close = () => {
    writeSetting(doneKey(user.id), "1");
    setOpen(false);
  };
  return <Steps login={user.login} onClose={close} />;
}

function Steps({ login, onClose }: { login: string; onClose: () => void }) {
  const { servers, current, select } = useServers();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [server, setServer] = useState<number | null>(current?.number ?? null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = servers.find((s) => s.number === server) ?? null;

  const saveProfile = async () => {
    if (!server) return;
    const parsed = createGameProfileSchema.safeParse({ nickname, serverNumber: server });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed.error))[0] ?? "Проверьте ник");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createGameProfile(parsed.data);
      toast(`Профиль ${parsed.data.nickname} добавлен`);
      setStep(2);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : "Не удалось добавить профиль");
    } finally {
      setBusy(false);
    }
  };

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="zoom-in flex max-h-full w-full max-w-[620px] flex-col gap-6 overflow-y-auto rounded-[24px] border border-line bg-surface p-7"
      >
        <div className="flex items-center gap-3">
          <ol aria-label="Шаги" className="m-0 flex flex-1 list-none gap-1.5 p-0">
            {["Сервер", "Ник", "Готово"].map((label, i) => (
              <li key={label} className="flex flex-1 flex-col gap-1.5">
                <span className={`h-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-accent" : "bg-line"}`} />
                <span className={`text-xs font-bold ${i === step ? "text-ink" : "text-faint"}`}>
                  {label}
                  {i === step && <span className="sr-only"> — текущий шаг</span>}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm font-bold text-muted hover:bg-surface-2 hover:text-ink">
            Позже
          </button>
        </div>

        {step === 0 && (
          <>
            <div className="flex flex-col gap-2">
              <h2 id="welcome-title" className="m-0 font-display text-[26px] font-bold leading-tight">
                Добро пожаловать, {login}!
              </h2>
              <p className="m-0 leading-relaxed text-ink-2">На каком сервере вы играете? Каталог будет сразу показывать его объявления.</p>
            </div>
            <div role="radiogroup" aria-label="Сервер" className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
              {servers.map((s, i) => (
                <button
                  key={s.number}
                  type="button"
                  role="radio"
                  aria-checked={server === s.number}
                  data-autofocus={i === 0 ? "" : undefined}
                  onClick={() => setServer(s.number)}
                  className={`flex h-12 items-center gap-2.5 rounded-xl border px-3.5 text-left font-bold transition-colors ${
                    server === s.number ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-faint"
                  }`}
                >
                  <ServerDot color={s.color} size={10} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto font-mono text-xs text-faint">{s.number}</span>
                </button>
              ))}
            </div>
            <Button
              size="lg"
              disabled={!server}
              onClick={() => {
                select(server);
                setStep(1);
              }}
              className="self-start"
            >
              Дальше
              <Icon name="arrowRight" size={18} />
            </Button>
          </>
        )}

        {step === 1 && chosen && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <div className="flex flex-col gap-2">
              <h2 id="welcome-title" className="m-0 font-display text-[26px] font-bold leading-tight">
                Ваш ник в игре
              </h2>
              <p className="m-0 leading-relaxed text-ink-2">
                От имени этого персонажа будут объявления, по нему покупатель найдёт вас в игре. Доступа к игровому аккаунту у площадки нет — хранятся только
                ник и сервер.
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-sm text-muted">
                Ник персонажа на сервере <ServerDot color={chosen.color} /> <b className="text-ink-2">{chosen.name}</b>
              </span>
              <input
                data-autofocus=""
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setError(null);
                }}
                placeholder="Например, Ivan_Petrov"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                className={`h-[52px] rounded-xl border bg-ground px-4 font-mono text-lg text-ink outline-none placeholder:font-sans placeholder:text-base placeholder:text-faint focus:border-accent ${
                  error ? "border-danger-strong" : "border-line"
                }`}
              />
              {error && <span className="text-[13px] text-danger">{error}</span>}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" loading={busy} disabled={!nickname.trim()}>
                Сохранить ник
              </Button>
              <Button variant="ghost" onClick={() => setStep(0)}>
                Другой сервер
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <>
            <div className="flex flex-col gap-2">
              <h2 id="welcome-title" className="m-0 font-display text-[26px] font-bold leading-tight">
                Всё готово
              </h2>
              <p className="m-0 leading-relaxed text-ink-2">С чего начнёте?</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <NextCard icon="search" title="Найти" text="Предметы, транспорт и имущество вашего сервера" onClick={() => go("/items")} autofocus />
              <NextCard icon="plus" title="Разместить" text="Продать или купить — объявление за пару минут" onClick={() => go("/listings/new")} />
              <NextCard icon="shield" title="Подтвердить ник" text="Покупатели больше доверяют нику с ✔" onClick={() => go("/account#profiles")} />
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-faint">
              Сделки проходят только в игре, площадка лишь помогает договориться. Торговля за реальные деньги запрещена.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function NextCard({
  icon,
  title,
  text,
  onClick,
  autofocus,
}: {
  icon: "search" | "plus" | "shield";
  title: string;
  text: string;
  onClick: () => void;
  autofocus?: boolean;
}) {
  return (
    <button
      type="button"
      data-autofocus={autofocus ? "" : undefined}
      onClick={onClick}
      className="group flex flex-col items-start gap-2 rounded-2xl border border-line bg-ground/50 p-4 text-left transition-colors hover:border-accent"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent-ink">
        <Icon name={icon} size={20} />
      </span>
      <span className="font-bold">{title}</span>
      <span className="text-[13px] leading-snug text-muted">{text}</span>
    </button>
  );
}
