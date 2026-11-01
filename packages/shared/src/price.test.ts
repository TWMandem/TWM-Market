import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PRICE, formatPrice, formatPriceShort, parsePrice } from "./price.js";

const NBSP = " ";

test("обычные числа и разделители разрядов", () => {
  assert.equal(parsePrice("18200000"), 18_200_000);
  assert.equal(parsePrice("18 200 000"), 18_200_000);
  assert.equal(parsePrice(`18${NBSP}200${NBSP}000 ₽`), 18_200_000);
  assert.equal(parsePrice("18.200.000"), 18_200_000);
  assert.equal(parsePrice("18,200,000"), 18_200_000);
  assert.equal(parsePrice("1.500"), 1_500);
  assert.equal(parsePrice("950 руб."), 950);
});

test("игровые сокращения", () => {
  assert.equal(parsePrice("500к"), 500_000);
  assert.equal(parsePrice("500k"), 500_000);
  assert.equal(parsePrice("18.2кк"), 18_200_000);
  assert.equal(parsePrice("18,2кк"), 18_200_000);
  assert.equal(parsePrice("18,2 КК"), 18_200_000);
  assert.equal(parsePrice("2.35kk"), 2_350_000);
  assert.equal(parsePrice("1,5ккк"), 1_500_000_000);
  assert.equal(parsePrice("18 млн"), 18_000_000);
  assert.equal(parsePrice("3 ляма"), 3_000_000);
  assert.equal(parsePrice("1.25 млрд"), 1_250_000_000);
  assert.equal(parsePrice("640 тыс"), 640_000);
});

test("без ошибок округления дробей", () => {
  assert.equal(parsePrice("0.1кк"), 100_000);
  assert.equal(parsePrice("1.1кк"), 1_100_000);
  assert.equal(parsePrice("4.35кк"), 4_350_000);
});

test("отклоняет неверные значения", () => {
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("   "), null);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice("0"), null);
  assert.equal(parsePrice("-500"), null);
  assert.equal(parsePrice("18.5"), null, "дробные рубли");
  assert.equal(parsePrice("1.0005к"), null, "дробные рубли после умножения");
  assert.equal(parsePrice("12 xyz"), null);
  assert.equal(parsePrice(String(MAX_PRICE + 1)), null);
  assert.equal(parsePrice("5 + 5"), null);
});

test("полный формат", () => {
  assert.equal(formatPrice(18_200_000), `18${NBSP}200${NBSP}000${NBSP}₽`);
  assert.equal(formatPrice(950), `950${NBSP}₽`);
});

test("короткий формат", () => {
  assert.equal(formatPriceShort(18_200_000), `18,2${NBSP}млн${NBSP}₽`);
  assert.equal(formatPriceShort(41_000_000), `41${NBSP}млн${NBSP}₽`);
  assert.equal(formatPriceShort(640_000), `640${NBSP}тыс${NBSP}₽`);
  assert.equal(formatPriceShort(1_250_000_000), `1,25${NBSP}млрд${NBSP}₽`);
  assert.equal(formatPriceShort(9_500), `9${NBSP}500${NBSP}₽`);
});
