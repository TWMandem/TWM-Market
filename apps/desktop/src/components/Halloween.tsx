import { useSeason } from "../lib/season";

/**
 * Хеллоуинское оформление: тыква, летучие мыши, паук и паутина. Только
 * украшения — на работу приложения не влияют, мышь и нажатия проходят
 * сквозь них. Анимации выключаются, если в системе включено «уменьшить
 * движение» (styles.css).
 */

export function Pumpkin({ className = "", lit = false }: { className?: string; lit?: boolean }) {
  const face = lit ? "#ffd65a" : "#3a1d06";
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
      <path d="M31 13c-1-5 2-9 7-10l1 4c-3 1-4 3-4 6z" fill="#5f8f2f" />
      <ellipse cx="21" cy="37" rx="15" ry="19" fill="#e8690f" />
      <ellipse cx="43" cy="37" rx="15" ry="19" fill="#e8690f" />
      <ellipse cx="32" cy="37" rx="13" ry="21" fill="#ff8a1f" />
      <path d="M32 16v42M22 19c-4 8-4 28 0 36M42 19c4 8 4 28 0 36" stroke="#c9550a" strokeWidth="1.6" fill="none" opacity=".55" />
      <path d="M20 30l7 1-4 6zM44 30l-7 1 4 6z" fill={face} />
      <path d="M30 38h4l-2 4z" fill={face} />
      <path d="M18 45c4 5 9 7 14 7s10-2 14-7l-4 1-2 3-3-3-5 3-5-3-3 3-2-3z" fill={face} />
    </svg>
  );
}

export function Bat({ className = "" }: { className?: string }) {
  const wing = "M29 12C22 4 12 2 2 6c5 2 6 6 5 10 3-2 7-1 9 2 2-3 6-3 8 0 1-3 3-3 5-1z";
  return (
    <svg aria-hidden="true" viewBox="0 0 64 26" className={className}>
      <g fill="currentColor">
        <path d={wing} />
        <path d={wing} transform="translate(64 0) scale(-1 1)" />
        <ellipse cx="32" cy="13" rx="4.2" ry="6.5" />
        <path d="M28.6 8.5l.6-4.5 2.2 3.4zM35.4 8.5l-.6-4.5-2.2 3.4z" />
      </g>
    </svg>
  );
}

export function Spider({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={className}>
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M14 18c-5-3-8-2-11 2M14 21c-5-1-8 1-10 5M15 24c-4 1-6 4-7 8M16 26c-2 2-3 5-3 9" />
        <path d="M26 18c5-3 8-2 11 2M26 21c5-1 8 1 10 5M25 24c4 1 6 4 7 8M24 26c2 2 3 5 3 9" />
      </g>
      <circle cx="20" cy="23" r="7" fill="currentColor" />
      <circle cx="20" cy="14" r="4.5" fill="currentColor" />
      <circle cx="18.3" cy="13.4" r="1" fill="#ff8a1f" />
      <circle cx="21.7" cy="13.4" r="1" fill="#ff8a1f" />
    </svg>
  );
}

const WEB =
  "M0 0L118 0M0 0L112.2 36.5M0 0L95.5 69.4M0 0L69.4 95.5M0 0L36.5 112.2M0 0L0 118" +
  "M22 0Q18.5 2.9 20.9 6.8Q16.7 8.5 17.8 12.9Q13.2 13.2 12.9 17.8Q8.5 16.7 6.8 20.9Q2.9 18.5 0 22" +
  "M42 0Q35.2 5.6 39.9 13Q31.8 16.2 34 24.7Q25.2 25.2 24.7 34Q16.2 31.8 13 39.9Q5.6 35.2 0 42" +
  "M62 0Q52 8.2 59 19.2Q46.9 23.9 50.2 36.4Q37.2 37.2 36.4 50.2Q23.9 46.9 19.2 59Q8.2 52 0 62" +
  "M84 0Q70.5 11.2 79.9 26Q63.6 32.4 68 49.4Q50.5 50.5 49.4 68Q32.4 63.6 26 79.9Q11.2 70.5 0 84" +
  "M108 0Q90.6 14.4 102.7 33.4Q81.7 41.6 87.4 63.5Q64.9 64.9 63.5 87.4Q41.6 81.7 33.4 102.7Q14.4 90.6 0 108";

export function Cobweb({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 120" className={className}>
      <path d={WEB} stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

/** Украшения поверх страницы: паутина в углу и паук на нити. */
export function SeasonDecor() {
  const { active } = useSeason();
  if (active !== "halloween") return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top,0px)+61px)] z-[5] h-0 max-md:hidden">
      <Cobweb className="hw-web absolute left-0 top-0 size-[150px]" />
      <div className="hw-spider absolute right-[7%] top-0">
        <span className="hw-thread" />
        <Spider className="hw-spider-body size-8" />
      </div>
    </div>
  );
}

/** Летучие мыши для главной (в приветствии). */
export function Bats() {
  return (
    <span aria-hidden="true" className="hw-bats pointer-events-none absolute -top-6 right-0 flex gap-6 max-md:-top-4">
      <Bat className="hw-bat size-12 text-[var(--hw-bat)] max-md:size-9" />
      <Bat className="hw-bat hw-bat-2 size-8 text-[var(--hw-bat)] max-md:size-6" />
      <Bat className="hw-bat hw-bat-3 size-10 text-[var(--hw-bat)] max-md:size-7" />
    </span>
  );
}
