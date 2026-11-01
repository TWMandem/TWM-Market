import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { totpVerifySchema, type TwoFactorSetupDto, type TwoFactorStatusDto } from "@twm/shared";
import { Alert, Button, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useForm } from "../../lib/use-form";
import { AuthLayout } from "../auth/AuthLayout";

interface Props {
  status: TwoFactorStatusDto;
  onDone: (status: TwoFactorStatusDto) => void;
}

/**
 * Перед админ-панелью: включение двухфакторного входа (первый раз)
 * или ввод кода в этой сессии (каждый новый вход).
 */
export function TwoFactorGate({ status, onDone }: Props) {
  return status.enabled ? <VerifyCode onDone={onDone} /> : <Setup onDone={onDone} />;
}

function VerifyCode({ onDone }: { onDone: Props["onDone"] }) {
  const form = useForm(totpVerifySchema, { code: "" }, async ({ code }) => {
    onDone(await api.twoFactorVerify(code));
  });
  return (
    <AuthLayout title="Код подтверждения" subtitle="Введите 6-значный код из приложения-аутентификатора, чтобы открыть админ-панель.">
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <CodeField value={form.values.code} onChange={(v) => form.set("code", v)} error={form.errors.code} />
        <Button type="submit" size="lg" loading={form.submitting}>
          Открыть админ-панель
        </Button>
      </form>
      <p className="m-0 text-[13px] leading-relaxed text-faint">
        Потеряли телефон? Двухфакторный вход сбрасывается только командой на сервере — обратитесь к суперадминистратору.
      </p>
    </AuthLayout>
  );
}

function Setup({ onDone }: { onDone: Props["onDone"] }) {
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220, color: { dark: "#0E1014", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [setup]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      setSetup(await api.twoFactorSetup());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать настройку");
    } finally {
      setStarting(false);
    }
  };

  const form = useForm(totpVerifySchema, { code: "" }, async ({ code }) => {
    onDone(await api.twoFactorEnable(code));
  });

  if (!setup) {
    return (
      <AuthLayout
        title="Включите двухфакторный вход"
        subtitle="Для администрации он обязателен: даже если пароль утечёт, без телефона в админ-панель не войти."
      >
        {error && <Alert>{error}</Alert>}
        <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-relaxed text-ink-2">
          <li>Установите приложение-аутентификатор: Google Authenticator, Яндекс Ключ, Aegis или аналог.</li>
          <li>Отсканируйте QR-код, который появится на следующем шаге.</li>
          <li>Введите 6-значный код из приложения.</li>
        </ol>
        <Button size="lg" loading={starting} onClick={() => void start()}>
          Начать настройку
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Отсканируйте QR-код" subtitle="Откройте приложение-аутентификатор и добавьте новый аккаунт.">
      <div className="flex justify-center rounded-xl bg-white p-3">
        {qr ? (
          <img src={qr} width={220} height={220} alt="QR-код для приложения-аутентификатора" />
        ) : (
          <span className="py-20 text-sm text-[#333]">Создаю QR-код…</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Или введите ключ вручную:</span>
        <code className="select-all break-all rounded-lg bg-ground px-3 py-2 font-mono text-[15px] tracking-wider">
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </code>
        <span className="text-[13px] text-faint">Никому не показывайте этот ключ и QR-код.</span>
      </div>
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <CodeField value={form.values.code} onChange={(v) => form.set("code", v)} error={form.errors.code} />
        <Button type="submit" size="lg" loading={form.submitting}>
          Включить
        </Button>
      </form>
    </AuthLayout>
  );
}

function CodeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | undefined }) {
  return (
    <Field
      label="Код из приложения"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus
      mono
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      error={error}
    />
  );
}
