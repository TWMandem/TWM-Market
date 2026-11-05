import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelViewer } from "../../components/ModelViewer";
import { Button, Card } from "../../components/ui";
import { GameNotFoundError, chooseGameDir, forgetGameModels, loadPedModel, type PedModel } from "../../lib/game";
import { pedStyles, styleLabel } from "../../lib/ped-styles";
import type { RwTexture } from "../../lib/rw";
import { isDesktopApp } from "../../lib/platform";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: PedModel }
  | { kind: "no-game" }
  | { kind: "error"; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "Не удалось открыть модель");

/**
 * 3D-модель персонажа для одежды: берётся из установленной игры.
 * Если игры нет, остаётся картинка одежды из галереи объявления.
 */
export function PedModelCard({ gameCode, name }: { gameCode: string; name: string }) {
  const id = Number(gameCode);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [style, setStyle] = useState("default");
  const styles = useMemo(() => (state.kind === "ready" ? pedStyles(state.data) : []), [state]);
  const textures = useMemo(() => {
    if (state.kind !== "ready") return null;
    const replacement = style !== "default" ? state.data.textures.get(style) : undefined;
    if (!replacement) return state.data.textures;
    const map = new Map<string, RwTexture>(state.data.textures);
    map.set("default", replacement);
    return map;
  }, [state, style]);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    setStyle("default");
    loadPedModel(id)
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: unknown) => setState(e instanceof GameNotFoundError ? { kind: "no-game" } : { kind: "error", message: errorText(e) }));
  }, [id]);

  useEffect(() => {
    if (isDesktopApp() && Number.isInteger(id) && id > 0) load();
  }, [id, load]);

  if (!isDesktopApp() || !Number.isInteger(id) || id <= 0) return null;

  const pick = async () => {
    try {
      const dir = await chooseGameDir();
      if (!dir) return;
      forgetGameModels();
      load();
    } catch (e) {
      setState({ kind: "error", message: errorText(e) });
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[19px] font-bold">3D-модель персонажа</h2>
        <span className="text-[13px] text-muted">из файлов вашей игры · ID {id}</span>
      </div>

      {state.kind === "loading" && (
        <div className="flex h-[440px] items-center justify-center rounded-xl bg-surface-2 text-sm text-muted">Загружаю модель из игры…</div>
      )}
      {state.kind === "ready" && textures && (
        <>
          {styles.length > 1 && (
            <div role="group" aria-label="Стиль одежды" className="flex flex-wrap gap-1.5">
              {styles.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={style === s}
                  onClick={() => setStyle(s)}
                  className={`h-9 rounded-[9px] border px-3.5 text-sm font-bold ${style === s ? "border-accent bg-surface-2 text-ink" : "border-line text-muted hover:text-ink"}`}
                >
                  {styleLabel(s)}
                </button>
              ))}
            </div>
          )}
          <ModelViewer model={state.data.model} textures={textures} label={`3D-модель: ${name}${style !== "default" ? `, ${styleLabel(style)}` : ""}`} />
          <p className="m-0 text-[13px] text-faint">
            Перетащите мышью, чтобы повернуть. Колесо — приблизить, двойной щелчок — вернуть вид.
            {styles.length > 1 ? " У этой одежды есть стили — переключайте их кнопками над моделью." : ""}
          </p>
        </>
      )}
      {state.kind === "no-game" && (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface-2 px-4 py-3.5 text-sm leading-relaxed text-ink-2">
          <span>
            Чтобы посмотреть одежду в 3D, нужна установленная игра Amazing Online. Программа не нашла её в обычных местах — укажите папку
            с игрой (там, где лежит amazing.exe). Без игры смотрите изображение одежды выше.
          </span>
          <Button variant="secondary" onClick={() => void pick()}>
            Указать папку с игрой
          </Button>
        </div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface-2 px-4 py-3.5 text-sm leading-relaxed text-ink-2">
          <span>{state.message}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={load}>
              Повторить
            </Button>
            <Button variant="ghost" onClick={() => void pick()}>
              Указать другую папку
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
