/**
 * Праздничное оформление сайта (например, на Хеллоуин в игре). Включает
 * администратор в админ-панели приложения; сайт узнаёт о нём из /stats.json.
 * Только украшения: без них сайт выглядит и работает как обычно.
 */

const NS = "http://www.w3.org/2000/svg";

const PUMPKIN = `
  <path d="M31 13c-1-5 2-9 7-10l1 4c-3 1-4 3-4 6z" fill="#5f8f2f"/>
  <ellipse cx="21" cy="37" rx="15" ry="19" fill="#e8690f"/>
  <ellipse cx="43" cy="37" rx="15" ry="19" fill="#e8690f"/>
  <ellipse cx="32" cy="37" rx="13" ry="21" fill="#ff8a1f"/>
  <path d="M32 16v42M22 19c-4 8-4 28 0 36M42 19c4 8 4 28 0 36" stroke="#c9550a" stroke-width="1.6" fill="none" opacity=".55"/>
  <path d="M20 30l7 1-4 6zM44 30l-7 1 4 6zM30 38h4l-2 4zM18 45c4 5 9 7 14 7s10-2 14-7l-4 1-2 3-3-3-5 3-5-3-3 3-2-3z" fill="#ffd65a"/>`;

const WING = "M29 12C22 4 12 2 2 6c5 2 6 6 5 10 3-2 7-1 9 2 2-3 6-3 8 0 1-3 3-3 5-1z";
const BAT = `<g fill="currentColor"><path d="${WING}"/><path d="${WING}" transform="translate(64 0) scale(-1 1)"/>
  <ellipse cx="32" cy="13" rx="4.2" ry="6.5"/><path d="M28.6 8.5l.6-4.5 2.2 3.4zM35.4 8.5l-.6-4.5-2.2 3.4z"/></g>`;

const WEB =
  "M0 0L118 0M0 0L112.2 36.5M0 0L95.5 69.4M0 0L69.4 95.5M0 0L36.5 112.2M0 0L0 118" +
  "M22 0Q18.5 2.9 20.9 6.8Q16.7 8.5 17.8 12.9Q13.2 13.2 12.9 17.8Q8.5 16.7 6.8 20.9Q2.9 18.5 0 22" +
  "M42 0Q35.2 5.6 39.9 13Q31.8 16.2 34 24.7Q25.2 25.2 24.7 34Q16.2 31.8 13 39.9Q5.6 35.2 0 42" +
  "M62 0Q52 8.2 59 19.2Q46.9 23.9 50.2 36.4Q37.2 37.2 36.4 50.2Q23.9 46.9 19.2 59Q8.2 52 0 62" +
  "M84 0Q70.5 11.2 79.9 26Q63.6 32.4 68 49.4Q50.5 50.5 49.4 68Q32.4 63.6 26 79.9Q11.2 70.5 0 84" +
  "M108 0Q90.6 14.4 102.7 33.4Q81.7 41.6 87.4 63.5Q64.9 64.9 63.5 87.4Q41.6 81.7 33.4 102.7Q14.4 90.6 0 108";

const SPIDER = `<g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round">
  <path d="M14 18c-5-3-8-2-11 2M14 21c-5-1-8 1-10 5M15 24c-4 1-6 4-7 8M16 26c-2 2-3 5-3 9"/>
  <path d="M26 18c5-3 8-2 11 2M26 21c5-1 8 1 10 5M25 24c4 1 6 4 7 8M24 26c2 2 3 5 3 9"/></g>
  <circle cx="20" cy="23" r="7" fill="currentColor"/><circle cx="20" cy="14" r="4.5" fill="currentColor"/>
  <circle cx="18.3" cy="13.4" r="1" fill="#ff8a1f"/><circle cx="21.7" cy="13.4" r="1" fill="#ff8a1f"/>`;

/** Рисунок из нашей же разметки (не из ответа сервера). */
function svg(viewBox, inner, className) {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", className);
  el.innerHTML = inner;
  return el;
}

function halloween() {
  document.documentElement.dataset.season = "halloween";

  // Тыква у логотипа.
  const logo = document.querySelector('header a[href="/"] img');
  if (logo?.parentElement) {
    const wrap = document.createElement("span");
    wrap.className = "hw-logo";
    logo.replaceWith(wrap);
    wrap.append(logo, svg("0 0 64 64", PUMPKIN, "hw-logo-pumpkin"));
  }

  // Паутина в углу и паук на нити — поверх страницы, клики проходят насквозь.
  const layer = document.createElement("div");
  layer.className = "hw-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.append(svg("0 0 120 120", `<path d="${WEB}" stroke="currentColor" stroke-width="1" fill="none"/>`, "hw-web"));
  const spider = document.createElement("div");
  spider.className = "hw-spider";
  const thread = document.createElement("span");
  thread.className = "hw-thread";
  spider.append(thread, svg("0 0 40 40", SPIDER, "hw-spider-body"));
  layer.append(spider);
  const small = document.createElement("div");
  small.className = "hw-spider hw-spider-2";
  const thread2 = document.createElement("span");
  thread2.className = "hw-thread";
  small.append(thread2, svg("0 0 40 40", SPIDER, "hw-spider-body hw-spider-small"));
  layer.append(small);
  document.body.append(layer);

  mist();
  let counter = null;

  // Летучие мыши и тыквы на первом экране главной, под ним — сцена.
  const hero = document.querySelector("section.hero");
  if (hero) {
    counter = sceneStrip(hero);
    const bats = document.createElement("div");
    bats.className = "hw-bats";
    bats.setAttribute("aria-hidden", "true");
    for (const size of ["hw-bat-1", "hw-bat-2", "hw-bat-3", "hw-bat-4"]) bats.append(svg("0 0 64 26", BAT, `hw-bat ${size}`));
    hero.append(bats);
    const pumpkins = document.createElement("div");
    pumpkins.className = "hw-pumpkins";
    pumpkins.setAttribute("aria-hidden", "true");
    pumpkins.append(svg("0 0 64 64", PUMPKIN, "hw-pumpkin-big"), svg("0 0 64 64", PUMPKIN, "hw-pumpkin-small"));
    hero.append(pumpkins);
  }
  ghostHunt(counter);
}

const GHOST = `<path d="M20 3c9.5 0 17 7.5 17 18v22l-4.2-3.4-4.2 3.4-4.2-3.4-4.2 3.4-4.2-3.4-4.2 3.4-4.2-3.4L3 43V21C3 10.5 10.5 3 20 3z" fill="#f4efff"/>
  <ellipse cx="14" cy="19" rx="2.6" ry="3.6" fill="#1b1028"/><ellipse cx="26" cy="19" rx="2.6" ry="3.6" fill="#1b1028"/><ellipse cx="20" cy="28" rx="3" ry="4" fill="#1b1028"/>`;

const BOO = ["Бу!", "Попался!", "Ой!", "У-у-у!", "Пойман!"];
const CAUGHT_KEY = "twm:ghosts-caught";

function caught() {
  try {
    return Number(localStorage.getItem(CAUGHT_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Туман у нижнего края и искры — за содержимым страницы. */
function mist() {
  const layer = document.createElement("div");
  layer.className = "hw-mist";
  layer.setAttribute("aria-hidden", "true");
  for (const name of ["hw-fog hw-fog-1", "hw-fog hw-fog-2"]) {
    const fog = document.createElement("span");
    fog.className = name;
    layer.append(fog);
  }
  for (let i = 0; i < 16; i++) {
    const ember = document.createElement("span");
    ember.className = "hw-ember";
    // CSSOM разрешён политикой безопасности сайта (в отличие от атрибута style).
    ember.style.setProperty("left", `${(i * 61) % 100}%`);
    ember.style.setProperty("animation-delay", `${-((i * 1.7) % 9).toFixed(1)}s`);
    ember.style.setProperty("animation-duration", `${7 + ((i * 3) % 6)}s`);
    ember.style.setProperty("width", `${3 + (i % 3)}px`);
    ember.style.setProperty("height", `${3 + (i % 3)}px`);
    layer.append(ember);
  }
  document.body.append(layer);
}

/** «Поймай призрака»: раз в 25–50 секунд через экран пролетает призрак. */
function ghostHunt(counter) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const show = () => {
    if (document.visibilityState !== "visible") return;
    const fromLeft = Math.random() < 0.5;
    const flight = document.createElement("div");
    flight.className = `hw-ghost-flight ${fromLeft ? "hw-from-left" : "hw-from-right"}`;
    flight.style.setProperty("top", `${18 + Math.random() * 52}%`);
    flight.style.setProperty("animation-duration", `${11 + Math.random() * 5}s`);
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = "hw-ghost";
    button.setAttribute("aria-label", "Поймать призрака");
    button.title = "Поймай меня!";
    const size = 44 + Math.round(Math.random() * 22);
    button.style.setProperty("width", `${size}px`);
    button.style.setProperty("height", `${Math.round(size * 1.15)}px`);
    button.append(svg("0 0 40 46", GHOST, fromLeft ? "hw-ghost-svg" : "hw-ghost-svg hw-mirror"));
    button.addEventListener("click", () => {
      const rect = button.getBoundingClientRect();
      try {
        localStorage.setItem(CAUGHT_KEY, String(caught() + 1));
      } catch {
        // без хранилища счёт не сохранится
      }
      counter?.();
      const boo = document.createElement("span");
      boo.className = "hw-boo";
      boo.setAttribute("aria-hidden", "true");
      boo.textContent = BOO[Math.floor(Math.random() * BOO.length)];
      boo.style.setProperty("left", `${rect.left + rect.width / 2}px`);
      boo.style.setProperty("top", `${rect.top}px`);
      document.body.append(boo);
      setTimeout(() => boo.remove(), 1100);
      flight.remove();
    });
    flight.append(button);
    flight.addEventListener("animationend", () => flight.remove());
    document.body.append(flight);
  };
  const schedule = (delay) =>
    setTimeout(() => {
      show();
      schedule(25000 + Math.random() * 25000);
    }, delay);
  schedule(6000);
}

/** Полоса со сценой (луна, ведьма, дом с привидениями) после первого экрана главной. */
function sceneStrip(hero) {
  const strip = document.createElement("section");
  strip.className = "hw-strip";
  strip.setAttribute("aria-label", "Хеллоуин");
  const img = document.createElement("img");
  img.src = "/img/halloween-scene.svg";
  img.alt = "";
  img.className = "hw-strip-scene";
  const text = document.createElement("div");
  text.className = "hw-strip-text";
  const kicker = document.createElement("span");
  kicker.className = "hw-strip-kicker";
  kicker.textContent = "ХЕЛЛОУИН В ИГРЕ";
  const title = document.createElement("b");
  title.className = "hw-strip-title";
  title.textContent = "Ночь, когда цены пугают меньше всего";
  const note = document.createElement("span");
  note.className = "hw-strip-note";
  note.textContent = "По сайту и приложению бродят призраки — заметите пролетающего, нажмите и поймайте.";
  const score = document.createElement("span");
  score.className = "hw-strip-score";
  const update = () => {
    const n = caught();
    score.textContent = n === 0 ? "Призраков пока не поймано" : `Поймано призраков: ${n}`;
  };
  update();
  text.append(kicker, title, note, score);
  strip.append(img, text);
  hero.after(strip);
  return update;
}

export async function initSeason() {
  try {
    const response = await fetch("/stats.json");
    if (!response.ok) return;
    const stats = await response.json();
    if (stats?.season === "halloween") halloween();
  } catch {
    // Сервер недоступен — обычное оформление.
  }
}
