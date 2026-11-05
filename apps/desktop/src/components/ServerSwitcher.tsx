import { useEffect, useId, useRef, useState } from "react";
import { useServers } from "../lib/server-context";
import { Icon } from "./Icon";

/** Переключатель «Мой сервер» в шапке. Выбор запоминается. */
export function ServerSwitcher() {
  const { servers, current, select } = useServers();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (number: number | null) => {
    select(number);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Мой сервер: ${current?.name ?? "все серверы"}. Сменить сервер`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 font-bold hover:border-faint"
      >
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: current?.color ?? "#A0A7B4" }} />
        {current?.name ?? "Все серверы"}
        <Icon name="chevronDown" size={14} className="text-muted" strokeWidth={2.4} />
      </button>

      {open && (
        <div
          id={listId}
          className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-2xl shadow-black/50"
        >
          <p className="px-2 pb-2 pt-1 text-xs font-bold tracking-wider text-faint">МОЙ СЕРВЕР</p>
          <ul className="grid grid-cols-2 gap-1">
            <li className="col-span-2">
              <ServerOption label="Все серверы" color="#A0A7B4" active={current === null} onPick={() => choose(null)} />
            </li>
            {servers.map((server) => (
              <li key={server.number}>
                <ServerOption
                  label={server.name}
                  hint={String(server.number)}
                  color={server.color}
                  active={current?.number === server.number}
                  onPick={() => choose(server.number)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface ServerOptionProps {
  label: string;
  hint?: string;
  color: string;
  active: boolean;
  onPick: () => void;
}

function ServerOption({ label, hint, color, active, onPick }: ServerOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={`flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-semibold ${
        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-xs text-faint">{hint}</span>}
      {active && <Icon name="check" size={14} className="text-accent-ink" strokeWidth={2.6} />}
    </button>
  );
}
