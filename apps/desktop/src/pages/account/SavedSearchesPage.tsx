import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { SAVED_SEARCH_LIMIT, type SavedSearchDto } from "@twm/shared";
import { Alert, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useServers } from "../../lib/server-context";
import { attempt, useLoad } from "../../lib/use-load";

const SECTION_NAMES: Record<SavedSearchDto["section"], string> = {
  items: "Рынок предметов",
  cars: "Авторынок",
  notary: "Нотариальная контора",
  search: "Поиск",
};

/** Адрес каталога для подписки: параметры раздела и сервера задаёт сама страница. */
function catalogAddress(search: SavedSearchDto): { path: string; server: number | null } {
  const params = new URLSearchParams(search.params);
  const server = Number(params.get("server")) || null;
  params.delete("section");
  params.delete("server");
  if (search.section === "items" || search.section === "cars") params.delete("type");
  if (server === null) params.set("allServers", "1");
  const query = params.toString();
  return { path: `/${search.section}${query ? `?${query}` : ""}`, server };
}

export function SavedSearchesPage() {
  const { data, setData, error } = useLoad(() => api.savedSearches(), []);
  const { servers, select } = useServers();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  const replace = (updated: SavedSearchDto) =>
    setData((d) => (d ? { items: d.items.map((i) => (i.id === updated.id ? updated : i)) } : d));

  const open = async (search: SavedSearchDto) => {
    const { path, server } = catalogAddress(search);
    if (server !== null) select(server);
    if (search.newCount > 0) void api.seenSavedSearch(search.id).catch(() => undefined);
    navigate(path);
  };

  const toggleNotify = async (search: SavedSearchDto) => {
    setProblem(await attempt(async () => replace(await api.updateSavedSearch(search.id, { notify: !search.notify }))));
  };

  const saveName = async (search: SavedSearchDto) => {
    const failed = await attempt(async () => replace(await api.updateSavedSearch(search.id, { name: name.trim() })));
    setProblem(failed);
    if (!failed) setRenaming(null);
  };

  const remove = async (search: SavedSearchDto) => {
    const failed = await attempt(() => api.deleteSavedSearch(search.id));
    setProblem(failed);
    if (!failed) setData((d) => (d ? { items: d.items.filter((i) => i.id !== search.id) } : d));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[28px] font-bold">Подписки на поиск</h1>
        <span className="text-muted">
          Сохранённые фильтры каталога. О новых подходящих объявлениях придёт уведомление. До {SAVED_SEARCH_LIMIT} подписок.
        </span>
      </div>
      {error && <Alert>{error}</Alert>}
      {problem && <Alert>{problem}</Alert>}
      {data && data.items.length === 0 && (
        <p className="m-0 text-muted">
          Подписок пока нет. Настройте фильтры в каталоге и нажмите «Подписаться на поиск».{" "}
          <Link to="/items" className="font-bold text-accent">
            В каталог →
          </Link>
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {data?.items.map((search) => {
          const server = Number(new URLSearchParams(search.params).get("server")) || null;
          const serverName = server ? servers.find((s) => s.number === server)?.name ?? `сервер ${server}` : "все серверы";
          return (
            <li key={search.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                {renaming === search.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveName(search);
                    }}
                  >
                    <input
                      aria-label="Название подписки"
                      value={name}
                      maxLength={60}
                      autoFocus
                      onChange={(e) => setName(e.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3 text-ink focus:border-accent focus:outline-none"
                    />
                    <Button type="submit" disabled={!name.trim()}>
                      Сохранить
                    </Button>
                    <Button variant="ghost" onClick={() => setRenaming(null)}>
                      Отмена
                    </Button>
                  </form>
                ) : (
                  <button type="button" onClick={() => void open(search)} className="flex items-center gap-2 text-left text-[17px] font-extrabold text-ink hover:text-accent">
                    {search.name}
                    {search.newCount > 0 && (
                      <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs font-bold text-on-accent">
                        +{search.newCount >= 100 ? "99+" : search.newCount} новых
                      </span>
                    )}
                  </button>
                )}
                <span className="text-[13px] text-muted">
                  {SECTION_NAMES[search.section]} · {serverName} · {search.notify ? "уведомления включены" : "без уведомлений"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void open(search)}>Открыть</Button>
                <Button variant="secondary" onClick={() => void toggleNotify(search)}>
                  {search.notify ? "Выключить уведомления" : "Включить уведомления"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRenaming(search.id);
                    setName(search.name);
                  }}
                >
                  Переименовать
                </Button>
                <Button variant="danger" onClick={() => void remove(search)}>
                  Удалить
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
