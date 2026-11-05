import { useMemo, useState } from "react";
import type { CatalogItemDto, CategoryDto, SectionDto } from "@twm/shared";
import { Media } from "../../components/listing";
import { Alert, Button, Card } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";

type SectionCode = SectionDto["code"];

const SECTION_TABS: Array<{ code: SectionCode; label: string }> = [
  { code: "items", label: "Рынок предметов" },
  { code: "cars", label: "Авторынок" },
  { code: "notary", label: "Нотариус" },
];

/** Дерево категорий (два уровня) и справочник предметов выбранной категории. */
export function CategoriesPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user?.role, "admin");
  const [section, setSection] = useState<SectionCode>("items");
  const [selected, setSelected] = useState<number | null>(null);
  const categories = useLoad(() => adminApi.categories(section), [section]);

  const tree = useMemo(() => {
    const list = categories.data?.items ?? [];
    return list
      .filter((c) => c.parentId === null)
      .map((root) => ({ root, children: list.filter((c) => c.parentId === root.id) }));
  }, [categories.data]);

  const selectedCategory = categories.data?.items.find((c) => c.id === selected) ?? null;

  const upsert = (c: CategoryDto) =>
    categories.setData((d) => {
      if (!d) return d;
      const exists = d.items.some((x) => x.id === c.id);
      return { items: exists ? d.items.map((x) => (x.id === c.id ? c : x)) : [...d.items, c] };
    });

  return (
    <>
      <AdminTitle title="Категории и предметы" />
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        Объявления будут ссылаться на предмет из справочника, а не на свободный текст — так работают средние цены и
        подписки. Синонимы помогают находить предмет по другим названиям.
      </p>

      <div role="tablist" aria-label="Раздел" className="flex flex-wrap gap-1.5">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.code}
            type="button"
            role="tab"
            aria-selected={section === tab.code}
            onClick={() => {
              setSection(tab.code);
              setSelected(null);
            }}
            className={`h-10 rounded-[10px] px-4 text-sm font-bold ${
              section === tab.code ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {categories.error && <Alert>{categories.error}</Alert>}

      <div className="flex flex-wrap items-start gap-5">
        <Card className="flex min-w-0 flex-[1_1_320px] flex-col gap-2 p-4">
          <h2 className="m-0 px-1 text-[15px] font-extrabold">Категории</h2>
          {tree.length === 0 && <p className="m-0 px-1 text-sm text-muted">Категорий пока нет.</p>}
          {tree.map(({ root, children }) => (
            <div key={root.id} className="flex flex-col gap-0.5">
              <CategoryRow category={root} selected={selected === root.id} canEdit={canEdit} onSelect={setSelected} onSaved={upsert} onDeleted={() => void categories.reload()} />
              <div className="flex flex-col gap-0.5 pl-5">
                {children.map((child) => (
                  <CategoryRow
                    key={child.id}
                    category={child}
                    selected={selected === child.id}
                    canEdit={canEdit}
                    onSelect={setSelected}
                    onSaved={upsert}
                    onDeleted={() => void categories.reload()}
                  />
                ))}
                {canEdit && <AddCategory section={section} parentId={root.id} label="+ подкатегория" onCreated={upsert} />}
              </div>
            </div>
          ))}
          {canEdit && <AddCategory section={section} parentId={null} label="+ Категория" onCreated={upsert} />}
        </Card>

        <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-4">
          {selectedCategory ? (
            <ItemsPanel key={selectedCategory.id} category={selectedCategory} canEdit={canEdit} onCountChange={() => void categories.reload()} />
          ) : (
            <Card>
              <p className="m-0 text-sm text-muted">Выберите категорию слева, чтобы увидеть её предметы.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

interface CategoryRowProps {
  category: CategoryDto;
  selected: boolean;
  canEdit: boolean;
  onSelect: (id: number) => void;
  onSaved: (c: CategoryDto) => void;
  onDeleted: () => void;
}

function CategoryRow({ category, selected, canEdit, onSelect, onSaved, onDeleted }: CategoryRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Partial<{ name: string; isActive: boolean }>) => {
    let saved: CategoryDto | null = null;
    const message = await attempt(async () => {
      saved = await adminApi.updateCategory(category.id, body);
    });
    setError(message);
    if (saved) {
      onSaved(saved);
      setEditing(false);
    }
  };

  const remove = async () => {
    const message = await attempt(() => adminApi.deleteCategory(category.id));
    setError(message);
    if (!message) onDeleted();
  };

  return (
    <div className="flex flex-col">
      <div className={`group flex min-h-10 items-center gap-2 rounded-lg px-2 ${selected ? "bg-surface-2" : "hover:bg-surface-2"}`}>
        {editing ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ name: name.trim() });
            }}
          >
            <label className="sr-only" htmlFor={`cat-${category.id}`}>
              Название категории
            </label>
            <input
              id={`cat-${category.id}`}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-line bg-ground px-2 text-ink"
            />
            <Button type="submit" className="h-9 px-3">
              ОК
            </Button>
            <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSelect(category.id)}
              className={`flex-1 text-left text-sm font-semibold ${category.isActive ? "text-ink" : "text-faint line-through"}`}
            >
              {category.name}
            </button>
            <span className="font-mono text-xs text-faint" title="Предметов в категории">
              {category.itemsCount}
            </span>
            {canEdit && (
              <span className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                <IconButton label="Переименовать" onClick={() => setEditing(true)}>
                  ✎
                </IconButton>
                <IconButton
                  label={category.isActive ? "Скрыть" : "Показать"}
                  onClick={() => void patch({ isActive: !category.isActive })}
                >
                  {category.isActive ? "◐" : "●"}
                </IconButton>
                <IconButton label="Удалить" onClick={() => void remove()}>
                  ×
                </IconButton>
              </span>
            )}
          </>
        )}
      </div>
      {error && <span className="px-2 text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-sm text-muted hover:bg-line hover:text-ink"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function AddCategory({
  section,
  parentId,
  label,
  onCreated,
}: {
  section: SectionCode;
  parentId: number | null;
  label: string;
  onCreated: (c: CategoryDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 self-start rounded-lg px-2 text-left text-sm font-semibold text-accent-ink hover:text-accent-soft">
        {label}
      </button>
    );
  }

  const submit = async () => {
    let created: CategoryDto | null = null;
    const message = await attempt(async () => {
      created = await adminApi.createCategory({ sectionCode: section, parentId, name: name.trim() });
    });
    setError(message);
    if (created) {
      onCreated(created);
      setName("");
      setOpen(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-1 px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`new-cat-${parentId ?? "root"}`}>
          Название
        </label>
        <input
          id={`new-cat-${parentId ?? "root"}`}
          autoFocus
          placeholder="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-line bg-ground px-2 text-ink placeholder:text-faint"
        />
        <Button type="submit" className="h-9 px-3">
          Добавить
        </Button>
        <Button variant="ghost" className="h-9 px-3" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </form>
  );
}

function ItemsPanel({ category, canEdit, onCountChange }: { category: CategoryDto; canEdit: boolean; onCountChange: () => void }) {
  const items = useLoad(() => adminApi.catalogItems({ categoryId: category.id }), [category.id]);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parseAliases = (text: string) =>
    text
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

  const add = async () => {
    setBusy(true);
    let created: CatalogItemDto | null = null;
    setError(
      await attempt(async () => {
        created = await adminApi.createCatalogItem({ categoryId: category.id, name: name.trim(), aliases: parseAliases(aliases) });
      }),
    );
    setBusy(false);
    if (created) {
      items.setData((d) => (d ? { items: [...d.items, created!].sort((a, b) => a.name.localeCompare(b.name, "ru")) } : d));
      setName("");
      setAliases("");
      onCountChange();
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="m-0 text-base font-extrabold">Предметы: {category.name}</h2>
      {items.error && <Alert>{items.error}</Alert>}
      {items.data && items.data.items.length === 0 && <p className="m-0 text-sm text-muted">В этой категории пока нет предметов.</p>}
      {items.data && items.data.items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.data.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              onSaved={(saved) => items.setData((d) => (d ? { items: d.items.map((x) => (x.id === saved.id ? saved : x)) } : d))}
              onDeleted={() => {
                items.setData((d) => (d ? { items: d.items.filter((x) => x.id !== item.id) } : d));
                onCountChange();
              }}
            />
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <TextInput id="new-item-name" label="Название предмета" value={name} onChange={setName} className="min-w-[200px] flex-1" />
          <TextInput
            id="new-item-aliases"
            label="Синонимы через запятую"
            value={aliases}
            onChange={setAliases}
            className="min-w-[200px] flex-1"
          />
          <Button type="submit" loading={busy} className="h-11">
            Добавить
          </Button>
          {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
        </form>
      )}
    </Card>
  );
}

function ItemRow({
  item,
  canEdit,
  onSaved,
  onDeleted,
}: {
  item: CatalogItemDto;
  canEdit: boolean;
  onSaved: (i: CatalogItemDto) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [aliases, setAliases] = useState(item.aliases.join(", "));
  const [gameCode, setGameCode] = useState(item.gameCode ?? "");
  const [contents, setContents] = useState(item.contents.join("\n"));
  const [error, setError] = useState<string | null>(null);

  const save = async (
    body: Partial<{ name: string; aliases: string[]; isActive: boolean; gameCode: string | null; contents: string[] }>,
  ) => {
    let saved: CatalogItemDto | null = null;
    setError(
      await attempt(async () => {
        saved = await adminApi.updateCatalogItem(item.id, body);
      }),
    );
    if (saved) {
      onSaved(saved);
      setEditing(false);
    }
  };

  const remove = async () => {
    const message = await attempt(() => adminApi.deleteCatalogItem(item.id));
    setError(message);
    if (!message) onDeleted();
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              name: name.trim(),
              aliases: aliases
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean),
              gameCode: gameCode.trim() || null,
              contents: contents
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            });
          }}
        >
          <TextInput id={`item-${item.id}-name`} label="Название" value={name} onChange={setName} className="min-w-[180px] flex-1" />
          <TextInput id={`item-${item.id}-aliases`} label="Синонимы" value={aliases} onChange={setAliases} className="min-w-[180px] flex-1" />
          <TextInput id={`item-${item.id}-code`} label="ID в игре" value={gameCode} onChange={setGameCode} className="w-32" />
          <div className="flex basis-full flex-col gap-1.5">
            <label htmlFor={`item-${item.id}-contents`} className="text-sm text-muted">
              Содержимое кейса или набора — по строке; примечание после « — » (например: «Кейс STALKER — 5%»)
            </label>
            <textarea
              id={`item-${item.id}-contents`}
              rows={4}
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              className="resize-y rounded-xl border border-line bg-ground px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent"
            />
          </div>
          <div className="flex basis-full flex-wrap gap-x-5 gap-y-2">
            <MediaSlot item={item} media="preview" onSaved={onSaved} onError={setError} />
            <MediaSlot item={item} media="audio" onSaved={onSaved} onError={setError} />
          </div>
          <Button type="submit" className="h-11">
            Сохранить
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </form>
        {error && <span className="text-[13px] text-danger">{error}</span>}
      </li>
    );
  }

  const uploadIcon = async (file: File | undefined) => {
    if (!file) return;
    let saved: CatalogItemDto | null = null;
    setError(
      await attempt(async () => {
        saved = await adminApi.uploadCatalogIcon(item.id, file);
      }),
    );
    if (saved) onSaved(saved);
  };

  return (
    <li className="group flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
      <label
        className={`relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ground ${canEdit ? "cursor-pointer hover:ring-2 hover:ring-accent" : ""}`}
        title={canEdit ? "Загрузить иконку: PNG, JPG, WebP, GIF или видео WebM до 10 МБ" : undefined}
      >
        <Media media={item.icon} alt="" fit="contain" className="size-full" />
        {canEdit && (
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/webm"
            className="sr-only"
            aria-label={`Иконка для «${item.name}»`}
            onChange={(e) => {
              void uploadIcon(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        )}
      </label>
      <span className={`font-semibold ${item.isActive ? "" : "text-faint line-through"}`}>{item.name}</span>
      {item.gameCode && <span className="font-mono text-xs text-faint">ID {item.gameCode}</span>}
      {item.aliases.length > 0 && <span className="text-[13px] text-muted">{item.aliases.join(", ")}</span>}
      {item.preview && <span className="text-xs text-ink-2" title="Есть предпросмотр">▶ превью</span>}
      {item.audioUrl && <span className="text-xs text-ink-2" title="Есть звук">♪ звук</span>}
      {item.contents.length > 0 && <span className="text-xs text-ink-2">содержимое: {item.contents.length}</span>}
      {canEdit && (
        <span className="ml-auto flex gap-0.5 opacity-60 group-hover:opacity-100">
          <IconButton label="Изменить" onClick={() => setEditing(true)}>
            ✎
          </IconButton>
          <IconButton label={item.isActive ? "Скрыть" : "Показать"} onClick={() => void save({ isActive: !item.isActive })}>
            {item.isActive ? "◐" : "●"}
          </IconButton>
          <IconButton label="Удалить" onClick={() => void remove()}>
            ×
          </IconButton>
        </span>
      )}
      {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
    </li>
  );
}

/** Загрузка и удаление предпросмотра или звука предмета. */
function MediaSlot({
  item,
  media,
  onSaved,
  onError,
}: {
  item: CatalogItemDto;
  media: "preview" | "audio";
  onSaved: (i: CatalogItemDto) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const present = media === "preview" ? item.preview !== null : item.audioUrl !== null;
  const label = media === "preview" ? "Предпросмотр (WebM, GIF, PNG, JPG)" : "Звук (MP3, OGG, WAV)";
  const run = async (action: () => Promise<CatalogItemDto>) => {
    setBusy(true);
    let saved: CatalogItemDto | null = null;
    onError(
      await attempt(async () => {
        saved = await action();
      }),
    );
    setBusy(false);
    if (saved) onSaved(saved);
  };
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <span>{label}:</span>
      <label className="cursor-pointer font-bold text-accent-ink hover:text-accent-soft">
        {busy ? "загружаю…" : present ? "заменить" : "загрузить"}
        <input
          type="file"
          accept={media === "preview" ? "video/webm,image/gif,image/png,image/jpeg,image/webp" : "audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(() => adminApi.uploadCatalogMedia(item.id, media, file));
          }}
        />
      </label>
      {present && (
        <button type="button" className="text-muted hover:text-danger" onClick={() => void run(() => adminApi.deleteCatalogMedia(item.id, media))}>
          убрать
        </button>
      )}
    </div>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-line bg-ground px-3 text-ink outline-none focus:border-accent"
      />
    </div>
  );
}
