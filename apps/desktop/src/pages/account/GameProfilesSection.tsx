import { useCallback, useEffect, useState } from "react";
import {
  MAX_GAME_PROFILES,
  NICKNAME_CHANGE_COOLDOWN_DAYS,
  createGameProfileSchema,
  updateGameProfileSchema,
  type GameProfileDto,
} from "@twm/shared";
import { Alert, Button, Card, Field } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useServers } from "../../lib/server-context";
import { useForm } from "../../lib/use-form";
import { VerifyNicknameDialog } from "./VerifyNicknameDialog";

export function GameProfilesSection() {
  const [profiles, setProfiles] = useState<GameProfileDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfiles((await api.gameProfiles()).items);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Не удалось загрузить профили");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (updated: GameProfileDto) =>
    setProfiles((list) => list?.map((p) => (p.id === updated.id ? updated : p)) ?? null);

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[17px] font-extrabold">Игровые профили</h2>
        <p className="m-0 max-w-[640px] text-sm leading-relaxed text-muted">
          От имени профиля вы будете публиковать объявления. Мы храним только ник и сервер — доступа к игровому аккаунту у
          площадки нет. Пока ники не подтверждаются, покупатели видят пометку «указан продавцом».
        </p>
      </div>

      {loadError && <Alert>{loadError}</Alert>}
      {profiles === null && !loadError && <p className="m-0 text-sm text-muted">Загружаю…</p>}

      {profiles && profiles.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onUpdated={replace}
              onDeleted={() => setProfiles((list) => list?.filter((p) => p.id !== profile.id) ?? null)}
            />
          ))}
        </ul>
      )}

      {profiles && profiles.length < MAX_GAME_PROFILES && (
        <AddProfileForm onCreated={(p) => setProfiles((list) => [...(list ?? []), p])} />
      )}
    </Card>
  );
}

function AddProfileForm({ onCreated }: { onCreated: (profile: GameProfileDto) => void }) {
  const { servers, current } = useServers();
  const form = useForm(
    createGameProfileSchema,
    { nickname: "", serverNumber: current?.number ?? (undefined as number | undefined) },
    async (data) => {
      onCreated(await api.createGameProfile(data));
      form.set("nickname", "");
    },
  );

  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-3 border-t border-line-soft pt-5">
      <h3 className="m-0 text-[15px] font-bold">Добавить профиль</h3>
      {form.formError && <Alert>{form.formError}</Alert>}
      <div className="flex flex-wrap items-start gap-3">
        <Field
          label="Игровой ник"
          className="min-w-[220px] flex-[2_1_220px]"
          placeholder="Например, Ivan_Petrov"
          value={form.values.nickname}
          onChange={(e) => form.set("nickname", e.target.value)}
          error={form.errors.nickname}
        />
        <div className="flex min-w-[180px] flex-[1_1_180px] flex-col gap-1.5">
          <label htmlFor="profile-server" className="text-sm text-muted">
            Сервер
          </label>
          <select
            id="profile-server"
            value={form.values.serverNumber ?? ""}
            onChange={(e) => form.set("serverNumber", e.target.value ? Number(e.target.value) : undefined)}
            aria-invalid={form.errors.serverNumber ? true : undefined}
            className={`h-12 rounded-xl border bg-ground px-3 text-ink ${form.errors.serverNumber ? "border-[#c45555]" : "border-line"}`}
          >
            <option value="">Выберите сервер</option>
            {servers.map((s) => (
              <option key={s.number} value={s.number}>
                {s.number} · {s.name}
              </option>
            ))}
          </select>
          {form.errors.serverNumber && <span className="text-[13px] text-danger">{form.errors.serverNumber}</span>}
        </div>
        <Button type="submit" loading={form.submitting} className="mt-[26px] h-12">
          Добавить
        </Button>
      </div>
    </form>
  );
}

interface ProfileRowProps {
  profile: GameProfileDto;
  onUpdated: (profile: GameProfileDto) => void;
  onDeleted: () => void;
}

function ProfileRow({ profile, onUpdated, onDeleted }: ProfileRowProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const form = useForm(updateGameProfileSchema, { nickname: profile.nickname }, async ({ nickname }) => {
    onUpdated(await api.renameGameProfile(profile.id, nickname));
    setMode("view");
  });

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteGameProfile(profile.id);
      onDeleted();
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : "Не удалось удалить профиль");
      setDeleting(false);
    }
  };

  const lockedUntil = profile.nicknameChangeAvailableAt
    ? new Date(profile.nicknameChangeAvailableAt).toLocaleDateString("ru-RU")
    : null;

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: profile.server.color }} />
        <span className="font-mono text-[15px] font-bold">{profile.nickname}</span>
        <span className="text-sm text-muted">
          {profile.server.number} · {profile.server.name}
        </span>
        {profile.verified ? (
          <span className="rounded-md border border-[#24503a] px-2 py-0.5 text-xs font-bold text-success">✔ подтверждён</span>
        ) : (
          <button
            type="button"
            onClick={() => setVerifying(true)}
            className="rounded-md border border-dashed border-[#3a404c] px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-ink"
          >
            не подтверждён · подтвердить
          </button>
        )}
        {verifying && <VerifyNicknameDialog profile={profile} onClose={() => setVerifying(false)} />}
        <div className="ml-auto flex gap-1">
          {mode === "view" && (
            <>
              <Button
                variant="ghost"
                onClick={() => setMode("edit")}
                disabled={lockedUntil !== null}
                title={lockedUntil ? `Ник можно будет сменить ${lockedUntil}` : undefined}
              >
                Сменить ник
              </Button>
              <Button variant="ghost" onClick={() => setMode("confirm-delete")}>
                Удалить
              </Button>
            </>
          )}
        </div>
      </div>

      {profile.sameNicknameCount > 0 && (
        <Alert tone="warning">
          Такой же ник на этом сервере указан ещё у {profile.sameNicknameCount}{" "}
          {profile.sameNicknameCount === 1 ? "пользователя" : "пользователей"}. Покупатели увидят предупреждение
          сверить ник в игре.
        </Alert>
      )}
      {lockedUntil && mode === "view" && (
        <span className="text-[13px] text-faint">Следующая смена ника — {lockedUntil}.</span>
      )}

      {mode === "edit" && (
        <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-3">
          {form.formError && <Alert>{form.formError}</Alert>}
          <div className="flex flex-wrap items-start gap-3">
            <Field
              label="Новый ник"
              className="min-w-[220px] flex-1"
              autoFocus
              value={form.values.nickname}
              onChange={(e) => form.set("nickname", e.target.value)}
              error={form.errors.nickname}
              hint={`Ник можно менять не чаще раза в ${NICKNAME_CHANGE_COOLDOWN_DAYS} дней. Старый ник сохранится в истории.`}
            />
            <div className="mt-[26px] flex gap-2">
              <Button type="submit" loading={form.submitting} className="h-12">
                Сохранить
              </Button>
              <Button variant="secondary" className="h-12" onClick={() => setMode("view")}>
                Отмена
              </Button>
            </div>
          </div>
        </form>
      )}

      {mode === "confirm-delete" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-2">Удалить профиль {profile.nickname}?</span>
          <Button variant="danger" loading={deleting} onClick={() => void remove()}>
            Удалить
          </Button>
          <Button variant="secondary" onClick={() => setMode("view")}>
            Отмена
          </Button>
          {deleteError && <span className="text-[13px] text-danger">{deleteError}</span>}
        </div>
      )}
    </li>
  );
}
