import { Link, Navigate, useNavigate } from "react-router";
import { LOGIN_MAX, LOGIN_MIN, PASSWORD_MIN, registerSchema } from "@twm/shared";
import { Alert, Button, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useForm } from "../../lib/use-form";
import { AuthLayout } from "./AuthLayout";

export function RegisterPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();

  const form = useForm(
    registerSchema,
    { login: "", email: "", password: "", rulesAccepted: false as boolean },
    async (data) => {
      await signIn(await api.register(data));
      navigate("/verify-email", { replace: true });
    },
  );

  if (status === "authed") return <Navigate to="/" replace />;

  return (
    <AuthLayout
      title="Регистрация"
      subtitle="Аккаунт площадки не связан с игровым. Игровые ники вы добавите позже в личном кабинете."
    >
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <Field
          label="Логин на площадке"
          autoComplete="username"
          autoFocus
          value={form.values.login}
          onChange={(e) => form.set("login", e.target.value)}
          error={form.errors.login}
          hint={`${LOGIN_MIN}–${LOGIN_MAX} символов: латиница, цифры, «_», «.», «-». Его видят другие игроки.`}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.values.email}
          onChange={(e) => form.set("email", e.target.value)}
          error={form.errors.email}
          hint="Никому не показывается. Нужен для подтверждения и восстановления пароля."
        />
        <Field
          label="Пароль"
          type="password"
          revealable
          autoComplete="new-password"
          value={form.values.password}
          onChange={(e) => form.set("password", e.target.value)}
          error={form.errors.password}
          hint={`Не короче ${PASSWORD_MIN} символов. Не используйте пароль от игры.`}
        />
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink-2">
            <input
              type="checkbox"
              checked={form.values.rulesAccepted}
              onChange={(e) => form.set("rulesAccepted", e.target.checked)}
              aria-invalid={form.errors.rulesAccepted ? true : undefined}
              className="mt-0.5 size-[18px] shrink-0 accent-accent"
            />
            <span>
              Принимаю правила площадки: торговля за реальные деньги запрещена, сделки проходят в игре, площадка не
              гарантирует передачу имущества.
            </span>
          </label>
          {form.errors.rulesAccepted && <span className="text-[13px] text-danger">{form.errors.rulesAccepted}</span>}
        </div>
        <Button type="submit" size="lg" loading={form.submitting}>
          Создать аккаунт
        </Button>
      </form>
      <p className="m-0 text-sm text-muted">
        Уже есть аккаунт?{" "}
        <Link to="/login" className="font-bold text-accent-ink hover:text-accent-soft">
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}
