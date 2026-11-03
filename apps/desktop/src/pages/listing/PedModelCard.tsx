import { useCallback, useEffect, useState } from "react";
import { ModelViewer } from "../../components/ModelViewer";
import { Button, Card } from "../../components/ui";
import { GameNotFoundError, chooseGameDir, forgetGameModels, loadPedModel, type PedModel } from "../../lib/game";
import { isTauri } from "../../lib/token-store";

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

  const load = useCallback(() => {
    setState({ kind: "loading" });
    loadPedModel(id)
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: unknown) => setState(e instanceof GameNotFoundError ? { kind: "no-game" } : { kind: "error", message: errorText(e) }));
  }, [id]);

  useEffect(() => {
    if (isTauri() && Number.isInteger(id) && id > 0) load();
  }, [id, load]);

  if (!isTauri() || !Number.isInteger(id) || id <= 0) return null;

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
      {state.kind === "ready" && (
        <>
          <ModelViewer model={state.data.model} textures={state.data.textures} label={`3D-модель: ${name}`} />
          <p className="m-0 text-[13px] text-faint">Перетащите мышью, чтобы повернуть. Колесо — приблизить, двойной щелчок — вернуть вид.</p>
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
