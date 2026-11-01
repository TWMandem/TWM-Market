import { useEffect, useMemo, useState } from "react";
import {
  ATTRIBUTE_SIDE_LABELS,
  ATTRIBUTE_TYPE_LABELS,
  ATTRIBUTE_SIDES,
  ATTRIBUTE_TYPES,
  buildAttributesSchema,
  definitionsForCategory,
  hasOptions,
  hasRange,
  fieldErrors,
  type AttributeDefinitionDto,
  type AttributeSide,
  type AttributeType,
  type AttributeValue,
  type CategoryDto,
  type ListingTypeDto,
} from "@twm/shared";
import { AttributeField } from "../../components/AttributeField";
import { Alert, Button, Card, Field } from "../../components/ui";
import { ApiError, adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";
import { Toggle } from "./ServersPage";

const SECTION_NAMES = { items: "Рынок предметов", cars: "Авторынок", notary: "Нотариус" } as const;

/**
 * Конструктор полей характеристик: для каждого типа имущества свой набор полей.
 * Справа — предпросмотр формы в том виде, в каком её увидит продавец.
 */
export function FieldsPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user?.role, "admin");
  const types = useLoad(() => adminApi.listingTypes(), []);
  const [typeId, setTypeId] = useState<number | null>(null);

  useEffect(() => {
    if (typeId === null && types.data?.items[0]) setTypeId(types.data.items[0].id);
  }, [types.data, typeId]);

  const currentType = types.data?.items.find((t) => t.id === typeId) ?? null;

  return (
    <>
      <AdminTitle title="Конструктор полей" />
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        Поля характеристик появятся в форме объявления, в карточке и (если отмечено) в фильтрах каталога. Ключ и тип поля
        после создания не меняются. Ненужное поле лучше скрыть, чем удалить.
      </p>
      {types.error && <Alert>{types.error}</Alert>}

      {types.data && (
        <div className="flex max-w-[420px] flex-col gap-1.5">
          <label htmlFor="type-select" className="text-sm text-muted">
            Тип имущества
          </label>
          <select
            id="type-select"
            value={typeId ?? ""}
            onChange={(e) => setTypeId(Number(e.target.value))}
            className="h-12 rounded-xl border border-line bg-ground px-3 text-ink"
          >
            {(["items", "cars", "notary"] as const).map((section) => (
              <optgroup key={section} label={SECTION_NAMES[section]}>
                {types.data!.items
                  .filter((t) => t.sectionCode === section)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {currentType && <TypeFields key={currentType.id} type={currentType} canEdit={canEdit} />}
    </>
  );
}

function TypeFields({ type, canEdit }: { type: ListingTypeDto; canEdit: boolean }) {
  const attributes = useLoad(() => adminApi.attributes(type.id), [type.id]);
  const categoriesLoad = useLoad(() => adminApi.categories(type.sectionCode), [type.sectionCode]);
  const categories = categoriesLoad.data?.items ?? [];
  const [editing, setEditing] = useState<AttributeDefinitionDto | "new" | null>(null);

  const upsert = (saved: AttributeDefinitionDto) => {
    attributes.setData((d) => {
      if (!d) return d;
      const exists = d.items.some((a) => a.id === saved.id);
      const items = exists ? d.items.map((a) => (a.id === saved.id ? saved : a)) : [...d.items, saved];
      return { items: items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id) };
    });
    setEditing(null);
  };

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-3">
        {attributes.error && <Alert>{attributes.error}</Alert>}
        {attributes.data?.items.length === 0 && (
          <Card>
            <p className="m-0 text-sm text-muted">У типа «{type.name}» пока нет полей.</p>
          </Card>
        )}
        {attributes.data?.items.map((attr) =>
          editing !== "new" && editing?.id === attr.id ? (
            <AttributeForm
              key={attr.id}
              listingTypeId={type.id}
              categories={categories}
              initial={attr}
              onSaved={upsert}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <AttributeRow
              key={attr.id}
              attr={attr}
              categories={categories}
              canEdit={canEdit}
              onEdit={() => setEditing(attr)}
              onDeleted={() => attributes.setData((d) => (d ? { items: d.items.filter((a) => a.id !== attr.id) } : d))}
            />
          ),
        )}
        {canEdit &&
          (editing === "new" ? (
            <AttributeForm
              listingTypeId={type.id}
              categories={categories}
              initial={null}
              nextSort={(attributes.data?.items.length ?? 0) * 10 + 10}
              onSaved={upsert}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setEditing("new")}>
              + Добавить поле
            </Button>
          ))}
      </div>

      <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3">
        {attributes.data && <Preview type={type} definitions={attributes.data.items} categories={categories} />}
      </div>
    </div>
  );
}

const categoryNames = (ids: number[], categories: CategoryDto[]) =>
  ids.map((id) => categories.find((c) => c.id === id)?.name ?? `#${id}`).join(", ");

function AttributeRow({
  attr,
  categories,
  canEdit,
  onEdit,
  onDeleted,
}: {
  attr: AttributeDefinitionDto;
  categories: CategoryDto[];
  canEdit: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const details = [
    ATTRIBUTE_TYPE_LABELS[attr.dataType],
    attr.unit,
    attr.minValue !== null || attr.maxValue !== null ? `${attr.minValue ?? "…"} – ${attr.maxValue ?? "…"}` : null,
    attr.stepValue !== null ? `шаг ${attr.stepValue}` : null,
    attr.options.length ? attr.options.join(", ") : null,
  ].filter(Boolean);

  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 ${attr.isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold">{attr.label}</span>
        <span className="font-mono text-xs text-faint">{attr.key}</span>
        {attr.required && <Badge>обязательное</Badge>}
        {attr.filterable && <Badge>в фильтрах</Badge>}
        {attr.appliesTo !== "offer" && <Badge>{ATTRIBUTE_SIDE_LABELS[attr.appliesTo]}</Badge>}
        {attr.categoryIds.length > 0 && <Badge>{`только: ${categoryNames(attr.categoryIds, categories)}`}</Badge>}
        {!attr.isActive && <Badge>скрыто</Badge>}
        {canEdit && (
          <span className="ml-auto flex gap-1">
            <Button variant="ghost" onClick={onEdit}>
              Изменить
            </Button>
            {confirm ? (
              <>
                <Button
                  variant="danger"
                  onClick={async () => {
                    const message = await attempt(() => adminApi.deleteAttribute(attr.id));
                    setError(message);
                    if (!message) onDeleted();
                  }}
                >
                  Удалить
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Отмена
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                Удалить
              </Button>
            )}
          </span>
        )}
      </div>
      <span className="text-[13px] text-muted">{details.join(" · ")}</span>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{children}</span>;
}

interface FormState {
  key: string;
  label: string;
  dataType: AttributeType;
  unit: string;
  options: string;
  minValue: string;
  maxValue: string;
  stepValue: string;
  categoryIds: number[];
  required: boolean;
  filterable: boolean;
  appliesTo: AttributeSide;
  helpText: string;
  isActive: boolean;
  sortOrder: string;
}

function AttributeForm({
  listingTypeId,
  categories,
  initial,
  nextSort = 0,
  onSaved,
  onCancel,
}: {
  listingTypeId: number;
  categories: CategoryDto[];
  initial: AttributeDefinitionDto | null;
  nextSort?: number;
  onSaved: (a: AttributeDefinitionDto) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<FormState>(() => ({
    key: initial?.key ?? "",
    label: initial?.label ?? "",
    dataType: initial?.dataType ?? "text",
    unit: initial?.unit ?? "",
    options: initial?.options.join("\n") ?? "",
    minValue: initial?.minValue?.toString() ?? "",
    maxValue: initial?.maxValue?.toString() ?? "",
    stepValue: initial?.stepValue?.toString() ?? "",
    categoryIds: initial?.categoryIds ?? [],
    required: initial?.required ?? false,
    filterable: initial?.filterable ?? false,
    appliesTo: initial?.appliesTo ?? "offer",
    helpText: initial?.helpText ?? "",
    isActive: initial?.isActive ?? true,
    sortOrder: String(initial?.sortOrder ?? nextSort),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));

  const isNumber = state.dataType === "number";
  const isGenes = state.dataType === "genes";
  const isList = hasOptions(state.dataType);
  const isRanged = hasRange(state.dataType);
  const num = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = {
      label: state.label.trim(),
      unit: isNumber && state.unit.trim() ? state.unit.trim() : null,
      options: isList
        ? state.options
            .split("\n")
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
      minValue: isRanged ? num(state.minValue) : null,
      maxValue: isRanged ? num(state.maxValue) : null,
      stepValue: isNumber ? num(state.stepValue) : null,
      categoryIds: state.categoryIds,
      required: state.required,
      filterable: state.filterable,
      appliesTo: state.appliesTo,
      helpText: state.helpText.trim() || null,
      isActive: state.isActive,
      sortOrder: Number(state.sortOrder) || 0,
    };
    try {
      const saved = initial
        ? await adminApi.updateAttribute(initial.id, body)
        : await adminApi.createAttribute({ ...body, listingTypeId, key: state.key.trim(), dataType: state.dataType });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        if (Object.keys(e.fields).length === 0) setFormError(e.message);
      } else {
        setFormError("Не удалось сохранить поле");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 border-accent/50">
      <h3 className="m-0 text-[15px] font-extrabold">{initial ? `Поле «${initial.label}»` : "Новое поле"}</h3>
      {formError && <Alert>{formError}</Alert>}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <Field label="Подпись в форме" value={state.label} onChange={(e) => set("label", e.target.value)} error={errors.label} />
          <Field
            label="Ключ (латиница, навсегда)"
            value={state.key}
            disabled={initial !== null}
            onChange={(e) => set("key", e.target.value.toLowerCase())}
            error={errors.key}
            hint={initial ? undefined : "Например: max_speed"}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="attr-type" className="text-sm text-muted">
              Тип поля
            </label>
            <select
              id="attr-type"
              value={state.dataType}
              disabled={initial !== null}
              onChange={(e) => set("dataType", e.target.value as AttributeType)}
              className="h-12 rounded-xl border border-line bg-ground px-3 text-ink disabled:opacity-60"
            >
              {ATTRIBUTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ATTRIBUTE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isNumber && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <Field
              label="Единица"
              placeholder="%"
              value={state.unit}
              onChange={(e) => set("unit", e.target.value)}
              error={errors.unit}
              hint="«X{}» — значение внутри: X15"
            />
            <Field label="Минимум" inputMode="decimal" value={state.minValue} onChange={(e) => set("minValue", e.target.value)} error={errors.minValue} />
            <Field label="Максимум" inputMode="decimal" value={state.maxValue} onChange={(e) => set("maxValue", e.target.value)} error={errors.maxValue} />
            <Field label="Шаг" inputMode="decimal" placeholder="любой" value={state.stepValue} onChange={(e) => set("stepValue", e.target.value)} error={errors.stepValue} />
          </div>
        )}

        {isGenes && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <Field label="Генов не меньше" inputMode="numeric" value={state.minValue} onChange={(e) => set("minValue", e.target.value)} error={errors.minValue} />
            <Field label="Генов не больше" inputMode="numeric" value={state.maxValue} onChange={(e) => set("maxValue", e.target.value)} error={errors.maxValue} />
          </div>
        )}

        {categories.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-sm text-muted">Только для категорий (ничего не отмечено — для всех)</legend>
            <div className="flex flex-wrap gap-2">
              {categories
                .filter((c) => c.parentId === null)
                .map((c) => {
                  const on = state.categoryIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${
                        on ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          set("categoryIds", e.target.checked ? [...state.categoryIds, c.id] : state.categoryIds.filter((id) => id !== c.id))
                        }
                        className="size-4 accent-accent"
                      />
                      {c.name}
                    </label>
                  );
                })}
            </div>
            {errors.categoryIds && <span className="text-[13px] text-danger">{errors.categoryIds}</span>}
          </fieldset>
        )}

        {isList && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="attr-options" className="text-sm text-muted">
              {isGenes ? "Буквы генов — каждая с новой строки" : "Варианты — каждый с новой строки"}
            </label>
            <textarea
              id="attr-options"
              rows={5}
              value={state.options}
              onChange={(e) => set("options", e.target.value)}
              className={`resize-y rounded-xl border bg-ground px-3.5 py-2.5 leading-relaxed text-ink outline-none focus:border-accent ${
                errors.options ? "border-[#c45555]" : "border-line"
              }`}
            />
            {errors.options && <span className="text-[13px] text-danger">{errors.options}</span>}
          </div>
        )}

        <Field label="Подсказка под полем (необязательно)" value={state.helpText} onChange={(e) => set("helpText", e.target.value)} error={errors.helpText} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle label="Обязательное" checked={state.required} onChange={(v) => set("required", v)} />
          <Toggle label="Показывать в фильтрах" checked={state.filterable} onChange={(v) => set("filterable", v)} />
          <Toggle label="Активно" checked={state.isActive} onChange={(v) => set("isActive", v)} />
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Порядок
            <input
              type="number"
              value={state.sortOrder}
              onChange={(e) => set("sortOrder", e.target.value)}
              className="h-9 w-20 rounded-lg border border-line bg-ground px-2 text-ink"
            />
          </label>
        </div>

        <fieldset className="m-0 flex flex-wrap gap-x-5 gap-y-1 border-0 p-0">
          <legend className="mb-1.5 text-sm text-muted">Где используется</legend>
          {ATTRIBUTE_SIDES.map((side) => (
            <label key={side} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="radio"
                name="applies-to"
                checked={state.appliesTo === side}
                onChange={() => set("appliesTo", side)}
                className="accent-accent"
              />
              {ATTRIBUTE_SIDE_LABELS[side]}
            </label>
          ))}
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" loading={busy}>
            {initial ? "Сохранить" : "Создать поле"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Предпросмотр формы объявления: те же поля и та же проверка, что увидит продавец. */
function Preview({
  type,
  definitions,
  categories,
}: {
  type: ListingTypeDto;
  definitions: AttributeDefinitionDto[];
  categories: CategoryDto[];
}) {
  const [side, setSide] = useState<"offer" | "want">("offer");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const roots = categories.filter((c) => c.parentId === null);
  const [values, setValues] = useState<Record<string, AttributeValue>>({});
  const [checked, setChecked] = useState<Record<string, string> | null>(null);

  // Поля «Хочу получить» — без предмета из справочника, поэтому только общие.
  const applicable = useMemo(
    () => definitionsForCategory(definitions, side === "offer" && categoryId !== null ? [categoryId] : null),
    [definitions, side, categoryId],
  );
  const visible = useMemo(
    () => applicable.filter((d) => d.isActive && (d.appliesTo === "both" || d.appliesTo === side)),
    [applicable, side],
  );

  const check = () => {
    const result = buildAttributesSchema(applicable, side).safeParse(values);
    setChecked(result.success ? {} : fieldErrors(result.error));
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-extrabold">Предпросмотр формы</h3>
        {type.operations.includes("exchange") && (
          <div role="group" aria-label="Сторона" className="flex rounded-lg border border-line p-0.5">
            {(["offer", "want"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s}
                onClick={() => {
                  setSide(s);
                  setChecked(null);
                }}
                className={`h-8 rounded-md px-3 text-[13px] font-bold ${side === s ? "bg-surface-2 text-ink" : "text-muted"}`}
              >
                {s === "offer" ? "Отдаю" : "Хочу получить"}
              </button>
            ))}
          </div>
        )}
      </div>
      {roots.length > 0 && side === "offer" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">Категория предмета</span>
          <select
            value={categoryId ?? ""}
            onChange={(e) => {
              setCategoryId(e.target.value ? Number(e.target.value) : null);
              setChecked(null);
            }}
            className="h-11 rounded-xl border border-line bg-ground px-3 text-ink"
          >
            <option value="">Не выбрана</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {visible.length === 0 ? (
        <p className="m-0 text-sm text-muted">Активных полей нет — форма будет без характеристик.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          {visible.map((def) => (
            <AttributeField
              key={def.id}
              definition={def}
              value={values[def.key]}
              error={checked?.[def.key]}
              onChange={(value) =>
                setValues((v) => {
                  const next = { ...v };
                  if (value === undefined) delete next[def.key];
                  else next[def.key] = value;
                  return next;
                })
              }
            />
          ))}
          <Button type="submit" variant="secondary" className="self-start">
            Проверить заполнение
          </Button>
          {checked && Object.keys(checked).length === 0 && <Alert tone="success">Всё заполнено верно.</Alert>}
        </form>
      )}
    </Card>
  );
}
