import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/error-report";

/**
 * Если экран упал, показываем понятное сообщение вместо пустого окна
 * и отправляем отчёт об ошибке.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack ?? "" });
  }

  override componentDidUpdate(prev: { resetKey?: string }): void {
    // Переход на другой экран — пробуем снова.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-[520px] flex-col items-center gap-4 py-16 text-center">
        <h1 className="m-0 font-display text-[26px] font-bold">Что-то пошло не так</h1>
        <p className="m-0 text-muted">
          На этом экране произошла ошибка. Отчёт уже отправлен разработчикам. Попробуйте открыть экран заново.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => this.setState({ failed: false })} className="h-11 rounded-xl border border-line px-4 font-bold text-ink hover:border-faint">
            Попробовать снова
          </button>
          <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-xl bg-accent px-4 font-extrabold text-on-accent hover:bg-accent-soft">
            Перезапустить
          </button>
        </div>
      </div>
    );
  }
}
