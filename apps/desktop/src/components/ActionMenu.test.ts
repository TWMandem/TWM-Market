import assert from "node:assert/strict";
import { test } from "node:test";
import { actionMenuPosition } from "./ActionMenu.js";

test("меню у левого края остаётся внутри экрана", () => {
  const position = actionMenuPosition({
    trigger: { left: 24, right: 68, top: 400, bottom: 444 },
    menuWidth: 250,
    menuHeight: 120,
    viewportWidth: 390,
    viewportHeight: 800,
    bottomObstruction: 64,
  });
  assert.equal(position.left, 8);
});

test("длинное меню над нижней навигацией открывается вверх", () => {
  const position = actionMenuPosition({
    trigger: { left: 300, right: 344, top: 610, bottom: 654 },
    menuWidth: 250,
    menuHeight: 360,
    viewportWidth: 390,
    viewportHeight: 800,
    bottomObstruction: 88,
  });
  assert.equal(position.left, 94);
  assert.equal(position.top, 242);
  assert.equal(position.maxHeight, 594);
  assert.ok(position.top + 360 < 610);
});

test("меню открывается вниз, когда там достаточно места", () => {
  const position = actionMenuPosition({
    trigger: { left: 300, right: 344, top: 100, bottom: 144 },
    menuWidth: 250,
    menuHeight: 180,
    viewportWidth: 390,
    viewportHeight: 800,
    bottomObstruction: 64,
  });
  assert.equal(position.top, 152);
  assert.equal(position.maxHeight, 576);
});
