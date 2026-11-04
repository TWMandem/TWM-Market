import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Короткие подтверждения действий внизу экрана: «Объявление продлено»,
 * «Добавлено в избранное». Исчезают сами; читаются экранным диктором.
 */
type Tone = "ok" | "error";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const counter = useRef(0);

  const show = useCallback((text: string, tone: Tone = "ok") => {
    counter.current += 1;
    const id = counter.current;
    setItems((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`toast-in flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${
              t.tone === "error" ? "border-[#5a2e2e] bg-[#1f1414] text-[#ffc4c4]" : "border-line bg-surface-2 text-ink"
            }`}
          >
            {t.tone === "ok" && <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-[#4cd48a]/20 text-[12px] text-success">✓</span>}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
