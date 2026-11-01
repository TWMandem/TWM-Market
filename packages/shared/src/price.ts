/**
 * Цены на площадке — это всегда игровые рубли, целое число.
 *
 * Игроки привыкли писать суммы сокращённо: «500к», «18.2кк», «1,5ккк», «18 млн».
 * parsePrice превращает такую запись в число, formatPrice и formatPriceShort
 * выводят число обратно в удобном для чтения виде.
 */

/** Верхняя граница цены: 1 триллион ₽. Защищает от опечаток и переполнения. */
export const MAX_PRICE = 1_000_000_000_000;

const NBSP = " ";

const MULTIPLIERS: ReadonlyArray<readonly [suffixes: readonly string[], value: number]> = [
  [["", "р", "руб", "₽"], 1],
  [["к", "k", "т", "тыс", "тысяч", "тысячи", "тысяча"], 1_000],
  [["кк", "kk", "м", "m", "млн", "миллион", "миллиона", "миллионов", "лям", "лямов", "ляма"], 1_000_000],
  [["ккк", "kkk", "млрд", "миллиард", "миллиарда", "миллиардов", "ярд", "ярда", "ярдов", "b"], 1_000_000_000],
];

function multiplierFor(suffix: string): number | null {
  for (const [suffixes, value] of MULTIPLIERS) {
    if (suffixes.includes(suffix)) return value;
  }
  return null;
}

/**
 * Разбирает цену, введённую игроком.
 * Возвращает целое число рублей или null, если запись не распознана
 * или сумма вне допустимого диапазона (1 … MAX_PRICE).
 */
export function parsePrice(input: string): number | null {
  if (typeof input !== "string") return null;

  let s = input
    .toLowerCase()
    .replace(/[\s   ]+/g, "")
    .replace(/(?:₽|руб\.?|р\.?)$/u, "");

  if (s === "") return null;

  // «18.200.000» или «18,200,000» — разделители разрядов.
  if (/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(s)) {
    s = s.replace(/[.,]/g, "");
  }

  const match = /^(\d+(?:[.,]\d+)?)([a-zа-яё]*)\.?$/u.exec(s);
  if (!match) return null;

  const numberPart = match[1] ?? "";
  const suffix = match[2] ?? "";

  const multiplier = multiplierFor(suffix);
  if (multiplier === null) return null;

  // «1.500» без суффикса — это полторы тысячи, а не полтора рубля.
  if (multiplier === 1 && /^\d{1,3}[.,]\d{3}$/.test(numberPart)) {
    return validate(Number(numberPart.replace(/[.,]/, "")));
  }

  const [intPart = "0", fracPart = ""] = numberPart.split(/[.,]/);
  // Считаем в целых числах, чтобы избежать ошибок округления 0.1 + 0.2.
  const scale = 10 ** fracPart.length;
  const scaled = Number(intPart) * scale + (fracPart ? Number(fracPart) : 0);
  const total = (scaled * multiplier) / scale;

  if (!Number.isInteger(total)) return null;
  return validate(total);
}

function validate(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PRICE) return null;
  return value;
}

/** Группирует разряды неразрывными пробелами: 18200000 → «18 200 000». */
export function groupDigits(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Полная запись цены: 18200000 → «18 200 000 ₽». */
export function formatPrice(value: number): string {
  return `${groupDigits(value)}${NBSP}₽`;
}

function trimDecimal(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.?0+$/, "").replace(".", ",");
}

/** Короткая запись для ленты и карточек: 18200000 → «18,2 млн ₽». */
export function formatPriceShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000, 2)}${NBSP}млрд${NBSP}₽`;
  if (abs >= 1_000_000) return `${trimDecimal(value / 1_000_000, 2)}${NBSP}млн${NBSP}₽`;
  if (abs >= 10_000) return `${trimDecimal(value / 1_000, 1)}${NBSP}тыс${NBSP}₽`;
  return formatPrice(value);
}
