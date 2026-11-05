import { invoke } from "@tauri-apps/api/core";
import { parseDff, parseTxd, type RwModel, type RwTexture } from "./rw";
import { readSetting, writeSetting } from "./storage";
import { isDesktopApp } from "./platform";

/**
 * Папка установленной игры Amazing Online и модели персонажей из неё.
 * Файлы читает сама программа на компьютере игрока, в интернет они не уходят.
 */

const KEY = "gameDir";

export class GameNotFoundError extends Error {}

/** Папка из настроек или найденная в обычных местах; null — игра не найдена. */
export async function gameDir(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  const saved = readSetting(KEY);
  if (saved) {
    try {
      return await invoke<string>("game_check", { dir: saved });
    } catch {
      // Игру перенесли или удалили — поищем заново.
    }
  }
  const found = await invoke<string | null>("game_detect");
  if (found) writeSetting(KEY, found);
  return found;
}

/** Выбор папки игроком. Возвращает папку игры или бросает ошибку с понятным текстом. */
export async function chooseGameDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Папка с игрой Amazing Online" });
  if (typeof picked !== "string") return null;
  const dir = await invoke<string>("game_check", { dir: picked });
  writeSetting(KEY, dir);
  return dir;
}

export interface PedModel {
  model: RwModel;
  textures: Map<string, RwTexture>;
}

const cache = new Map<number, Promise<PedModel>>();

/** Модель персонажа (одежды) по ID в игре. */
export function loadPedModel(id: number): Promise<PedModel> {
  const cached = cache.get(id);
  if (cached) return cached;
  const task = (async () => {
    const dir = await gameDir();
    if (!dir) throw new GameNotFoundError("Игра не найдена");
    const data = await invoke<ArrayBuffer>("game_ped_model", { dir, id });
    const view = new DataView(data);
    const dffLength = view.getUint32(0, true);
    if (dffLength + 4 > data.byteLength) throw new Error("Файл модели повреждён");
    const model = parseDff(data.slice(4, 4 + dffLength));
    const textures = parseTxd(data.slice(4 + dffLength));
    return { model, textures };
  })();
  cache.set(id, task);
  task.catch(() => cache.delete(id));
  return task;
}

export function forgetGameModels(): void {
  cache.clear();
}
