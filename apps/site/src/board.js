/**
 * Табло свежих объявлений на главной — как табло на вокзале или бирже:
 * буквы перелистываются, пока не встанут на место. Данные — /stats.json
 * (сервер API, без ников). Если объявлений пока мало, показывается пример
 * с пометкой «пример».
 */

const ALPHABET = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯABCDEFGHKLMNOPRSTUVXYZ0123456789";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Пример для пустой площадки: настоящие названия из справочника, цены условные. */
const SAMPLE = [
  { title: "Одежда Дедпул", price: 2_500_000, operation: "sell", server: { name: "RED", color: "#FF5A5F" }, minutes: 3 },
  { title: "Alfa Romeo Giulia", price: 18_200_000, operation: "sell", server: { name: "AZURE", color: "#3BC9DB" }, minutes: 11 },
  { title: "Кейс «Анимационный»", price: 120_000, operation: "buy", server: { name: "GREEN", color: "#3DDC84" }, minutes: 26 },
  { title: "Белая борода", price: 350_000, operation: "sell", server: { name: "TITAN", color: "#B197FC" }, minutes: 48 },
  { title: "Катана «Дедпула»", price: 900_000, operation: "sell", server: { name: "YELLOW", color: "#FFD43B" }, minutes: 75 },
  { title: "Дом", price: null, operation: "exchange", server: { name: "NIGHT", color: "#748FFC" }, minutes: 130 },
  { title: "Двойные катаны «Дедпула»", price: 1_400_000, operation: "buy", server: { name: "RED", color: "#FF5A5F" }, minutes: 190 },
  { title: "Кейс «Анимационный»", price: 115_000, operation: "sell", server: { name: "FIRE", color: "#FF922B" }, minutes: 260 },
];

const ROWS_DESKTOP = 7;
const ROWS_MOBILE = 5;

/** Ширина колонок в клетках — по ширине табло. */
function layoutFor(width) {
  if (width >= 980) return { title: 24, server: 6, price: 13, when: 6 };
  if (width >= 700) return { title: 18, server: 6, price: 12, when: 0 };
  // Узкий экран: цена под названием, клетки крупнее.
  return { title: 0, server: 0, price: 11, when: 0, stacked: true };
}

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
function shortPrice(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(".", ",")} МЛРД ₽`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/[.,]?0+$/, "").replace(".", ",")} МЛН ₽`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} ТЫС ₽`;
  return `${n} ₽`;
}
function priceText(item, cells) {
  if (item.operation === "exchange" || item.price === null) return "ОБМЕН";
  const full = `${group(item.price)} ₽`;
  return full.length <= cells ? full : shortPrice(item.price);
}
function whenText(minutes) {
  if (minutes < 2) return "СЕЙЧАС";
  if (minutes < 60) return `${minutes} МИН`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} Ч`;
  return `${Math.floor(minutes / 60 / 24)} ДН`;
}
function whenSpoken(minutes) {
  if (minutes < 2) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ч назад`;
  return `${Math.floor(minutes / 60 / 24)} дн назад`;
}
const fit = (text, cells, align = "left") => {
  let t = text.toUpperCase();
  if (t.length > cells) t = `${t.slice(0, cells - 1)}…`;
  return align === "right" ? t.padStart(cells) : t.padEnd(cells);
};
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Одна клетка: перелистывает несколько случайных букв и встаёт на нужную. */
function flipCell(cell, target, delay, steps) {
  const ch = cell.firstChild;
  if (ch.textContent === target) return;
  if (reduced()) {
    ch.textContent = target;
    return;
  }
  let left = target === " " && ch.textContent === " " ? 0 : steps;
  const tick = () => {
    cell.classList.remove("tick");
    void cell.offsetWidth; // перезапуск анимации
    cell.classList.add("tick");
    if (left > 0) {
      ch.textContent = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      left -= 1;
      cell._timer = window.setTimeout(tick, 70);
    } else {
      ch.textContent = target;
    }
  };
  window.clearTimeout(cell._timer);
  cell._timer = window.setTimeout(tick, delay);
}

function flapGroup(cells) {
  const wrap = document.createElement("span");
  wrap.className = "flaps";
  wrap.setAttribute("aria-hidden", "true");
  for (let i = 0; i < cells; i += 1) {
    const cell = document.createElement("span");
    cell.className = "flap";
    const ch = document.createElement("span");
    ch.className = "flap-ch";
    ch.textContent = " ";
    cell.append(ch);
    wrap.append(cell);
  }
  return wrap;
}

export function initBoard() {
  const board = document.querySelector("[data-board]");
  if (!board) return;
  const list = board.querySelector("[data-board-rows]");
  const status = board.querySelector("[data-board-status]");
  const foot = board.querySelector("[data-board-foot]");

  let items = [];
  let sample = false;
  let layout = null;
  let rows = [];
  let next = 0;
  let visible = true;

  const rowCount = () => (window.innerWidth < 700 ? ROWS_MOBILE : ROWS_DESKTOP);

  /** Размер клеток подбирается под ширину табло. */
  function build() {
    const width = list.clientWidth;
    layout = layoutFor(width);
    const stacked = Boolean(layout.stacked);
    delete layout.stacked;
    board.toggleAttribute("data-stacked", stacked);
    const gap = 2;
    const span = (n, cw) => n * cw + (n - 1) * gap;
    if (stacked) {
      // Одна колонка: по ширине помещается около 17 клеток.
      const cw = Math.max(12, Math.min(20, Math.floor((width - 16 + gap) / 17) - gap));
      layout.title = Math.floor((width - 16 + gap) / (cw + gap));
      board.style.setProperty("--cw", `${cw}px`);
      board.style.setProperty("--ch", `${Math.round(cw * 1.45)}px`);
      board.style.setProperty("--board-grid", "minmax(0,1fr)");
    } else {
      const cols = Object.entries(layout).filter(([, n]) => n > 0);
      const totalCells = cols.reduce((sum, [, n]) => sum + n, 0);
      const colGap = 18;
      const usable = width - 16 - colGap * (cols.length - 1) - gap * (totalCells - cols.length);
      const cw = Math.max(10, Math.min(26, Math.floor(usable / totalCells)));
      // Остаток ширины отдаём названию: строка заполняет табло целиком.
      const fixed = cols.filter(([key]) => key !== "title").reduce((sum, [, n]) => sum + span(n, cw), 0);
      const titleWidth = width - 16 - colGap * (cols.length - 1) - fixed;
      layout.title = Math.max(layout.title, Math.floor((titleWidth + gap) / (cw + gap)));
      board.style.setProperty("--cw", `${cw}px`);
      board.style.setProperty("--ch", `${Math.round(cw * 1.45)}px`);
      board.style.setProperty("--col-gap", `${colGap}px`);
      // Колонки заголовка той же ширины, что и клетки под ними.
      board.style.setProperty(
        "--board-grid",
        Object.entries(layout)
          .filter(([, n]) => n > 0)
          .map(([key, n]) => (key === "title" ? "minmax(0,1fr)" : `${span(n, cw)}px`))
          .join(" "),
      );
    }
    for (const label of board.querySelectorAll("[data-col-label]")) {
      label.hidden = !layout[label.dataset.colLabel];
    }

    const finalCols = Object.entries(layout).filter(([, n]) => n > 0);
    list.replaceChildren();
    rows = [];
    for (let i = 0; i < rowCount(); i += 1) {
      const li = document.createElement("li");
      li.className = "board-row";
      const parts = {};
      for (const [key, n] of finalCols) {
        const g = flapGroup(n);
        g.dataset.col = key;
        li.append(g);
        parts[key] = g;
      }
      const spoken = document.createElement("span");
      spoken.className = "sr-only";
      li.append(spoken);
      list.append(li);
      rows.push({ li, parts, spoken });
    }
  }

  /** Записать объявление в строку с перелистыванием. */
  function show(row, item, rowDelay) {
    const minutes = item.minutes ?? Math.max(0, Math.round((Date.now() - Date.parse(item.at)) / 60000));
    const texts = {
      title: fit(item.title, layout.title),
      server: layout.server ? fit(item.server.name, layout.server) : "",
      price: fit(priceText(item, layout.price), layout.price, "right"),
      when: layout.when ? fit(whenText(minutes), layout.when, "right") : "",
    };
    row.li.style.setProperty("--server", item.server.color);
    row.li.dataset.op = item.operation;
    const price = item.operation === "exchange" || item.price === null ? "обмен" : `${group(item.price)} ₽${item.operation === "buy" ? ", скупка" : ""}`;
    row.spoken.textContent = `${item.title}, сервер ${item.server.name}, ${price}, ${whenSpoken(minutes)}`;
    let col = 0;
    for (const [key, flaps] of Object.entries(row.parts)) {
      const chars = [...texts[key]];
      [...flaps.children].forEach((cell, i) => {
        flipCell(cell, chars[i] ?? " ", rowDelay + (col + i) * 22, 4 + Math.floor(Math.random() * 6));
      });
      col += flaps.children.length;
    }
  }

  function render(initial) {
    rows.forEach((row, i) => {
      const item = items[i % Math.max(items.length, 1)];
      if (item) show(row, item, initial ? 250 + i * 140 : 0);
    });
    next = rows.length;
  }

  /** Раз в несколько секунд одна строка сменяется следующим объявлением. */
  function rotate() {
    if (!visible || document.hidden || reduced() || items.length <= rows.length) return;
    const item = items[next % items.length];
    const row = rows[next % rows.length];
    next += 1;
    show(row, item, 0);
  }

  async function load() {
    let stats = null;
    try {
      const response = await fetch("/stats.json", { cache: "no-store" });
      if (response.ok) stats = await response.json();
    } catch {
      // сервера нет — будет пример
    }
    const live = Array.isArray(stats?.latest) ? stats.latest : [];
    sample = live.length < 5;
    items = sample ? SAMPLE : live;
    if (sample) {
      status.removeAttribute("data-live");
      status.textContent = "Пример: так табло выглядит, когда на площадке много объявлений";
    } else {
      status.setAttribute("data-live", "");
      status.textContent = "Обновляется каждую минуту";
    }
    if (stats && typeof stats.listings === "number" && stats.listings >= 30) {
      foot.textContent =
        `Сейчас на площадке ${stats.listings.toLocaleString("ru-RU")} ${plural(stats.listings, "объявление", "объявления", "объявлений")}` +
        ` от ${stats.sellers.toLocaleString("ru-RU")} ${plural(stats.sellers, "продавца", "продавцов", "продавцов")}`;
    } else {
      foot.textContent = "";
    }
  }

  const start = async () => {
    build();
    await load();
    render(true);
  };
  void start();

  window.setInterval(rotate, 3800);
  window.setInterval(async () => {
    if (document.hidden || sample) return;
    await load();
    render(false);
  }, 60_000);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  }).observe(board);

  let resizeTimer = 0;
  let lastWidth = list.clientWidth;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (Math.abs(list.clientWidth - lastWidth) < 40) return;
      lastWidth = list.clientWidth;
      build();
      render(false);
    }, 200);
  });
}
