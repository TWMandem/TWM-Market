import { useState } from "react";
import type { ServerDto } from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { adminApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { attempt, useLoad } from "../../lib/use-load";
import { AdminTitle, hasRole } from "./AdminLayout";

export function ServersPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user?.role, "admin");
  const { data, setData, error } = useLoad(() => adminApi.servers(), []);

  const replace = (server: ServerDto) =>
    setData((d) => (d ? { items: d.items.map((s) => (s.number === server.number ? server : s)) } : d));

  return (
    <>
      <AdminTitle title="Серверы" />
      <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted">
        Скрытый сервер пропадает из выбора в приложении. «Открыт для перевода» — на него можно перевести аккаунт: такие
        серверы покажутся в фильтре «предложения с других серверов».
      </p>
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="flex flex-col gap-2">
          {data.items.map((server) => (
            <ServerRow key={server.number} server={server} canEdit={canEdit} onSaved={replace} />
          ))}
        </div>
      )}
      {canEdit && data && (
        <AddServer
          nextNumber={Math.max(0, ...data.items.map((s) => s.number)) + 1}
          onCreated={(s) => setData((d) => (d ? { items: [...d.items, s] } : d))}
        />
      )}
    </>
  );
}

function ServerRow({ server, canEdit, onSaved }: { server: ServerDto; canEdit: boolean; onSaved: (s: ServerDto) => void }) {
  const [draft, setDraft] = useState(server);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty =
    draft.name !== server.name ||
    draft.color.toLowerCase() !== server.color.toLowerCase() ||
    draft.isActive !== server.isActive ||
    draft.transferOpen !== server.transferOpen;

  const save = async () => {
    setBusy(true);
    let saved: ServerDto | null = null;
    setError(
      await attempt(async () => {
        saved = await adminApi.updateServer(server.number, {
          name: draft.name,
          color: draft.color,
          isActive: draft.isActive,
          transferOpen: draft.transferOpen,
        });
      }),
    );
    setBusy(false);
    if (saved) onSaved(saved);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="w-8 font-mono text-sm text-muted">{server.number}</span>
      <label className="flex items-center gap-2">
        <span className="sr-only">Цвет сервера {server.name}</span>
        <input
          type="color"
          value={draft.color}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })}
          className="size-9 cursor-pointer rounded-lg border border-line bg-transparent p-0.5 disabled:cursor-default"
        />
      </label>
      <label className="flex min-w-[160px] flex-1 items-center">
        <span className="sr-only">Название сервера {server.number}</span>
        <input
          value={draft.name}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-10 w-full rounded-lg border border-transparent bg-transparent px-2 font-bold text-ink hover:border-line focus:border-accent disabled:hover:border-transparent"
        />
      </label>
      <Toggle label="Активен" checked={draft.isActive} disabled={!canEdit} onChange={(v) => setDraft({ ...draft, isActive: v })} />
      <Toggle
        label="Открыт для перевода"
        checked={draft.transferOpen}
        disabled={!canEdit}
        onChange={(v) => setDraft({ ...draft, transferOpen: v })}
      />
      {canEdit && (
        <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty} loading={busy} onClick={() => void save()}>
          Сохранить
        </Button>
      )}
      {error && <span className="basis-full text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function AddServer({ nextNumber, onCreated }: { nextNumber: number; onCreated: (s: ServerDto) => void }) {
  const [number, setNumber] = useState(String(nextNumber));
  const [name, setName] = useState("");
  const [color, setColor] = useState("#74C0FC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    let created: ServerDto | null = null;
    setError(
      await attempt(async () => {
        created = await adminApi.createServer({ number: Number(number), name: name.trim(), color, sortOrder: Number(number) });
      }),
    );
    setBusy(false);
    if (created) {
      onCreated(created);
      setName("");
      setNumber(String(Number(number) + 1));
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="m-0 text-base font-extrabold">Добавить сервер</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Номер" className="w-28" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} />
        <Field label="Название (латиницей)" className="min-w-[200px] flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-server-color" className="text-sm text-muted">
            Цвет
          </label>
          <input
            id="new-server-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value.toUpperCase())}
            className="h-12 w-16 cursor-pointer rounded-xl border border-line bg-transparent p-1"
          />
        </div>
        <Button type="submit" loading={busy} className="h-12">
          Добавить
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-10 items-center gap-2 text-sm ${disabled ? "text-muted" : "cursor-pointer text-ink-2"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] accent-accent"
      />
      {label}
    </label>
  );
}
