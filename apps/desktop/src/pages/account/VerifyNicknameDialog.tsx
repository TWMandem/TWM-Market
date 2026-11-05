import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { GameProfileDto, NicknameVerificationDto } from "@twm/shared";
import { Modal } from "../../components/ReportDialog";
import { Alert, Button } from "../../components/ui";
import { ApiError, api } from "../../lib/api";

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Подтверждение ника: скриншот статистики персонажа, где виден только ник.
 * Модератор сверяет ник и, если получилось, код в игровом чате.
 */
export function VerifyNicknameDialog({ profile, onClose }: { profile: GameProfileDto; onClose: () => void }) {
  const [state, setState] = useState<NicknameVerificationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .nicknameVerification(profile.id)
      .then(setState)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Не удалось открыть заявку"));
  }, [profile.id]);

  const send = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Подходят изображения PNG, JPG и WebP");
      return;
    }
    setSending(true);
    setError(null);
    try {
      setState(await api.sendNicknameScreenshot(profile.id, file, file.name || "stats.png"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить скриншот");
    } finally {
      setSending(false);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      void send(file);
    }
  };

  return (
    <Modal title={`Подтверждение ника ${profile.nickname}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-ink-2" onPaste={onPaste}>
        {error && <Alert>{error}</Alert>}
        {!state && !error && <p className="m-0 text-muted">Загружаю…</p>}
        {state?.status === "verified" && <Alert tone="success">Ник подтверждён — в объявлениях рядом с ним стоит отметка ✔.</Alert>}
        {state?.status === "pending" && (
          <Alert tone="info">
            Скриншот на проверке у модератора{state.submittedAt ? ` (отправлен ${when(state.submittedAt)})` : ""}. Придёт уведомление. Если
            нужно, можно отправить другой скриншот — он заменит прежний.
          </Alert>
        )}
        {state?.rejectReason && state.status === "draft" && <Alert>Прошлый скриншот не подошёл: {state.rejectReason}</Alert>}

        {state && state.status !== "verified" && (
          <>
            <ol className="m-0 flex flex-col gap-2 pl-5">
              <li>В игре на сервере {profile.server.name} откройте статистику своего персонажа.</li>
              <li>
                Сделайте скриншот, на котором виден ник <span className="font-mono font-bold text-ink">{profile.nickname}</span>.
              </li>
              <li>
                <span className="font-bold text-ink">Всё остальное замажьте</span> — деньги, уровень, имущество, номер телефона и другие
                данные (например, в Paint). Модератору нужен только ник.
              </li>
              {state.code && (
                <li>
                  Если получится, напишите в игровой чат код <span className="select-all font-mono font-bold text-accent-ink">{state.code}</span> так,
                  чтобы он попал на тот же скриншот, — так проверка пройдёт быстрее.
                </li>
              )}
            </ol>
            <p className="m-0 text-[13px] text-faint">
              Скриншот видят только модераторы, он удаляется сразу после проверки. Подтверждение снимается, если сменить ник.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void send(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={sending} onClick={() => fileInput.current?.click()}>
                {state.status === "pending" ? "Заменить скриншот" : "Загрузить скриншот"}
              </Button>
              <span className="text-[13px] text-muted">или вставьте его сюда: Ctrl+V</span>
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </Modal>
  );
}
