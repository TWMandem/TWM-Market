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

test("последний раз в сети", async () => {
  const { lastSeenText } = await import("./chat.js");
  const now = new Date(2026, 10, 4, 12, 0).getTime();
  assert.equal(lastSeenText(null, now), null);
  assert.equal(lastSeenText(new Date(now - 60_000).toISOString(), now), "в сети");
  assert.equal(lastSeenText(new Date(now - 20 * 60_000).toISOString(), now), "был(а) 20 мин назад");
  assert.equal(lastSeenText(new Date(2026, 10, 4, 9, 5).toISOString(), now), "был(а) сегодня в 09:05");
  assert.equal(lastSeenText(new Date(2026, 10, 3, 21, 40).toISOString(), now), "был(а) вчера в 21:40");
  assert.equal(lastSeenText(new Date(2026, 9, 31, 10, 0).toISOString(), now), "был(а) 4 дн. назад");
  assert.equal(lastSeenText(new Date(2026, 5, 1).toISOString(), now), "был(а) давно");
});

test("надёжный продавец", async () => {
  const { isTrustedSeller } = await import("./chat.js");
  assert.equal(isTrustedSeller({ deals: 5, positive: 9, negative: 1, accountDays: 14 }), true);
  assert.equal(isTrustedSeller({ deals: 4, positive: 9, negative: 0, accountDays: 30 }), false, "мало сделок");
  assert.equal(isTrustedSeller({ deals: 10, positive: 8, negative: 2, accountDays: 30 }), false, "80% положительных");
  assert.equal(isTrustedSeller({ deals: 10, positive: 10, negative: 0, accountDays: 5 }), false, "новый аккаунт");
  assert.equal(isTrustedSeller({ deals: 10, positive: 0, negative: 0, accountDays: 30 }), false, "без отзывов");
});
