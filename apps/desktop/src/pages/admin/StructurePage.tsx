import { useState } from "react";
import { OPERATION_LABELS, type ListingTypeDto, type Operation, type SectionDto } from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";
import { Toggle } from "./ServersPage";

const OPS: Operation[] = ["sell", "buy", "exchange"];

/** Разделы площадки и типы имущества в каждом из них. */
export function StructurePage() {
  const { user } = useAuth();
  const canEdit = hasRole(user?.role, "admin");
  const sections = useLoad(() => adminApi.sections(), []);
  const types = useLoad(() => adminApi.listingTypes(), []);

  const error = sections.error ?? types.error;

  return (
    <>
      <AdminTitle title="Разделы и типы имущества" />
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        У каждого типа имущества свой набор полей характеристик (в «Конструкторе полей») и свои операции. Код типа
        задаётся один раз и потом не меняется.
      </p>
      {error && <Alert>{error}</Alert>}
      {sections.data &&
        types.data &&
        sections.data.items.map((section) => (
          <SectionCard
            key={section.code}
            section={section}
            types={types.data!.items.filter((t) => t.sectionCode === section.code)}
            canEdit={canEdit}
            onSectionSaved={(s) =>
              sections.setData((d) => (d ? { items: d.items.map((x) => (x.code === s.code ? s : x)) } : d))
            }
            onTypeSaved={(t) =>
              types.setData((d) => {
                if (!d) return d;
                const exists = d.items.some((x) => x.id === t.id);
                return { items: exists ? d.items.map((x) => (x.id === t.id ? t : x)) : [...d.items, t] };
              })
            }
          />
        ))}
    </>
  );
}

interface SectionCardProps {
  section: SectionDto;
  types: ListingTypeDto[];
  canEdit: boolean;
  onSectionSaved: (s: SectionDto) => void;
  onTypeSaved: (t: ListingTypeDto) => void;
}

function SectionCard({ section, types, canEdit, onSectionSaved, onTypeSaved }: SectionCardProps) {
  const [name, setName] = useState(section.name);
  const [description, setDescription] = useState(section.description);
  const [isActive, setIsActive] = useState(section.isActive);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = name !== section.name || description !== section.description || isActive !== section.isActive;

  const save = async () => {
    setBusy(true);
    let saved: SectionDto | null = null;
    setError(
      await attempt(async () => {
        saved = await adminApi.updateSection(section.code, { name, description, isActive });
      }),
    );
    setBusy(false);
    if (saved) onSectionSaved(saved);
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Название раздела" className="min-w-[220px] flex-1" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        <div className="mt-[26px] flex items-center gap-3">
          <Toggle label="Показывать" checked={isActive} disabled={!canEdit} onChange={setIsActive} />
          {canEdit && (
            <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty} loading={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          )}
        </div>
        <div className="flex basis-full flex-col gap-1.5">
          <label htmlFor={`section-${section.code}-desc`} className="text-sm text-muted">
            Описание на главной
          </label>
          <textarea
            id={`section-${section.code}-desc`}
            rows={2}
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-y rounded-xl border border-line bg-ground px-3.5 py-2.5 leading-relaxed text-ink outline-none focus:border-accent"
          />
        </div>
        {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="m-0 text-[15px] font-bold">Типы имущества</h3>
        {types.length === 0 && <p className="m-0 text-sm text-muted">Пока нет типов.</p>}
        {types.map((t) => (
          <TypeRow key={t.id} type={t} canEdit={canEdit} onSaved={onTypeSaved} />
        ))}
        {canEdit && <AddType sectionCode={section.code} onCreated={onTypeSaved} />}
      </div>
    </Card>
  );
}

function OperationsPicker({
  value,
  onChange,
  disabled,
}: {
  value: Operation[];
  onChange: (v: Operation[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
      <legend className="sr-only">Операции</legend>
      {OPS.map((op) => (
        <Toggle
          key={op}
          label={OPERATION_LABELS[op]}
          checked={value.includes(op)}
          disabled={disabled}
          onChange={(on) => onChange(on ? [...value, op] : value.filter((v) => v !== op))}
        />
      ))}
    </fieldset>
  );
}

function TypeRow({ type, canEdit, onSaved }: { type: ListingTypeDto; canEdit: boolean; onSaved: (t: ListingTypeDto) => void }) {
  const [draft, setDraft] = useState(type);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty =
    draft.name !== type.name ||
    draft.isActive !== type.isActive ||
    draft.maxImages !== type.maxImages ||
    [...draft.operations].sort().join() !== [...type.operations].sort().join();

  const save = async () => {
    setBusy(true);
    let saved: ListingTypeDto | null = null;
    setError(
      await attempt(async () => {
        saved = await adminApi.updateListingType(type.id, {
          name: draft.name,
          isActive: draft.isActive,
          maxImages: draft.maxImages,
          operations: draft.operations,
        });
      }),
    );
    setBusy(false);
    if (saved) onSaved(saved);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface-2 px-4 py-2.5">
      <label className="flex min-w-[200px] flex-1 items-center gap-2">
        <span className="sr-only">Название типа {type.code}</span>
        <input
          value={draft.name}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-10 w-full rounded-lg border border-transparent bg-transparent px-2 font-bold text-ink hover:border-line focus:border-accent disabled:hover:border-transparent"
        />
      </label>
      <span className="font-mono text-xs text-faint">{type.code}</span>
      <OperationsPicker value={draft.operations} disabled={!canEdit} onChange={(operations) => setDraft({ ...draft, operations })} />
      <label className="flex items-center gap-2 text-sm text-ink-2">
        Фото до
        <input
          type="number"
          min={0}
          max={20}
          value={draft.maxImages}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, maxImages: Number(e.target.value) })}
          className="h-9 w-16 rounded-lg border border-line bg-ground px-2 text-ink"
        />
      </label>
      <Toggle label="Активен" checked={draft.isActive} disabled={!canEdit} onChange={(isActive) => setDraft({ ...draft, isActive })} />
      {canEdit && (
        <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty} loading={busy} onClick={() => void save()}>
          Сохранить
        </Button>
      )}
      {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function AddType({ sectionCode, onCreated }: { sectionCode: SectionDto["code"]; onCreated: (t: ListingTypeDto) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [operations, setOperations] = useState<Operation[]>(["sell"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" className="-ml-2 self-start" onClick={() => setOpen(true)}>
        + Добавить тип
      </Button>
    );
  }

  const submit = async () => {
    setBusy(true);
    let created: ListingTypeDto | null = null;
    setError(
      await attempt(async () => {
        created = await adminApi.createListingType({ sectionCode, code: code.trim(), name: name.trim(), operations });
      }),
    );
    setBusy(false);
    if (created) {
      onCreated(created);
      setOpen(false);
      setCode("");
      setName("");
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Field label="Название" className="min-w-[200px] flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Код (латиница, навсегда)"
          className="min-w-[200px] flex-1"
          value={code}
          onChange={(e) => setCode(e.target.value.toLowerCase())}
          hint="Например: garage"
        />
      </div>
      <OperationsPicker value={operations} onChange={setOperations} />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Создать
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
