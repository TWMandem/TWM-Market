import { test } from "node:test";
import assert from "node:assert/strict";
import { pedStyles, styleLabel } from "./ped-styles.js";
import type { RwModel, RwTexture } from "./rw.js";

const tex = (name: string): RwTexture => ({ name, width: 1, height: 1, rgba: new Uint8Array(4), hasAlpha: false });
const model = (...textures: string[]): RwModel => ({
  meshes: [
    {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      uvs: null,
      parts: textures.map((t) => ({ material: { texture: t, color: [255, 255, 255, 255] }, indices: new Uint32Array([0, 1, 2]) })),
    },
  ],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
});
const dict = (...names: string[]) => new Map(names.map((n) => [n, tex(n)]));

test("стили: «default» и неиспользуемые текстуры, номера по порядку", () => {
  assert.deepEqual(pedStyles({ model: model("default", "body"), textures: dict("body", "2", "default", "10", "1") }), ["default", "1", "2", "10"]);
  assert.deepEqual(pedStyles({ model: model("default", "exo"), textures: dict("default", "exo", "svoboda", "dolg") }), ["default", "dolg", "svoboda"]);
});

test("без «default» лишние текстуры стилями не считаются", () => {
  assert.deepEqual(pedStyles({ model: model("head", "body"), textures: dict("head", "body", "teeth") }), []);
  assert.deepEqual(pedStyles({ model: model("default"), textures: dict("default") }), []);
});

test("подписи стилей", () => {
  assert.equal(styleLabel("default"), "Основной");
  assert.equal(styleLabel("2"), "Стиль 2");
  assert.equal(styleLabel("svoboda"), "Svoboda");
});
