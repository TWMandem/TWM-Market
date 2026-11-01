import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { verifyEmailSchema } from "@twm/shared";
import { Alert, Button, Field } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useForm } from "../../lib/use-form";
import { AuthLayout } from "./AuthLayout";

const RESEND_SECONDS = 60;

export function VerifyEmailPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resendState, setResendState] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const form = useForm(verifyEmailSchema, { code: "" }, async ({ code }) => {
    setUser(await api.verifyEmail(code));
    navigate("/account", { replace: true, state: { notice: "Email подтверждён" } });
  });

  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to="/account" replace />;

  const resend = async () => {
    setResendState(null);
    try {
      await api.resendVerification();
      setCooldown(RESEND_SECONDS);
      setResendState({ tone: "success", text: "Новый код отправлен." });
    } catch (error) {
      setResendState({
        tone: "error",
        text: error instanceof ApiError ? error.message : "Не удалось отправить код.",
      });
    }
  };

  return (
    <AuthLayout
      title="Подтвердите email"
      subtitle={
        <>
          Мы отправили 6-значный код на <strong className="text-ink">{user.email}</strong>. Код действует 15 минут.
        </>
      }
    >
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <Field
          label="Код из письма"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          mono
          value={form.values.code}
          onChange={(e) => form.set("code", e.target.value.replace(/\D/g, ""))}
          error={form.errors.code}
        />
        <Button type="submit" size="lg" loading={form.submitting}>
          Подтвердить
        </Button>
      </form>
      {resendState && <Alert tone={resendState.tone}>{resendState.text}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Button variant="ghost" onClick={resend} disabled={cooldown > 0} className="-ml-3">
          {cooldown > 0 ? `Отправить снова через ${cooldown} с` : "Отправить код ещё раз"}
        </Button>
        <Link to="/" className="font-semibold text-muted hover:text-ink">
          Сделаю позже
        </Link>
      </div>
    </AuthLayout>
  );
}
