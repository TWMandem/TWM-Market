import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGameProfileSchema,
  fieldErrors,
  gameNicknameSchema,
  loginSchema,
  registerSchema,
} from "./auth.js";

test("логин: допустимые и недопустимые", () => {
  assert.equal(loginSchema.safeParse("max_volk").success, true);
  assert.equal(loginSchema.safeParse("Max.Volk-2").success, true);
  assert.equal(loginSchema.safeParse("ab").success, false);
  assert.equal(loginSchema.safeParse("_max").success, false);
  assert.equal(loginSchema.safeParse("макс").success, false);
  assert.equal(loginSchema.safeParse("max volk").success, false);
  assert.equal(loginSchema.safeParse("Admin").success, false, "зарезервирован без учёта регистра");
});

test("регистрация: пароль не равен логину, правила приняты", () => {
  const ok = registerSchema.safeParse({
    login: "maxvolk",
    email: " Max@Example.COM ",
    password: "correct-horse-battery",
    rulesAccepted: true,
  });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.email, "max@example.com");

  const same = registerSchema.safeParse({
    login: "maxvolk12345",
    email: "max@example.com",
    password: "MAXVOLK12345",
    rulesAccepted: true,
  });
  assert.equal(same.success, false);
  if (!same.success) assert.equal(fieldErrors(same.error).password, "Пароль не должен совпадать с логином");

  const noRules = registerSchema.safeParse({
    login: "maxvolk",
    email: "max@example.com",
    password: "correct-horse-battery",
    rulesAccepted: false,
  });
  assert.equal(noRules.success, false);
  if (!noRules.success) assert.equal(fieldErrors(noRules.error).rulesAccepted, "Нужно принять правила площадки");
});

test("игровой ник: латиница, кириллица, без пробелов", () => {
  assert.equal(gameNicknameSchema.safeParse("Max_Volkov").success, true);
  assert.equal(gameNicknameSchema.safeParse("Макс_Волков").success, true);
  assert.equal(gameNicknameSchema.safeParse("Max Volkov").success, false);
  assert.equal(gameNicknameSchema.safeParse("M").success, false);
  assert.equal(gameNicknameSchema.safeParse("<script>").success, false);
});

test("профиль: сервер обязателен", () => {
  assert.equal(createGameProfileSchema.safeParse({ nickname: "Max_Volkov", serverNumber: 8 }).success, true);
  assert.equal(createGameProfileSchema.safeParse({ nickname: "Max_Volkov" }).success, false);
});
