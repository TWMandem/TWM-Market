import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useSeason } from "../lib/season";
import { readSetting, writeSetting } from "../lib/storage";

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

/** Украшения поверх страницы: паутина, паук, туман с искрами и призраки. */
export function SeasonDecor() {
  const { active } = useSeason();
  if (active !== "halloween") return null;
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top,0px)+61px)] z-[5] h-0 max-md:hidden">
        <Cobweb className="hw-web absolute left-0 top-0 size-[150px]" />
        <Cobweb className="hw-web hw-web-right absolute right-0 top-0 size-[110px]" />
        <div className="hw-spider absolute right-[7%] top-0">
          <span className="hw-thread" />
          <Spider className="hw-spider-body size-8" />
        </div>
        <div className="hw-spider hw-spider-2 absolute left-[38%] top-0">
          <span className="hw-thread" />
          <Spider className="hw-spider-body size-5" />
        </div>
      </div>
      <Mist />
      <GhostHunt />
    </>
  );
}

/** Туман у нижнего края и искры, поднимающиеся от тыкв, — за содержимым страницы. */
const EMBERS = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 61) % 100}%`,
  delay: `${-((i * 1.7) % 9).toFixed(1)}s`,
  duration: `${7 + ((i * 3) % 6)}s`,
  size: `${3 + (i % 3)}px`,
}));

function Mist() {
  return (
    <div aria-hidden="true" className="hw-mist pointer-events-none fixed inset-x-0 bottom-0 z-0 h-[42vh]">
      <span className="hw-fog hw-fog-1" />
      <span className="hw-fog hw-fog-2" />
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="hw-ember"
          style={{ left: e.left, animationDelay: e.delay, animationDuration: e.duration, width: e.size, height: e.size } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function Ghost({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 46" className={className}>
      <path d="M20 3c9.5 0 17 7.5 17 18v22l-4.2-3.4-4.2 3.4-4.2-3.4-4.2 3.4-4.2-3.4-4.2 3.4-4.2-3.4L3 43V21C3 10.5 10.5 3 20 3z" fill="#f4efff" />
      <ellipse cx="14" cy="19" rx="2.6" ry="3.6" fill="#1b1028" />
      <ellipse cx="26" cy="19" rx="2.6" ry="3.6" fill="#1b1028" />
      <ellipse cx="20" cy="28" rx="3" ry="4" fill="#1b1028" />
    </svg>
  );
}

const CAUGHT_KEY = "ghostsCaught";
export const GHOST_EVENT = "twm:ghost-caught";

export function ghostsCaught(): number {
  return Number(readSetting(CAUGHT_KEY) ?? 0) || 0;
}

/** Сколько призраков поймано на этом устройстве (обновляется сразу). */
export function useGhostsCaught(): number {
  const [count, setCount] = useState(ghostsCaught);
  useEffect(() => {
    const update = () => setCount(ghostsCaught());
    window.addEventListener(GHOST_EVENT, update);
    return () => window.removeEventListener(GHOST_EVENT, update);
  }, []);
  return count;
}

interface Flight {
  id: number;
  top: number;
  fromLeft: boolean;
  size: number;
  duration: number;
}

const BOO = ["Бу!", "Попался!", "Ой!", "У-у-у!", "Пойман!"];

/**
 * «Поймай призрака»: время от времени через экран пролетает призрак. Нажатие —
 * поймал, счёт хранится на этом устройстве. Не мешает: появляется не чаще
 * раза в 25–50 секунд, только когда приложение на экране, и не появляется,
 * если в системе включено «уменьшить движение».
 */
function GhostHunt() {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [boo, setBoo] = useState<{ x: number; y: number; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(1);

  useEffect(() => {
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      // нет matchMedia — призраки летают
    }
    if (reduced) return;
    const schedule = (delay: number) => {
      timer.current = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          setFlight({
            id: nextId.current++,
            top: 18 + Math.random() * 52,
            fromLeft: Math.random() < 0.5,
            size: 44 + Math.round(Math.random() * 22),
            duration: 11 + Math.random() * 5,
          });
        }
        schedule(25_000 + Math.random() * 25_000);
      }, delay);
    };
    schedule(7_000);
    // Для проверки (снимки в CI): выпустить призрака сразу.
    const now = () =>
      setFlight({ id: nextId.current++, top: 40, fromLeft: true, size: 60, duration: 14 });
    window.addEventListener("twm:ghost-now", now);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("twm:ghost-now", now);
    };
  }, []);

  const catchGhost = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    writeSetting(CAUGHT_KEY, String(ghostsCaught() + 1));
    window.dispatchEvent(new Event(GHOST_EVENT));
    setBoo({ x: rect.left + rect.width / 2, y: rect.top, text: BOO[Math.floor(Math.random() * BOO.length)]! });
    setFlight(null);
    window.setTimeout(() => setBoo(null), 1100);
  };

  return (
    <>
      {flight && (
        <div
          key={flight.id}
          className={`hw-ghost-flight ${flight.fromLeft ? "hw-from-left" : "hw-from-right"}`}
          style={{ top: `${flight.top}%`, animationDuration: `${flight.duration}s` } as CSSProperties}
          onAnimationEnd={() => setFlight(null)}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Поймать призрака"
            title="Поймай меня!"
            onClick={catchGhost}
            className="hw-ghost"
            style={{ width: flight.size, height: flight.size * 1.15 }}
          >
            <Ghost className={`size-full ${flight.fromLeft ? "" : "-scale-x-100"}`} />
          </button>
        </div>
      )}
      {boo && (
        <span aria-hidden="true" className="hw-boo" style={{ left: boo.x, top: boo.y }}>
          {boo.text}
        </span>
      )}
    </>
  );
}

/** Ведьмина шляпа — на аватар в шапке. */
export function WitchHat({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 40" className={className}>
      <path d="M8 32c6-1 10-2 12-8L28 2c1 10 4 18 10 22 2 2 3 5 2 8z" fill="#2a1840" />
      <path d="M17 27c5 2 13 2 20 0l1 4c-7 2-15 2-22 0z" fill="#ff8a1f" />
      <ellipse cx="24" cy="33" rx="23" ry="5" fill="#1d1030" />
      <path d="M27 6l3-1-1 3" fill="#ffd65a" />
    </svg>
  );
}

/** Ведьма на метле (силуэт), летит влево. */
export function Witch({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="-4 -20 104 58" className={className}>
      <g fill="#0b0612" transform="translate(96 0) scale(-1 1)">
        <path d="M0 30 L78 22" stroke="#0b0612" strokeWidth="3" strokeLinecap="round" />
        <path d="M74 22 l22 -9 l-4 9 l5 6 l-23 -2z" />
        <path d="M30 26 C 28 14, 40 6, 48 10 C 54 14, 56 22, 52 28 z" />
        <path d="M48 12 C 58 14, 66 20, 70 28 L 60 24 z" />
        <circle cx="36" cy="6" r="5" />
        <path d="M27 2 L46 0 L35 -16 z" />
        <path d="M24 3 L48 1" stroke="#0b0612" strokeWidth="3" strokeLinecap="round" />
        <path d="M33 26 l-6 8 M40 26 l-2 9" stroke="#0b0612" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const STARS = [
  [8, 12], [17, 30], [26, 8], [41, 22], [52, 6], [63, 27], [71, 12], [88, 20], [94, 7], [33, 40],
] as const;

/**
 * Большая сцена: неподвижный рисунок (луна, дом с привидениями, кладбище,
 * тыквы) и поверх — движение лёгкими элементами: ведьма, стая летучих мышей,
 * мерцающие звёзды, туман. Анимируются только transform и opacity — это
 * делает видеокарта, рисунок заново не перерисовывается (бережёт батарею).
 */
export function HalloweenScene({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`hw-scene ${className}`}>
      <img src={`${import.meta.env.BASE_URL}halloween/scene.svg`} alt="" className="hw-scene-art" draggable={false} />
      {STARS.map(([left, top], i) => (
        <span key={i} className="hw-star" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-(i * 0.7)}s` } as CSSProperties} />
      ))}
      <div className="hw-witch-path">
        <Witch className="hw-witch" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`hw-flock hw-flock-${i}`}>
          <Bat className="hw-bat size-full text-[#0b0612]" />
        </div>
      ))}
      <span className="hw-scene-fog" />
    </div>
  );
}
