/**
 * «Суммы как в игре»: тот же разбор цены, что в приложении
 * (packages/shared/src/price.ts), результат — на перекидном табло.
 * Когда блок впервые появляется на экране, пример набирается сам.
 */
import { formatPriceShort, groupDigits, parsePrice } from "../../../packages/shared/src/price.ts";
import { flapGroup, flipCell, reduced } from "./flaps.js";

const MAX_CELLS = 19; // «1 000 000 000 000 ₽» — самая большая сумма
const MIN_CELL = 17; // уже клетки читаются плохо — тогда клеток меньше, сумма короче

export function initPrice() {
  const root = document.querySelector("[data-price]");
  if (!root) return;
  const input = root.querySelector("[data-price-input]");
  const boardEl = root.querySelector("[data-price-board]");
  const note = root.querySelector("[data-price-note]");
  let flaps = null;
  let cells = 0;
  let touched = false;
  let last = "";

  /** Сколько клеток помещается и какого они размера. */
  const fitCells = () => {
    const width = boardEl.clientWidth;
    const count = Math.max(10, Math.min(MAX_CELLS, Math.floor((width + 3) / (MIN_CELL + 3))));
    const cw = Math.max(MIN_CELL, Math.min(30, Math.floor((width + 3) / count) - 3));
    boardEl.style.setProperty("--cw", `${cw}px`);
    boardEl.style.setProperty("--ch", `${Math.round(cw * 1.5)}px`);
    if (count !== cells) {
      cells = count;
      flaps = flapGroup(cells);
      boardEl.replaceChildren(flaps);
      if (last) show(last, true);
    }
  };

  function show(text, instant = false) {
    last = text;
    const value = text.trim() ? parsePrice(text) : null;
    let line = "";
    if (value !== null) {
      const short = formatPriceShort(value).replace(/\s/g, " ");
      line = `${groupDigits(value).replace(/\s/g, " ")} ₽`;
      if (line.length > cells) line = short.toUpperCase();
      note.textContent = `${short} — столько и будет в объявлении`;
      note.removeAttribute("data-error");
    } else if (text.trim()) {
      line = "НЕ ПОНЯЛ";
      note.textContent = "Не понимаю сумму. Пример: 500к, 2.5кк, 18 000 000";
      note.setAttribute("data-error", "");
    } else {
      note.textContent = "";
      note.removeAttribute("data-error");
    }
    const chars = [...line.padStart(cells)];
    [...flaps.children].forEach((cell, i) =>
      instant ? (cell.firstChild.textContent = chars[i]) : flipCell(cell, chars[i], (cells - i) * 18, 3 + Math.floor(Math.random() * 4)),
    );
  }

  fitCells();
  new ResizeObserver(fitCells).observe(boardEl);

  let timer = 0;
  input.addEventListener("input", () => {
    touched = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(input.value), 140);
  });
  for (const chip of root.querySelectorAll("[data-example]")) {
    chip.addEventListener("click", () => {
      touched = true;
      input.value = chip.dataset.example;
      show(input.value);
      input.focus();
    });
  }

  // Первое появление на экране: пример «набирается» сам, если посетитель ещё ничего не трогал.
  const demo = "2.5кк";
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      if (touched) return;
      if (reduced()) {
        input.value = demo;
        show(demo);
        return;
      }
      let i = 0;
      const type = () => {
        if (touched) return;
        i += 1;
        input.value = demo.slice(0, i);
        if (i < demo.length) window.setTimeout(type, 160);
        else show(demo);
      };
      window.setTimeout(type, 400);
    },
    { threshold: 0.6 },
  );
  observer.observe(root);
}
