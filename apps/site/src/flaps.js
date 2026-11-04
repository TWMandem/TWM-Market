/**
 * Клетки «перекидного табло»: буква перелистывается через несколько
 * случайных, пока не встанет на нужную. Используется табло на главной
 * и разбор суммы «как в игре».
 */

export const ALPHABET = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯABCDEFGHKLMNOPRSTUVXYZ0123456789";
export const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Одна клетка: перелистывает несколько случайных букв и встаёт на нужную. */
export function flipCell(cell, target, delay, steps) {
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

export function flapGroup(cells) {
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

