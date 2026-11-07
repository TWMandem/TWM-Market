import assert from "node:assert/strict";
import test from "node:test";
import { feedbackCreateSchema, feedbackUpdateSchema } from "./feedback.js";

test("предложение требует понятный заголовок и подробное описание", () => {
  assert.equal(feedbackCreateSchema.safeParse({ category: "improvement", title: "Идея", description: "Слишком коротко" }).success, false);
  const parsed = feedbackCreateSchema.parse({
    category: "problem",
    title: "Улучшить поиск по каталогу",
    description: "Добавьте сохранение последних выбранных фильтров между запусками.",
  });
  assert.equal(parsed.category, "problem");
});

test("администратор может поставить только известный статус", () => {
  assert.equal(feedbackUpdateSchema.safeParse({ status: "planned", response: "Добавим в следующей версии" }).success, true);
  assert.equal(feedbackUpdateSchema.safeParse({ status: "maybe", response: "" }).success, false);
});

