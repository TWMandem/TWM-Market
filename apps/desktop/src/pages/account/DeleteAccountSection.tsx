import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, Field } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useToast } from "../../lib/toast";

/**
 * Удаление аккаунта. Сначала — что именно удалится и что останется,
 * затем пароль и галочка. Отменить удаление нельзя.
 */
export function DeleteAccountSection() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const staff = user.role !== "user";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      // Сеансы на сервере уже удалены — выходим только на этом устройстве.
      await signOut();
      toast("Аккаунт удалён");
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.password ?? e.fields.confirm ?? e.message) : "Не удалось удалить аккаунт");
      setBusy(false);
    }
  };

  return (
    <Card id="delete" className="flex flex-col gap-4 border-[#3b2424]">
      <h2 className="m-0 text-[17px] font-extrabold">Удаление аккаунта</h2>
      {staff ? (
        <p className="m-0 text-sm leading-relaxed text-ink-2">
          Это аккаунт сотрудника площадки. Чтобы удалить его, администратор сначала должен снять с него роль.
        </p>
      ) : !open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[560px] text-sm leading-relaxed text-ink-2">
            Удалить профиль, игровые профили, объявления и всё личное. Отменить удаление нельзя.
          </p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Удалить аккаунт…
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 text-sm leading-relaxed md:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-xl bg-[#1f1414] px-4 py-3">
              <b className="text-[#ffc4c4]">Удалится</b>
              <span className="text-ink-2">
                Логин и email, игровые профили и ники, объявления с фото, избранное, подписки на поиск, шаблоны, уведомления, входы на всех устройствах.
              </span>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-4 py-3">
              <b className="text-ink">Останется без вашего имени</b>
              <span className="text-ink-2">
                Ваши сообщения в переписках, сделки и отзывы — они нужны собеседникам. Вместо логина там будет «deleted_…».
              </span>
            </div>
          </div>
          <p className="m-0 text-[13px] text-faint">Из резервных копий данные исчезнут через 30 дней.</p>
          <Field
            label="Пароль от площадки"
            type="password"
            revealable
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
            className="max-w-[360px]"
          />
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink-2">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[#ff6b6b]" />
            Понимаю, что аккаунт удалится насовсем и восстановить его нельзя
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={!agree || !password}>
              Удалить аккаунт навсегда
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setPassword("");
                setAgree(false);
                setError(null);
              }}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
