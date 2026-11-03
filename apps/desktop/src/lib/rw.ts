/**
 * Чтение моделей RenderWare из GTA San Andreas (на ней работает Amazing Online):
 * .dff — геометрия персонажа, .txd — текстуры. Файлы берутся из папки
 * установленной игры на компьютере игрока и никуда не отправляются.
 *
 * Поддерживается то, что встречается в моделях персонажей: геометрия
 * со списком треугольников или Bin Mesh, текстурные координаты, нормали,
 * текстуры D3D8/D3D9 в DXT1/DXT3/DXT5 и несжатых форматах.
 */

const CHUNK = {
  STRUCT: 0x01,
  STRING: 0x02,
  EXTENSION: 0x03,
  TEXTURE: 0x06,
  MATERIAL: 0x07,
  MATERIAL_LIST: 0x08,
  FRAME_LIST: 0x0e,
  GEOMETRY: 0x0f,
  CLUMP: 0x10,
  ATOMIC: 0x14,
  TEXTURE_NATIVE: 0x15,
  TEXTURE_DICTIONARY: 0x16,
  GEOMETRY_LIST: 0x1a,
  BIN_MESH: 0x50e,
  SKIN: 0x116,
  HANIM: 0x11e,
} as const;

export class RwError extends Error {}

interface Chunk {
  type: number;
  /** Начало данных (после заголовка). */
  start: number;
  end: number;
}

class Reader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }
  chunk(offset: number, limit = this.bytes.length): Chunk {
    if (offset + 12 > limit) throw new RwError("Файл модели повреждён: обрезан заголовок блока");
    const type = this.view.getUint32(offset, true);
    const size = this.view.getUint32(offset + 4, true);
    const start = offset + 12;
    const end = start + size;
    if (end > limit) throw new RwError("Файл модели повреждён: блок выходит за границы");
    return { type, start, end };
  }
  /** Дочерние блоки внутри [start, end). */
  children(parent: Chunk): Chunk[] {
    const out: Chunk[] = [];
    let offset = parent.start;
    while (offset + 12 <= parent.end) {
      const c = this.chunk(offset, parent.end);
      out.push(c);
      offset = c.end;
    }
    return out;
  }
  child(parent: Chunk, type: number): Chunk | undefined {
    return this.children(parent).find((c) => c.type === type);
  }
  u8 = (o: number) => this.view.getUint8(o);
  u16 = (o: number) => this.view.getUint16(o, true);
  u32 = (o: number) => this.view.getUint32(o, true);
  i32 = (o: number) => this.view.getInt32(o, true);
  f32 = (o: number) => this.view.getFloat32(o, true);
  cstring(o: number, max: number): string {
    let s = "";
    for (let i = 0; i < max; i += 1) {
      const c = this.bytes[o + i]!;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

// ── Текстуры (.txd) ─────────────────────────────────────────────────────────

export interface RwTexture {
  name: string;
  width: number;
  height: number;
  /** RGBA, 4 байта на точку, первая строка сверху. */
  rgba: Uint8Array;
  hasAlpha: boolean;
}

const fourCC = (s: string) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
const DXT1 = fourCC("DXT1");
const DXT3 = fourCC("DXT3");
const DXT5 = fourCC("DXT5");

function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** Распаковка DXT1/DXT3/DXT5 в RGBA. */
export function decodeDxt(data: Uint8Array, width: number, height: number, kind: 1 | 3 | 5): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const blockBytes = kind === 1 ? 8 : 16;
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  if (data.length < bw * bh * blockBytes) throw new RwError("Текстура повреждена: мало данных");
  const colors = new Uint8Array(16);
  const alphas = new Uint8Array(16);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let o = (by * bw + bx) * blockBytes;
      alphas.fill(255);
      if (kind === 3) {
        for (let i = 0; i < 8; i += 1) {
          const byte = data[o + i]!;
          alphas[i * 2] = (byte & 15) * 17;
          alphas[i * 2 + 1] = (byte >> 4) * 17;
        }
        o += 8;
      } else if (kind === 5) {
        const a0 = data[o]!;
        const a1 = data[o + 1]!;
        const table = [a0, a1, 0, 0, 0, 0, 0, 0];
        if (a0 > a1) for (let i = 1; i < 7; i += 1) table[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
        else {
          for (let i = 1; i < 5; i += 1) table[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
          table[6] = 0;
          table[7] = 255;
        }
        // 48 бит индексов, по 3 бита на точку.
        let bits = 0;
        for (let i = 0; i < 6; i += 1) bits += data[o + 2 + i]! * 2 ** (8 * i);
        for (let i = 0; i < 16; i += 1) alphas[i] = table[Math.floor(bits / 2 ** (3 * i)) & 7]!;
        o += 8;
      }
      const c0 = data[o]! | (data[o + 1]! << 8);
      const c1 = data[o + 2]! | (data[o + 3]! << 8);
      const p0 = rgb565(c0);
      const p1 = rgb565(c1);
      const palette: Array<[number, number, number, number]> = [
        [...p0, 255],
        [...p1, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ];
      if (kind !== 1 || c0 > c1) {
        palette[2] = [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3, 255];
        palette[3] = [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3, 255];
      } else {
        palette[2] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 255];
        palette[3] = [0, 0, 0, 0];
      }
      for (let i = 0; i < 4; i += 1) {
        const row = data[o + 4 + i]!;
        for (let j = 0; j < 4; j += 1) colors[i * 4 + j] = (row >> (2 * j)) & 3;
      }
      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py;
        if (y >= height) continue;
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px;
          if (x >= width) continue;
          const k = py * 4 + px;
          const c = palette[colors[k]!]!;
          const d = (y * width + x) * 4;
          out[d] = c[0];
          out[d + 1] = c[1];
          out[d + 2] = c[2];
          out[d + 3] = kind === 1 ? c[3] : alphas[k]!;
        }
      }
    }
  }
  return out;
}

const FORMAT_MASK = 0x0f00;
const FMT_1555 = 0x0100;
const FMT_565 = 0x0200;
const FMT_4444 = 0x0300;
const FMT_LUM8 = 0x0400;
const FMT_8888 = 0x0500;
const FMT_888 = 0x0600;
const FMT_555 = 0x0a00;
const PAL8 = 0x2000;
const PAL4 = 0x4000;

function decodeUncompressed(r: Reader, o: number, width: number, height: number, rasterFormat: number, palette: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const count = width * height;
  if (palette) {
    const pal4 = (rasterFormat & PAL4) !== 0;
    for (let i = 0; i < count; i += 1) {
      const index = pal4 ? (r.u8(o + (i >> 1)) >> ((i & 1) * 4)) & 15 : r.u8(o + i);
      out.set(palette.subarray(index * 4, index * 4 + 4), i * 4);
    }
    return out;
  }
  const format = rasterFormat & FORMAT_MASK;
  for (let i = 0; i < count; i += 1) {
    const d = i * 4;
    switch (format) {
      case FMT_8888:
      case FMT_888: {
        // D3D хранит BGRA.
        out[d] = r.u8(o + d + 2);
        out[d + 1] = r.u8(o + d + 1);
        out[d + 2] = r.u8(o + d);
        out[d + 3] = format === FMT_888 ? 255 : r.u8(o + d + 3);
        break;
      }
      case FMT_565: {
        const [rr, g, b] = rgb565(r.u16(o + i * 2));
        out.set([rr, g, b, 255], d);
        break;
      }
      case FMT_1555:
      case FMT_555: {
        const c = r.u16(o + i * 2);
        const five = (v: number) => (v << 3) | (v >> 2);
        out.set([five((c >> 10) & 31), five((c >> 5) & 31), five(c & 31), format === FMT_555 || c & 0x8000 ? 255 : 0], d);
        break;
      }
      case FMT_4444: {
        const c = r.u16(o + i * 2);
        out.set([((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17, ((c >> 12) & 15) * 17], d);
        break;
      }
      case FMT_LUM8: {
        const v = r.u8(o + i);
        out.set([v, v, v, 255], d);
        break;
      }
      default:
        throw new RwError(`Неизвестный формат текстуры ${format.toString(16)}`);
    }
  }
  return out;
}

export function parseTxd(buffer: ArrayBuffer): Map<string, RwTexture> {
  const r = new Reader(buffer);
  const root = r.chunk(0);
  if (root.type !== CHUNK.TEXTURE_DICTIONARY) throw new RwError("Это не файл текстур .txd");
  const textures = new Map<string, RwTexture>();
  for (const native of r.children(root).filter((c) => c.type === CHUNK.TEXTURE_NATIVE)) {
    const s = r.child(native, CHUNK.STRUCT);
    if (!s) continue;
    try {
      const texture = parseTextureNative(r, s.start, s.end);
      if (texture) textures.set(texture.name.toLowerCase(), texture);
    } catch (e) {
      // Одну испорченную текстуру пропускаем — модель покажется без неё.
      if (!(e instanceof RwError)) throw e;
    }
  }
  return textures;
}

function parseTextureNative(r: Reader, o: number, end: number): RwTexture | null {
  const platform = r.u32(o);
  if (platform !== 8 && platform !== 9) return null; // PS2/Xbox-версии не нужны.
  const name = r.cstring(o + 8, 32);
  const rasterFormat = r.u32(o + 72);
  const d3dFormat = r.u32(o + 76); // D3D9: формат; D3D8: признак альфы
  const width = r.u16(o + 80);
  const height = r.u16(o + 82);
  const depth = r.u8(o + 84);
  const levels = r.u8(o + 85);
  const flags = r.u8(o + 87); // D3D9: бит 3 — сжатие; D3D8: тип DXT
  let p = o + 88;
  if (!width || !height || width > 4096 || height > 4096 || levels < 1) throw new RwError("Неверный размер текстуры");

  let palette: Uint8Array | null = null;
  if (rasterFormat & (PAL8 | PAL4)) {
    const colors = rasterFormat & PAL8 ? 256 : 32; // PAL4 в SA хранит 32 цвета
    palette = new Uint8Array(r.bytes.buffer, r.bytes.byteOffset + p, colors * 4).slice();
    // В палитре RGBA (не BGRA).
    p += colors * 4;
  }
  const size = r.u32(p);
  p += 4;
  if (p + size > end) throw new RwError("Текстура повреждена");
  const data = r.bytes.subarray(p, p + size);

  let kind: 0 | 1 | 3 | 5 = 0;
  if (platform === 9) {
    if (d3dFormat === DXT1) kind = 1;
    else if (d3dFormat === DXT3) kind = 3;
    else if (d3dFormat === DXT5) kind = 5;
  } else if (flags === 1 || flags === 3 || flags === 5) {
    kind = flags;
  }
  const rgba = kind ? decodeDxt(data, width, height, kind) : decodeUncompressed(r, p, width, height, rasterFormat, palette);
  void depth;
  const hasAlpha = rasterFormat & FORMAT_MASK ? [FMT_1555, FMT_4444, FMT_8888].includes(rasterFormat & FORMAT_MASK) || kind === 3 || kind === 5 : true;
  return { name, width, height, rgba, hasAlpha };
}

// ── Модель (.dff) ───────────────────────────────────────────────────────────

export interface RwMaterial {
  /** Имя текстуры в нижнем регистре; null — без текстуры. */
  texture: string | null;
  color: [number, number, number, number];
}

export interface RwMesh {
  /** Позиции уже переведены в координаты модели (с учётом скелета или кадров), Z вверх. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  /** Треугольники, сгруппированные по материалам. */
  parts: Array<{ material: RwMaterial; indices: Uint32Array }>;
}

export interface RwModel {
  meshes: RwMesh[];
  /** Габариты всех сеток: min и max по X, Y, Z. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

const GEOMETRY_TRISTRIP = 0x01;
const GEOMETRY_TEXTURED = 0x04;
const GEOMETRY_PRELIT = 0x08;
const GEOMETRY_NORMALS = 0x10;
const GEOMETRY_TEXTURED2 = 0x80;
const GEOMETRY_NATIVE = 0x01000000;

type Matrix = Float32Array; // 4×4, по столбцам

function frameMatrix(r: Reader, o: number): Matrix {
  const m = new Float32Array(16);
  // RW: right, up, at (по строкам), затем позиция.
  m[0] = r.f32(o);
  m[1] = r.f32(o + 4);
  m[2] = r.f32(o + 8);
  m[4] = r.f32(o + 12);
  m[5] = r.f32(o + 16);
  m[6] = r.f32(o + 20);
  m[8] = r.f32(o + 24);
  m[9] = r.f32(o + 28);
  m[10] = r.f32(o + 32);
  m[12] = r.f32(o + 36);
  m[13] = r.f32(o + 40);
  m[14] = r.f32(o + 44);
  m[15] = 1;
  return m;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let row = 0; row < 4; row += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + row]! * b[c * 4 + k]!;
      out[c * 4 + row] = s;
    }
  }
  return out;
}

interface Frames {
  world: Matrix[];
  /** Номер кости (HAnim) у кадра; -1 — не кость. */
  boneIds: number[];
  /** Иерархия костей: i-й узел → номер кости. Скин ссылается на узлы по порядку. */
  nodeIds: number[];
}

function parseFrames(r: Reader, list: Chunk): Frames {
  const s = r.child(list, CHUNK.STRUCT);
  if (!s) throw new RwError("В модели нет списка кадров");
  const count = r.u32(s.start);
  const local: Matrix[] = [];
  const parents: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = s.start + 4 + i * 56;
    local.push(frameMatrix(r, o));
    parents.push(r.i32(o + 48));
  }
  const world: Matrix[] = [];
  const resolve = (i: number, depth = 0): Matrix => {
    if (world[i]) return world[i]!;
    const parent = parents[i]!;
    const m = parent >= 0 && parent < count && parent !== i && depth < 64 ? multiply(resolve(parent, depth + 1), local[i]!) : local[i]!;
    world[i] = m;
    return m;
  };
  for (let i = 0; i < count; i += 1) resolve(i);

  // Расширения кадров идут после описания по одному на кадр: в них номера костей.
  const boneIds: number[] = new Array<number>(count).fill(-1);
  let nodeIds: number[] = [];
  const extensions = r.children(list).filter((c) => c.type === CHUNK.EXTENSION);
  extensions.slice(0, count).forEach((ext, i) => {
    const hanim = r.child(ext, CHUNK.HANIM);
    if (!hanim || hanim.end - hanim.start < 12) return;
    boneIds[i] = r.i32(hanim.start + 4);
    const nodes = r.u32(hanim.start + 8);
    if (nodes > 0 && nodes < 256 && hanim.start + 20 + nodes * 12 <= hanim.end) {
      nodeIds = [];
      for (let k = 0; k < nodes; k += 1) nodeIds.push(r.i32(hanim.start + 20 + k * 12));
    }
  });
  return { world, boneIds, nodeIds };
}

interface Skin {
  bones: number;
  indices: Uint8Array;
  weights: Float32Array;
  inverse: Matrix[];
}

function parseSkin(r: Reader, chunk: Chunk, numVertices: number, version: number): Skin | null {
  const numBones = r.u8(chunk.start);
  const numUsed = r.u8(chunk.start + 1);
  let o = chunk.start + 4 + numUsed;
  if (numBones === 0 || o + numVertices * 20 + numBones * 68 > chunk.end + numBones * 4) return null;
  const indices = r.bytes.slice(o, o + numVertices * 4);
  o += numVertices * 4;
  const weights = new Float32Array(numVertices * 4);
  for (let i = 0; i < numVertices * 4; i += 1) weights[i] = r.f32(o + i * 4);
  o += numVertices * 16;
  // Версия RenderWare из заголовка блока (у SA — 3.6.0.3); до 3.4.0.3 перед матрицей шли 4 байта.
  const libVersion = version & 0xffff0000 ? (((version >>> 14) & 0x3ff00) + 0x30000) | ((version >>> 16) & 0x3f) : version << 8;
  const oldFormat = libVersion < 0x34003;
  const inverse: Matrix[] = [];
  for (let b = 0; b < numBones; b += 1) {
    if (oldFormat) o += 4;
    if (o + 64 > chunk.end) return null;
    const m = new Float32Array(16);
    for (let k = 0; k < 16; k += 1) m[k] = r.f32(o + k * 4);
    m[3] = 0;
    m[7] = 0;
    m[11] = 0;
    m[15] = 1;
    inverse.push(m);
    o += 64;
  }
  return { bones: numBones, indices, weights, inverse };
}

/**
 * Поза по умолчанию через скелет: v' = Σ вес · (кость · обратная_привязка) · v.
 * Так модели, сохранённые «лёжа», встают так же, как в игре.
 */
function applySkin(mesh: RwMesh, skin: Skin, frames: Frames): boolean {
  const boneMatrices: Matrix[] = [];
  for (let b = 0; b < skin.bones; b += 1) {
    const nodeId = frames.nodeIds[b];
    const frame = nodeId === undefined ? -1 : frames.boneIds.indexOf(nodeId);
    if (frame < 0) return false;
    boneMatrices.push(multiply(frames.world[frame]!, skin.inverse[b]!));
  }
  const { positions, normals } = mesh;
  const count = positions.length / 3;
  const outP = new Float32Array(positions.length);
  const outN = new Float32Array(normals.length);
  for (let v = 0; v < count; v += 1) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    const nx = normals[v * 3]!;
    const ny = normals[v * 3 + 1]!;
    const nz = normals[v * 3 + 2]!;
    let total = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = skin.weights[v * 4 + k]!;
      if (w <= 0) continue;
      const m = boneMatrices[skin.indices[v * 4 + k]!];
      if (!m) continue;
      total += w;
      outP[v * 3] += w * (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!);
      outP[v * 3 + 1] += w * (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!);
      outP[v * 3 + 2] += w * (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
      outN[v * 3] += w * (m[0]! * nx + m[4]! * ny + m[8]! * nz);
      outN[v * 3 + 1] += w * (m[1]! * nx + m[5]! * ny + m[9]! * nz);
      outN[v * 3 + 2] += w * (m[2]! * nx + m[6]! * ny + m[10]! * nz);
    }
    if (total <= 0) {
      outP.set([x, y, z], v * 3);
      outN.set([nx, ny, nz], v * 3);
    } else if (Math.abs(total - 1) > 1e-3) {
      for (let k = 0; k < 3; k += 1) outP[v * 3 + k] /= total;
    }
    const len = Math.hypot(outN[v * 3]!, outN[v * 3 + 1]!, outN[v * 3 + 2]!) || 1;
    for (let k = 0; k < 3; k += 1) outN[v * 3 + k] /= len;
  }
  mesh.positions = outP;
  mesh.normals = outN;
  return true;
}

function parseMaterial(r: Reader, chunk: Chunk): RwMaterial {
  const s = r.child(chunk, CHUNK.STRUCT);
  const color: [number, number, number, number] = s ? [r.u8(s.start + 4), r.u8(s.start + 5), r.u8(s.start + 6), r.u8(s.start + 7)] : [255, 255, 255, 255];
  const textured = s ? r.u32(s.start + 12) !== 0 : false;
  let texture: string | null = null;
  if (textured) {
    const t = r.child(chunk, CHUNK.TEXTURE);
    const name = t ? r.children(t).find((c) => c.type === CHUNK.STRING) : undefined;
    if (name) texture = r.cstring(name.start, name.end - name.start).toLowerCase() || null;
  }
  return { texture, color };
}

function parseGeometry(r: Reader, chunk: Chunk, transform: Matrix | null, frames: Frames | null): RwMesh {
  const s = r.child(chunk, CHUNK.STRUCT);
  if (!s) throw new RwError("Геометрия без описания");
  const flags = r.u32(s.start);
  const numTriangles = r.i32(s.start + 4);
  const numVertices = r.i32(s.start + 8);
  if (flags & GEOMETRY_NATIVE) throw new RwError("Модель сохранена в формате консоли — открыть нельзя");
  if (numVertices <= 0 || numVertices > 2_000_000 || numTriangles < 0 || numTriangles > 4_000_000) {
    throw new RwError("Неверная геометрия модели");
  }
  let texSets = (flags >> 16) & 0xff;
  if (!texSets) texSets = flags & GEOMETRY_TEXTURED2 ? 2 : flags & GEOMETRY_TEXTURED ? 1 : 0;

  let o = s.start + 16;
  if (flags & GEOMETRY_PRELIT) o += numVertices * 4;
  let uvs: Float32Array | null = null;
  if (texSets > 0) {
    uvs = new Float32Array(numVertices * 2);
    for (let i = 0; i < numVertices * 2; i += 1) uvs[i] = r.f32(o + i * 4);
    o += texSets * numVertices * 8;
  }
  const triangles: Array<[number, number, number, number]> = [];
  for (let i = 0; i < numTriangles; i += 1) {
    const t = o + i * 8;
    // Два слова по 32 бита: (v1 << 16 | v2) и (v3 << 16 | материал).
    triangles.push([r.u16(t + 2), r.u16(t), r.u16(t + 4), r.u16(t + 6)]);
  }
  o += numTriangles * 8;
  // Одна морф-цель: сфера (16 байт), есть ли вершины и нормали.
  o += 16;
  const hasPositions = r.u32(o) !== 0;
  const hasNormals = r.u32(o + 4) !== 0;
  o += 8;
  if (!hasPositions) throw new RwError("В модели нет вершин");
  const positions = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices * 3; i += 1) positions[i] = r.f32(o + i * 4);
  o += numVertices * 12;
  let normals: Float32Array | null = null;
  if (hasNormals && flags & GEOMETRY_NORMALS) {
    normals = new Float32Array(numVertices * 3);
    for (let i = 0; i < numVertices * 3; i += 1) normals[i] = r.f32(o + i * 4);
  }
  if (o > s.end + 1) throw new RwError("Геометрия модели повреждена");

  const matList = r.child(chunk, CHUNK.MATERIAL_LIST);
  const materials: RwMaterial[] = [];
  if (matList) {
    const ms = r.child(matList, CHUNK.STRUCT);
    const chunks = r.children(matList).filter((c) => c.type === CHUNK.MATERIAL);
    const parsed = chunks.map((c) => parseMaterial(r, c));
    const count = ms ? r.u32(ms.start) : parsed.length;
    let next = 0;
    for (let i = 0; i < count; i += 1) {
      const ref = ms ? r.i32(ms.start + 4 + i * 4) : -1;
      materials.push(ref >= 0 && materials[ref] ? materials[ref]! : parsed[next++] ?? { texture: null, color: [255, 255, 255, 255] });
    }
  }
  if (materials.length === 0) materials.push({ texture: null, color: [200, 200, 200, 255] });

  // Треугольники по материалам. Основной источник — Bin Mesh из расширения:
  // в моделях SA номер материала в списке треугольников часто нулевой.
  const byMaterial = new Map<number, number[]>();
  const ext = r.child(chunk, CHUNK.EXTENSION);
  const bin = ext ? r.child(ext, CHUNK.BIN_MESH) : undefined;
  if (!bin || r.u32(bin.start + 4) === 0) {
    for (const [a, b, m, c] of triangles) {
      if (a >= numVertices || b >= numVertices || c >= numVertices) continue;
      const list = byMaterial.get(m) ?? [];
      list.push(a, b, c);
      byMaterial.set(m, list);
    }
  } else {
    {
      const strip = (r.u32(bin.start) & 1) === 1 || (flags & GEOMETRY_TRISTRIP) !== 0;
      const meshes = r.u32(bin.start + 4);
      let p = bin.start + 12;
      for (let i = 0; i < meshes; i += 1) {
        const n = r.u32(p);
        const m = r.u32(p + 4);
        p += 8;
        if (p + n * 4 > bin.end) throw new RwError("Геометрия модели повреждена");
        const idx: number[] = [];
        for (let k = 0; k < n; k += 1) {
          const v = r.u32(p + k * 4);
          idx.push(v < numVertices ? v : 0);
        }
        p += n * 4;
        const list = byMaterial.get(m) ?? [];
        if (strip) {
          for (let k = 2; k < idx.length; k += 1) {
            const a = idx[k - 2]!;
            const b = idx[k - 1]!;
            const c = idx[k]!;
            if (a === b || b === c || a === c) continue;
            if (k % 2 === 0) list.push(a, b, c);
            else list.push(b, a, c);
          }
        } else list.push(...idx);
        byMaterial.set(m, list);
      }
    }
  }

  const mesh: RwMesh = {
    positions,
    normals: normals ?? computeNormals(positions, [...byMaterial.values()].flat()),
    uvs,
    parts: [...byMaterial.entries()].map(([m, list]) => ({
      material: materials[m] ?? materials[0]!,
      indices: Uint32Array.from(list),
    })),
  };
  const skinChunk = ext ? r.child(ext, CHUNK.SKIN) : undefined;
  const skin = skinChunk ? parseSkin(r, skinChunk, numVertices, r.u32(chunk.start - 4)) : null;
  // Персонаж со скелетом ставится в позу по костям, остальное — по кадру атомика.
  if (!(skin && frames && frames.nodeIds.length > 0 && applySkin(mesh, skin, frames)) && transform) {
    applyTransform(mesh.positions, mesh.normals, transform);
  }
  return mesh;
}

function applyTransform(positions: Float32Array, normals: Float32Array | null, m: Matrix): void {
  const identity = m[0] === 1 && m[5] === 1 && m[10] === 1 && m[1] === 0 && m[2] === 0 && m[4] === 0 && m[6] === 0 && m[8] === 0 && m[9] === 0 && !m[12] && !m[13] && !m[14];
  if (identity) return;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    positions[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    positions[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    positions[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    if (normals) {
      const nx = normals[i]!;
      const ny = normals[i + 1]!;
      const nz = normals[i + 2]!;
      normals[i] = m[0]! * nx + m[4]! * ny + m[8]! * nz;
      normals[i + 1] = m[1]! * nx + m[5]! * ny + m[9]! * nz;
      normals[i + 2] = m[2]! * nx + m[6]! * ny + m[10]! * nz;
    }
  }
}

/** Сглаженные нормали, если в модели их нет. */
function computeNormals(positions: Float32Array, indices: number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

/** Номера костей скелета SA (HAnim). */
const BONE = { pelvis: 1, head: 5, leftThigh: 41, leftFoot: 43, rightThigh: 51, rightFoot: 53 } as const;

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Многие персонажи сохранены «лёжа» (в игре их поднимает анимация).
 * По костям скелета находим верх (ноги → голова) и правую сторону (бёдра)
 * и поворачиваем модель: Z — вверх, лицо — к +Y.
 */
function orientUpright(meshes: RwMesh[], frames: Frames): void {
  const bone = (id: number): Vec3 | null => {
    const i = frames.boneIds.indexOf(id);
    const m = i >= 0 ? frames.world[i] : undefined;
    return m ? [m[12]!, m[13]!, m[14]!] : null;
  };
  const head = bone(BONE.head);
  const lf = bone(BONE.leftFoot);
  const rf = bone(BONE.rightFoot);
  const lt = bone(BONE.leftThigh);
  const rt = bone(BONE.rightThigh);
  if (!head || !lf || !rf || !lt || !rt) return;
  const feet: Vec3 = [(lf[0] + rf[0]) / 2, (lf[1] + rf[1]) / 2, (lf[2] + rf[2]) / 2];
  const up = normalize(sub(head, feet));
  let right = sub(rt, lt);
  right = normalize(sub(right, up.map((u) => u * dot(right, up)) as Vec3));
  if (!Number.isFinite(right[0]) || Math.hypot(...right) < 0.5) return;
  const forward = cross(up, right);
  for (const mesh of meshes) {
    for (const arr of [mesh.positions, mesh.normals]) {
      for (let i = 0; i < arr.length; i += 3) {
        const v: Vec3 = [arr[i]!, arr[i + 1]!, arr[i + 2]!];
        arr[i] = dot(v, right);
        arr[i + 1] = dot(v, forward);
        arr[i + 2] = dot(v, up);
      }
    }
  }
}

export function parseDff(buffer: ArrayBuffer): RwModel {
  const r = new Reader(buffer);
  // В файле может быть несколько блоков; нужна первая «клумба» (Clump).
  let offset = 0;
  let clump: Chunk | null = null;
  while (offset + 12 <= r.bytes.length) {
    const c = r.chunk(offset);
    if (c.type === CHUNK.CLUMP) {
      clump = c;
      break;
    }
    offset = c.end;
  }
  if (!clump) throw new RwError("Это не файл модели .dff");

  const children = r.children(clump);
  const frameList = children.find((c) => c.type === CHUNK.FRAME_LIST);
  const frames = frameList ? parseFrames(r, frameList) : null;
  const geometryList = children.find((c) => c.type === CHUNK.GEOMETRY_LIST);
  if (!geometryList) throw new RwError("В модели нет геометрии");
  const geometries = r.children(geometryList).filter((c) => c.type === CHUNK.GEOMETRY);

  const meshes: RwMesh[] = [];
  const atomics = children.filter((c) => c.type === CHUNK.ATOMIC);
  if (atomics.length > 0) {
    for (const atomic of atomics) {
      const s = r.child(atomic, CHUNK.STRUCT);
      if (!s) continue;
      const frame = r.u32(s.start);
      const geometry = geometries[r.u32(s.start + 4)];
      if (!geometry) continue;
      // У персонажей геометрия уже в позе модели; кадр атомика — корень.
      meshes.push(parseGeometry(r, geometry, frames?.world[frame] ?? null, frames));
    }
  } else {
    for (const g of geometries) meshes.push(parseGeometry(r, g, null, frames));
  }
  if (meshes.length === 0) throw new RwError("В модели нет видимых частей");
  if (frames) orientUpright(meshes, frames);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.positions[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
  }
  return { meshes, bounds: { min, max } };
}
