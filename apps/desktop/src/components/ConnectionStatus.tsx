import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { API_URL } from "../lib/config";

type State = { kind: "checking" } | { kind: "online"; version: string } | { kind: "offline" };

/** Показывает, доступен ли сервер. Проверка повторяется раз в 30 секунд. */
export function ConnectionStatus() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then((h) => !cancelled && setState({ kind: "online", version: h.version }))
        .catch(() => !cancelled && setState({ kind: "offline" }));
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const dot = state.kind === "online" ? "bg-success" : state.kind === "offline" ? "bg-danger" : "bg-faint";
  const text =
    state.kind === "online"
      ? `Сервер доступен · API ${state.version}`
      : state.kind === "offline"
        ? "Нет связи с сервером"
        : "Проверяю связь с сервером…";

  return (
    <span role="status" className="flex items-center gap-2" title={API_URL}>
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
