import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

/** Базовые элементы интерфейса в стиле TWM Market. */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-soft font-extrabold",
  secondary: "border border-line bg-transparent text-ink hover:border-faint font-bold",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink font-semibold",
  danger: "border border-[#5a2e2e] bg-transparent text-[#ffb4b4] hover:bg-[#2a1717] font-bold",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: "md" | "lg";
}

export function Button({
  variant = "primary",
  loading = false,
  size = "md",
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const height = size === "lg" ? "h-[52px] px-7 text-base" : "h-11 px-4 text-[15px]";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${height} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Кнопка «показать пароль» для полей type="password". */
  revealable?: boolean;
  mono?: boolean;
}

export function Field({ label, error, hint, revealable, mono, type = "text", className = "", ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [revealed, setRevealed] = useState(false);
  const inputType = revealable && revealed ? "text" : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-ground focus-within:border-accent ${
          error ? "border-[#c45555]" : "border-line"
        }`}
      >
        <input
          id={id}
          type={inputType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? hintId : undefined}
          className={`h-12 min-w-0 flex-1 rounded-xl bg-transparent px-3.5 text-ink outline-none placeholder:text-faint ${
            mono ? "font-mono text-lg tracking-[0.3em]" : ""
          }`}
          {...rest}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Скрыть пароль" : "Показать пароль"}
            className="mr-1 h-10 rounded-lg px-3 text-sm font-semibold text-muted hover:text-ink"
          >
            {revealed ? "Скрыть" : "Показать"}
          </button>
        )}
      </div>
      {(error || hint) && (
        <span id={hintId} className={`text-[13px] ${error ? "text-danger" : "text-faint"}`}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-[#5a2e2e] bg-[#1f1414] text-[#ffc4c4]",
    info: "border-line bg-surface-2 text-ink-2",
    success: "border-[#24503a] bg-[#122019] text-[#a8f0c6]",
    warning: "border-[#3a3220] bg-[#17140d] text-[#e8d3a6]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-6 ${className}`}>{children}</section>
  );
}
