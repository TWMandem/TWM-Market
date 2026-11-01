import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeCreateSchema } from "./admin.js";
import { buildAttributesSchema, type AttributeDefinition } from "./attributes.js";
import { fieldErrors } from "./auth.js";

const def = (overrides: Partial<AttributeDefinition>): AttributeDefinition => ({
  key: "field",
  label: "Поле",
  dataType: "text",
  unit: null,
  options: [],
  minValue: null,
  maxValue: null,
  required: false,
  filterable: false,
  appliesTo: "offer",
  helpText: null,
  isActive: true,
  sortOrder: 0,
  ...overrides,
});

const definitions = [
  def({ key: "speed", label: "Скорость", dataType: "number", minValue: 0, maxValue: 400, required: true }),
  def({ key: "color", label: "Цвет", dataType: "select", options: ["Красный", "Чёрный"] }),
  def({ key: "tuning", label: "Тюнинг", dataType: "multiselect", options: ["Диски", "Спойлер"] }),
  def({ key: "garage", label: "С гаражом", dataType: "boolean", appliesTo: "want" }),
  def({ key: "note", label: "Заметка", dataType: "text", isActive: false }),
];

test("значения проверяются по типу поля, лишние отбрасываются", () => {
  const schema = buildAttributesSchema(definitions);
  const ok = schema.safeParse({ speed: 220, color: "Чёрный", tuning: ["Диски", "Диски"], hacker: "x", note: "y" });
  assert.equal(ok.success, true);
  if (ok.success) assert.deepEqual(ok.data, { speed: 220, color: "Чёрный", tuning: ["Диски"] });
});

test("обязательное поле, границы числа и варианты из списка", () => {
  const schema = buildAttributesSchema(definitions);
  const missing = schema.safeParse({});
  assert.equal(missing.success, false);
  if (!missing.success) assert.ok(fieldErrors(missing.error).speed);

  const tooFast = schema.safeParse({ speed: 999 });
  assert.equal(tooFast.success, false);

  const badOption = schema.safeParse({ speed: 100, color: "Зелёный" });
  assert.equal(badOption.success, false);
  if (!badOption.success) assert.match(fieldErrors(badOption.error).color ?? "", /из списка/);
});

test("поля «хочу получить» проверяются только для обмена", () => {
  const want = buildAttributesSchema(definitions, "want");
  const parsed = want.safeParse({ garage: true, speed: "fast" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data, { garage: true });
});

test("конструктор: у списка должны быть варианты без повторов", () => {
  const noOptions = attributeCreateSchema.safeParse({ listingTypeId: 1, key: "color", label: "Цвет", dataType: "select" });
  assert.equal(noOptions.success, false);
  if (!noOptions.success) assert.ok(fieldErrors(noOptions.error).options);

  const dup = attributeCreateSchema.safeParse({
    listingTypeId: 1,
    key: "color",
    label: "Цвет",
    dataType: "select",
    options: ["Красный", "красный"],
  });
  assert.equal(dup.success, false);

  const badKey = attributeCreateSchema.safeParse({ listingTypeId: 1, key: "Цвет", label: "Цвет", dataType: "text" });
  assert.equal(badKey.success, false);
  if (!badKey.success) assert.ok(fieldErrors(badKey.error).key);
});
