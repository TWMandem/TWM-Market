import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchParams, savedSearchSchema } from "./stats.js";

test("параметры подписки: без страницы, сортировки и пустых значений, ключи по алфавиту", () => {
  assert.equal(normalizeSearchParams("server=3&page=2&sort=price_asc&category=5&q=&priceMax=100"), "category=5&priceMax=100&server=3");
  assert.equal(normalizeSearchParams("a.color=Красный&q= меч "), "a.color=%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D1%8B%D0%B9&q=%D0%BC%D0%B5%D1%87");
  assert.equal(normalizeSearchParams(""), "");
});

test("подписка: имя обязательно, параметры приводятся к одному виду", () => {
  const ok = savedSearchSchema.parse({ name: " Оружие ", section: "items", params: "sort=new&category=1" });
  assert.deepEqual(ok, { name: "Оружие", section: "items", params: "category=1", notify: true });
  assert.equal(savedSearchSchema.safeParse({ name: "", section: "items", params: "" }).success, false);
  assert.equal(savedSearchSchema.safeParse({ name: "x", section: "garage", params: "" }).success, false);
});
