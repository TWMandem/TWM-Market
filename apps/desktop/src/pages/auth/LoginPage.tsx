import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { signInSchema } from "@twm/shared";
import { Alert, Button, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useForm } from "../../lib/use-form";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const form = useForm(signInSchema, { identifier: "", password: "" }, async (data) => {
    await signIn(await api.login(data));
    navigate(from, { replace: true });
  });

  if (status === "authed") return <Navigate to={from} replace />;

  return (
    <AuthLayout title="Вход" subtitle="Войдите по логину или email.">
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <Field
          label="Логин или email"
          autoComplete="username"
          autoFocus
          value={form.values.identifier}
          onChange={(e) => form.set("identifier", e.target.value)}
          error={form.errors.identifier}
        />
        <Field
          label="Пароль"
          type="password"
          revealable
          autoComplete="current-password"
          value={form.values.password}
          onChange={(e) => form.set("password", e.target.value)}
          error={form.errors.password}
        />
        <Button type="submit" size="lg" loading={form.submitting}>
          Войти
        </Button>
      </form>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link to="/forgot-password" className="font-semibold text-muted hover:text-ink">
          Забыли пароль?
        </Link>
        <Link to="/register" state={location.state} className="font-bold text-accent hover:text-accent-soft">
          Создать аккаунт →
        </Link>
      </div>
    </AuthLayout>
  );
}
