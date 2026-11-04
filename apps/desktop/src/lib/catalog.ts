import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { AttributeDefinitionDto, CategoryDto, ListingCardDto, ListingTypeDto, SectionDto } from "@twm/shared";
import { ApiError, api } from "./api";
import { useToast } from "./toast";
import { useAuth } from "./auth-context";

export interface CatalogStructure {
  sections: SectionDto[];
  listingTypes: ListingTypeDto[];
  categories: CategoryDto[];
}

// Структура площадки меняется редко: загружаем один раз за запуск приложения.
let cached: Promise<CatalogStructure> | null = null;

export function loadCatalog(): Promise<CatalogStructure> {
  cached ??= api.catalog().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function useCatalog() {
  const [data, setData] = useState<CatalogStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : "Не удалось загрузить разделы"));
    return () => {
      cancelled = true;
    };
  }, []);
  return { data, error };
}

const attributeCache = new Map<number, Promise<AttributeDefinitionDto[]>>();

/** Поля характеристик типа имущества (только активные). */
export function useAttributes(listingTypeId: number | null) {
  const [items, setItems] = useState<AttributeDefinitionDto[]>([]);
  useEffect(() => {
    if (listingTypeId === null) {
      setItems([]);
      return;
    }
    let cancelled = false;
    let promise = attributeCache.get(listingTypeId);
    if (!promise) {
      promise = api.attributes(listingTypeId).then((r) => r.items);
      attributeCache.set(listingTypeId, promise);
      promise.catch(() => attributeCache.delete(listingTypeId));
    }
    promise.then((list) => !cancelled && setItems(list)).catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [listingTypeId]);
  return items;
}

/** Переключение избранного в списке карточек. Гостя отправляет на вход. */
export function useFavoriteToggle(update: (id: string, favorite: boolean) => void) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(
    async (listing: ListingCardDto) => {
      if (status !== "authed") {
        navigate("/login", { state: { from: `/listing/${listing.id}` } });
        return;
      }
      const next = !listing.favorite;
      update(listing.id, next);
      try {
        await api.favorite(listing.id, next);
        toast(next ? "Добавлено в избранное" : "Убрано из избранного");
      } catch {
        update(listing.id, !next);
        toast("Не удалось изменить избранное", "error");
      }
    },
    [status, navigate, update, toast],
  );
}
