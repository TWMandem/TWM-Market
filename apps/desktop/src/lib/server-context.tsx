import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SERVERS } from "@twm/shared";
import { api, type GameServer } from "./api";
import { readSetting, writeSetting } from "./storage";

interface ServerContextValue {
  servers: GameServer[];
  /** Выбранный сервер или null — «все серверы». */
  current: GameServer | null;
  select: (number: number | null) => void;
}

const ServerContext = createContext<ServerContextValue | null>(null);

const FALLBACK: GameServer[] = DEFAULT_SERVERS.map((s) => ({ ...s, isActive: true, transferOpen: true }));
const STORAGE_KEY = "server";

/**
 * Хранит выбранный игроком сервер. Все каталоги по умолчанию
 * показывают объявления этого сервера.
 */
export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<GameServer[]>(FALLBACK);
  const [selected, setSelected] = useState<number | null>(() => {
    const saved = Number(readSetting(STORAGE_KEY));
    return Number.isInteger(saved) && saved > 0 ? saved : null;
  });

  useEffect(() => {
    let cancelled = false;
    api
      .servers()
      .then(({ items }) => {
        if (!cancelled && items.length > 0) setServers(items.filter((s) => s.isActive));
      })
      .catch(() => {
        // Сервер недоступен — работаем со встроенным списком.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((number: number | null) => {
    setSelected(number);
    writeSetting(STORAGE_KEY, number === null ? "" : String(number));
  }, []);

  const value = useMemo<ServerContextValue>(
    () => ({
      servers,
      current: servers.find((s) => s.number === selected) ?? null,
      select,
    }),
    [servers, selected, select],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServers(): ServerContextValue {
  const value = useContext(ServerContext);
  if (!value) throw new Error("useServers должен вызываться внутри ServerProvider");
  return value;
}
