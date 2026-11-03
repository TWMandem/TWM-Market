import { useEffect, useState } from "react";
import { ONLINE_WINDOW_MS, lastSeenText } from "@twm/shared";

/** «в сети» с зелёной точкой или «был(а) … назад». Обновляется раз в минуту. */
export function LastSeen({ at, className = "" }: { at: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const text = lastSeenText(at, now);
  if (!text) return null;
  const online = at !== null && now - new Date(at).getTime() < ONLINE_WINDOW_MS;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${online ? "text-success" : "text-muted"} ${className}`}>
      {online && <span aria-hidden="true" className="size-2 rounded-full bg-success" />}
      {text}
    </span>
  );
}
