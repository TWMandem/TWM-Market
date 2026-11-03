import type { RwModel, RwTexture } from "./rw";

/**
 * Стили одежды: модель берёт текстуру «default», а в .txd персонажа лежат
 * ещё текстуры, которые модель не использует («1», «2», «3» или с названиями).
 * Стиль — это замена «default» на одну из них.
 */
export function pedStyles(data: { model: RwModel; textures: Map<string, RwTexture> }): string[] {
  const used = new Set(data.model.meshes.flatMap((m) => m.parts.map((p) => p.material.texture)).filter((t): t is string => t !== null));
  if (!used.has("default") || !data.textures.has("default")) return [];
  const extra = [...data.textures.keys()].filter((name) => !used.has(name));
  if (extra.length === 0) return [];
  const numeric = (n: string) => (/^\d+$/.test(n) ? Number(n) : Number.POSITIVE_INFINITY);
  extra.sort((a, b) => numeric(a) - numeric(b) || a.localeCompare(b));
  return ["default", ...extra];
}

export const styleLabel = (name: string) => (name === "default" ? "Основной" : /^\d+$/.test(name) ? `Стиль ${name}` : name.charAt(0).toUpperCase() + name.slice(1));

