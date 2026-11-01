import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { forgotPasswordSchema, PASSWORD_MIN, resetPasswordSchema } from "@twm/shared";
import { Alert, Button, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useForm } from "../../lib/use-form";
import { AuthLayout } from "./AuthLayout";

/** Восстановление пароля в два шага: email → код из письма и новый пароль. */
export function ForgotPasswordPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const requestForm = useForm(forgotPasswordSchema, { email: "" }, async ({ email }) => {
    await api.forgotPassword(email);
    setSentTo(email);
    resetForm.set("email", email);
  });

  const resetForm = useForm(resetPasswordSchema, { email: "", code: "", password: "" }, async (data) => {
    await signIn(await api.resetPassword(data));
    navigate("/account", { replace: true, state: { notice: "Пароль изменён. Другие устройства вышли из аккаунта." } });
  });

  if (!sentTo) {
    return (
      <AuthLayout title="Восстановление пароля" subtitle="Укажите email аккаунта — пришлём код для сброса пароля.">
        <form onSubmit={requestForm.onSubmit} noValidate className="flex flex-col gap-4">
          {requestForm.formError && <Alert>{requestForm.formError}</Alert>}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            value={requestForm.values.email}
            onChange={(e) => requestForm.set("email", e.target.value)}
            error={requestForm.errors.email}
          />
          <Button type="submit" size="lg" loading={requestForm.submitting}>
            Получить код
          </Button>
        </form>
        <Link to="/login" className="text-sm font-semibold text-muted hover:text-ink">
          ← Назад ко входу
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Новый пароль"
      subtitle={
        <>
          Если <strong className="text-ink">{sentTo}</strong> зарегистрирован, на него пришёл код. Проверьте папку
          «Спам».
        </>
      }
    >
      <form onSubmit={resetForm.onSubmit} noValidate className="flex flex-col gap-4">
        {resetForm.formError && <Alert>{resetForm.formError}</Alert>}
        <Field
          label="Код из письма"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          mono
          value={resetForm.values.code}
          onChange={(e) => resetForm.set("code", e.target.value.replace(/\D/g, ""))}
          error={resetForm.errors.code}
        />
        <Field
          label="Новый пароль"
          type="password"
          revealable
          autoComplete="new-password"
          value={resetForm.values.password}
          onChange={(e) => resetForm.set("password", e.target.value)}
          error={resetForm.errors.password}
          hint={`Не короче ${PASSWORD_MIN} символов.`}
        />
        <Button type="submit" size="lg" loading={resetForm.submitting}>
          Сменить пароль и войти
        </Button>
      </form>
      <Button variant="ghost" className="-ml-3 self-start" onClick={() => setSentTo(null)}>
        Указать другой email
      </Button>
    </AuthLayout>
  );
}
