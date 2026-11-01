import { test } from "node:test";
import assert from "node:assert/strict";
import { findStopWord, reportSchema, stopWordSchema } from "./chat.js";

// Те же правила, что заложены в миграции 0008.
const words = [
  { phrase: "реальные деньги", isRegex: false },
  { phrase: "на карту", isRegex: false },
  { phrase: "(?:\\d[ -]?){15}\\d", isRegex: true },
  { phrase: "(https?://|www\\.)", isRegex: true },
  { phrase: "(t\\.me|vk\\.com|discord\\.gg)/", isRegex: true },
];

test("стоп-слова: фразы без учёта регистра, номера карт, ссылки", () => {
  assert.equal(findStopWord("Продам за РЕАЛЬНЫЕ деньги", words)?.phrase, "реальные деньги");
  assert.equal(findStopWord("скину НА КАРТУ", words)?.phrase, "на карту");
  assert.ok(findStopWord("карта 2202 2000 1234 5678", words));
  assert.ok(findStopWord("пиши в t.me/seller", words));
  assert.ok(findStopWord("смотри https://example.com", words));
  assert.equal(findStopWord("Продам BMW M5, цена 18кк, торг", words), null);
  assert.equal(findStopWord("Номер 777-77-77, ID 129787", words), null, "короткие числа не номер карты");
});

test("стоп-слово: неверное регулярное выражение не сохраняется", () => {
  assert.equal(stopWordSchema.safeParse({ phrase: "([a-z", isRegex: true }).success, false);
  assert.equal(stopWordSchema.safeParse({ phrase: "([a-z", isRegex: false }).success, true);
});

test("жалоба «другое» требует пояснения", () => {
  assert.equal(reportSchema.safeParse({ targetType: "listing", targetId: "x", reason: "other" }).success, false);
  assert.equal(reportSchema.safeParse({ targetType: "listing", targetId: "x", reason: "scam" }).success, true);
});
