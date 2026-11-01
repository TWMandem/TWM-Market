import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Загрузка данных с сервера: результат, ошибка и повторная загрузка. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await run();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(e instanceof ApiError ? e.message : "Не удалось загрузить данные");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/** Выполняет действие и возвращает текст ошибки (или null при успехе). */
export async function attempt(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (e) {
    if (e instanceof ApiError) {
      const firstField = Object.values(e.fields)[0];
      return firstField && e.code === "validation_error" ? firstField : e.message;
    }
    return "Что-то пошло не так. Попробуйте ещё раз.";
  }
}
