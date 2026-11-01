import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeCreateSchema } from "./admin.js";
import {
  buildAttributesSchema,
  definitionsForCategory,
  formatAttributeValue,
  geneCounts,
  unitParts,
  type AttributeDefinition,
} from "./attributes.js";
import { fieldErrors } from "./auth.js";

const def = (overrides: Partial<AttributeDefinition>): AttributeDefinition => ({
  key: "field",
  label: "Поле",
  dataType: "text",
  unit: null,
  options: [],
  minValue: null,
  maxValue: null,
  stepValue: null,
  categoryIds: [],
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

test("шаг числа: клиренс 5, 10, … 100", () => {
  const schema = buildAttributesSchema([
    def({ key: "clearance", label: "Клиренс", dataType: "number", minValue: 5, maxValue: 100, stepValue: 5 }),
  ]);
  assert.equal(schema.safeParse({ clearance: 55 }).success, true);
  assert.equal(schema.safeParse({ clearance: 100 }).success, true);
  const bad = schema.safeParse({ clearance: 52 });
  assert.equal(bad.success, false);
  if (!bad.success) assert.match(fieldErrors(bad.error).clearance ?? "", /кратно 5/);
});

test("поля по категориям: улучшение у аксессуаров и одежды, целостность только у одежды", () => {
  const list = [
    def({ key: "upgrade", categoryIds: [1, 4] }),
    def({ key: "integrity", categoryIds: [4] }),
    def({ key: "note" }),
  ];
  assert.deepEqual(definitionsForCategory(list, [1]).map((d) => d.key), ["upgrade", "note"]);
  assert.deepEqual(definitionsForCategory(list, [4]).map((d) => d.key), ["upgrade", "integrity", "note"]);
  assert.deepEqual(definitionsForCategory(list, [7, 4]).map((d) => d.key), ["upgrade", "integrity", "note"], "подкатегория одежды");
  assert.deepEqual(definitionsForCategory(list, null).map((d) => d.key), ["note"]);
});

test("показ значения с единицей и шаблоном", () => {
  assert.equal(formatAttributeValue(15, "X{}"), "X15");
  assert.equal(formatAttributeValue(85, "%"), "85 %");
  assert.equal(formatAttributeValue(129787, null), "129\u00a0787");
  assert.equal(formatAttributeValue("STAGE 2", null), "STAGE 2");
  assert.equal(formatAttributeValue(true, null), "Да");
  assert.deepEqual(unitParts("X{}"), { prefix: "X", suffix: "" });
  assert.deepEqual(unitParts("л"), { prefix: "", suffix: "л" });
  const twice = attributeCreateSchema.safeParse({ listingTypeId: 1, key: "upgrade", label: "Улучшение", dataType: "number", unit: "{}X{}" });
  assert.equal(twice.success, false);
});

test("гены: геном из 6 букв Y, G, H, W, X", () => {
  const schema = buildAttributesSchema([
    def({ key: "genome", label: "Геном", dataType: "genes", options: ["Y", "G", "H", "W", "X"], minValue: 6, maxValue: 6 }),
  ]);
  const ok = schema.safeParse({ genome: "yy gg-hw" });
  assert.equal(ok.success, true);
  if (ok.success) assert.deepEqual(ok.data, { genome: "YYGGHW" });
  assert.equal(schema.safeParse({ genome: "YYGGH" }).success, false, "пять генов");
  const bad = schema.safeParse({ genome: "YYGGHZ" });
  assert.equal(bad.success, false);
  if (!bad.success) assert.match(fieldErrors(bad.error).genome ?? "", /только буквы/);
  assert.equal(schema.safeParse({ genome: "" }).success, true, "необязательное поле можно оставить пустым");
  assert.deepEqual(geneCounts("yyg z", ["Y", "G", "H", "W", "X"]), { Y: 2, G: 1 });
});
