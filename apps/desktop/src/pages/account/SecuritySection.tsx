import { useCallback, useEffect, useState } from "react";
import { changePasswordSchema, PASSWORD_MIN, type SessionDto } from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useForm } from "../../lib/use-form";

/** Понятное название устройства по строке User-Agent. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Неизвестное устройство";
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Mac OS X/i.test(userAgent)
      ? "macOS"
      : /Linux/i.test(userAgent)
        ? "Linux"
        : "другая система";
  const app = /Edg\//.test(userAgent) ? "TWM Market" : /Chrome\//.test(userAgent) ? "браузер" : "клиент";
  return `${app} · ${os}`;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function SecuritySection() {
  return (
    <Card id="security" className="flex flex-col gap-6">
      <h2 className="m-0 text-[17px] font-extrabold">Безопасность</h2>
      <ChangePasswordForm />
      <SessionsList />
    </Card>
  );
}

function ChangePasswordForm() {
  const [done, setDone] = useState(false);
  const [repeat, setRepeat] = useState("");
  const [repeatError, setRepeatError] = useState<string | undefined>();

  const form = useForm(changePasswordSchema, { currentPassword: "", newPassword: "" }, async (data) => {
    await api.changePassword(data);
    form.setValues({ currentPassword: "", newPassword: "" });
    setRepeat("");
    setDone(true);
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        if (repeat !== form.values.newPassword) {
          setRepeatError("Пароли не совпадают");
          return;
        }
        setRepeatError(undefined);
        void form.onSubmit();
      }}
      noValidate
      className="flex flex-col gap-3"
    >
      <h3 className="m-0 text-[15px] font-bold">Смена пароля</h3>
      {form.formError && <Alert>{form.formError}</Alert>}
      {done && <Alert tone="success">Пароль изменён. Остальные устройства вышли из аккаунта.</Alert>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <Field
          label="Текущий пароль"
          type="password"
          revealable
          autoComplete="current-password"
          value={form.values.currentPassword}
          onChange={(e) => form.set("currentPassword", e.target.value)}
          error={form.errors.currentPassword}
        />
        <Field
          label="Новый пароль"
          type="password"
          revealable
          autoComplete="new-password"
          value={form.values.newPassword}
          onChange={(e) => form.set("newPassword", e.target.value)}
          error={form.errors.newPassword}
          hint={`Не короче ${PASSWORD_MIN} символов`}
        />
        <Field
          label="Повторите новый пароль"
          type="password"
          revealable
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => {
            setRepeat(e.target.value);
            setRepeatError(undefined);
          }}
          error={repeatError}
        />
      </div>
      <Button type="submit" loading={form.submitting} className="self-start">
        Сменить пароль
      </Button>
    </form>
  );
}

function SessionsList() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions((await api.sessions()).items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить список устройств");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось выполнить действие");
    } finally {
      setBusy(null);
    }
  };

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-[15px] font-bold">Устройства со входом</h3>
        {others.length > 0 && (
          <Button variant="secondary" loading={busy === "others"} onClick={() => void run("others", api.revokeOtherSessions)}>
            Выйти на всех других
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {sessions && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
              <span className="font-semibold">{describeDevice(s.userAgent)}</span>
              {s.current && (
                <span className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-soft">это устройство</span>
              )}
              <span className="text-muted">
                вход {formatDate(s.createdAt)} · активность {formatDate(s.lastUsedAt)}
                {s.ip ? ` · IP ${s.ip}` : ""}
              </span>
              {!s.current && (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  loading={busy === s.id}
                  onClick={() => void run(s.id, () => api.revokeSession(s.id))}
                >
                  Завершить
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
