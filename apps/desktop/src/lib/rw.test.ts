import { test } from "node:test";
import assert from "node:assert/strict";
import { RwError, decodeDxt, parseDff, parseTxd } from "./rw.js";

/** Блок с заголовком RenderWare: тип, размер, версия SA. */
function chunk(type: number, ...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(12 + size);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, size, true);
  view.setUint32(8, 0x1803ffff, true);
  let o = 12;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function bytes(write: (v: DataView) => void, size: number): Uint8Array {
  const out = new Uint8Array(size);
  write(new DataView(out.buffer));
  return out;
}

test("DXT1: блок 4×4 из двух цветов", () => {
  // c0 = красный (0xF800), c1 = синий (0x001F), все точки — индекс 0, кроме первой строки (индекс 1).
  const block = new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0x55, 0x00, 0x00, 0x00]);
  const rgba = decodeDxt(block, 4, 4, 1);
  assert.deepEqual([...rgba.subarray(0, 4)], [0, 0, 255, 255], "первая строка — синяя");
  assert.deepEqual([...rgba.subarray(16, 20)], [255, 0, 0, 255], "вторая строка — красная");
});

test("TXD: текстура D3D9 DXT1 читается по имени без учёта регистра", () => {
  const block = new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
  const header = bytes((v) => {
    v.setUint32(0, 9, true); // платформа D3D9
    "Body".split("").forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0)));
    v.setUint32(72, 0x0200, true);
    v.setUint32(76, 0x31545844, true); // 'DXT1'
    v.setUint16(80, 4, true);
    v.setUint16(82, 4, true);
    v.setUint8(84, 16);
    v.setUint8(85, 1);
    v.setUint8(86, 4);
    v.setUint8(87, 8);
    v.setUint32(88, block.length, true);
  }, 92);
  const native = chunk(0x15, chunk(0x01, header, block));
  const txd = chunk(0x16, chunk(0x01, bytes((v) => v.setUint16(0, 1, true), 4)), native);
  const textures = parseTxd(txd.buffer as ArrayBuffer);
  const body = textures.get("body");
  assert.ok(body);
  assert.equal(body.width, 4);
  assert.deepEqual([...body.rgba.subarray(0, 4)], [255, 0, 0, 255]);
});

test("DFF: треугольник с текстурой и материалом", () => {
  const frames = chunk(
    0x0e,
    chunk(
      0x01,
      bytes((v) => {
        v.setUint32(0, 1, true);
        v.setFloat32(4, 1, true);
        v.setFloat32(20, 1, true);
        v.setFloat32(36, 1, true);
        v.setInt32(52, -1, true);
      }, 60),
    ),
  );
  const geometryStruct = bytes((v) => {
    v.setUint32(0, 0x02 | 0x04, true); // позиции и текстурные координаты
    v.setInt32(4, 1, true);
    v.setInt32(8, 3, true);
    v.setInt32(12, 1, true);
    let o = 16 + 24; // текстурные координаты (3 × 8 байт), нули
    v.setUint16(o, 1, true); // v2
    v.setUint16(o + 2, 0, true); // v1
    v.setUint16(o + 4, 0, true); // материал
    v.setUint16(o + 6, 2, true); // v3
    o += 8 + 16; // сфера
    v.setUint32(o, 1, true); // есть вершины
    o += 8;
    [0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((n, i) => v.setFloat32(o + i * 4, n, true));
  }, 16 + 24 + 8 + 16 + 8 + 36);
  const name = new TextEncoder().encode("skin\0\0\0\0");
  const material = chunk(
    0x07,
    chunk(0x01, bytes((v) => { v.setUint32(4, 0xffffffff, true); v.setUint32(12, 1, true); }, 28)),
    chunk(0x06, chunk(0x01, new Uint8Array(4)), chunk(0x02, name), chunk(0x02, new Uint8Array(4))),
  );
  const matList = chunk(0x08, chunk(0x01, bytes((v) => { v.setUint32(0, 1, true); v.setInt32(4, -1, true); }, 8)), material);
  const geometry = chunk(0x0f, chunk(0x01, geometryStruct), matList, chunk(0x03));
  const geometryList = chunk(0x1a, chunk(0x01, bytes((v) => v.setUint32(0, 1, true), 4)), geometry);
  const atomic = chunk(0x14, chunk(0x01, new Uint8Array(16)));
  const clump = chunk(0x10, chunk(0x01, bytes((v) => v.setUint32(0, 1, true), 12)), frames, geometryList, atomic);

  const model = parseDff(clump.buffer as ArrayBuffer);
  assert.equal(model.meshes.length, 1);
  const mesh = model.meshes[0]!;
  assert.equal(mesh.positions.length, 9);
  assert.equal(mesh.parts[0]?.material.texture, "skin");
  assert.deepEqual([...mesh.parts[0]!.indices], [0, 1, 2]);
  assert.deepEqual(model.bounds.max, [1, 0, 1]);
});

test("чужой файл не принимается за модель", () => {
  assert.throws(() => parseDff(new Uint8Array(32).buffer), RwError);
  assert.throws(() => parseTxd(new Uint8Array(32).buffer), RwError);
});
