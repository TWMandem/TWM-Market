import { randomBytes } from "node:crypto";
import type { Sql } from "../db/client.js";
import { removeMedia, removeMediaDir } from "./media.js";

export interface DeletionResult {
  login: string;
  listingsDeleted: number;
  listingsWithdrawn: number;
  profilesDeleted: number;
  profilesKept: number;
}

/**
 * Удаление аккаунта по просьбе владельца (политика конфиденциальности, раздел
 * «Ваши возможности»). Удаляется всё, что принадлежит только этому игроку.
 * То, без чего непонятна история другого игрока (переписка, сделки, отзывы),
 * остаётся, но без логина и email: аккаунт обезличивается и блокируется.
 */
export async function deleteAccount(
  sql: Sql,
  userId: string,
  dirs: { uploadDir: string; privateDir: string },
  source: "cli" | "self" = "cli",
): Promise<DeletionResult> {
  const files: string[] = [];
  const listingDirs: string[] = [];
  const tag = randomBytes(4).toString("hex");

  const result = await sql.begin(async (tx) => {
    const [user] = await tx<{ login: string }[]>`SELECT login FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!user) throw new Error("Пользователь не найден");

    // Объявления: без переписки — удаляем целиком, с перепиской — снимаем,
    // а фото и описание удаляем (название остаётся в истории переписки собеседника).
    const listings = await tx<{ id: string; referenced: boolean }[]>`
      SELECT l.id, EXISTS (SELECT 1 FROM conversations c WHERE c.listing_id = l.id) AS referenced
      FROM listings l WHERE l.user_id = ${userId}`;
    const removable = listings.filter((l) => !l.referenced).map((l) => l.id);
    const kept = listings.filter((l) => l.referenced).map((l) => l.id);
    for (const id of listings.map((l) => l.id)) listingDirs.push(`listings/${id}`);
    if (removable.length > 0) await tx`DELETE FROM listings WHERE id = ANY(${removable}::uuid[])`;
    if (kept.length > 0) {
      await tx`DELETE FROM listing_images WHERE listing_id = ANY(${kept}::uuid[])`;
      await tx`
        UPDATE listings SET
          status = CASE WHEN status IN ('active', 'moderation', 'draft') THEN 'withdrawn' ELSE status END,
          description = '', want_description = '', attributes = '{}'::jsonb, want_attributes = '{}'::jsonb, updated_at = now()
        WHERE id = ANY(${kept}::uuid[])`;
    }

    // Игровые профили: свободные удаляем, занятые снятыми объявлениями — обезличиваем.
    const verifications = await tx<{ imagePath: string | null }[]>`
      DELETE FROM nickname_verifications WHERE user_id = ${userId} RETURNING image_path`;
    for (const v of verifications) if (v.imagePath) files.push(v.imagePath);
    const deletedProfiles = await tx`
      DELETE FROM game_profiles p WHERE p.user_id = ${userId}
        AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.game_profile_id = p.id)`;
    const keptProfiles = await tx<{ id: string }[]>`SELECT id FROM game_profiles WHERE user_id = ${userId} ORDER BY created_at`;
    for (const [index, profile] of keptProfiles.entries()) {
      await tx`DELETE FROM game_profile_history WHERE profile_id = ${profile.id}`;
      await tx`
        UPDATE game_profiles SET nickname = ${`Deleted_${tag}_${index + 1}`}, verified_at = NULL, verified_by = NULL,
          archived_at = COALESCE(archived_at, now()), updated_at = now()
        WHERE id = ${profile.id}`;
    }

    // Личное и служебное — только этого игрока.
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
    await tx`DELETE FROM email_codes WHERE user_id = ${userId}`;
    await tx`DELETE FROM favorites WHERE user_id = ${userId}`;
    await tx`DELETE FROM saved_searches WHERE user_id = ${userId}`;
    await tx`DELETE FROM chat_templates WHERE user_id = ${userId}`;
    await tx`DELETE FROM user_blocks WHERE user_id = ${userId} OR blocked_id = ${userId}`;
    await tx`DELETE FROM user_activity_daily WHERE user_id = ${userId}`;
    await tx`DELETE FROM notifications WHERE user_id = ${userId}`;
    await tx`UPDATE app_errors SET user_id = NULL WHERE user_id = ${userId}`;

    // Аккаунт: без логина, email и пароля; войти в него больше нельзя.
    await tx`
      UPDATE users SET
        login = ${`deleted_${tag}`},
        email = ${`deleted-${userId}@deleted.invalid`},
        password_hash = ${`!deleted-${randomBytes(16).toString("hex")}`},
        status = 'blocked', blocked_reason = 'Аккаунт удалён по просьбе владельца', blocked_at = now(),
        email_verified_at = NULL, totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
        last_seen_at = NULL, show_online = false, last_login_at = NULL, updated_at = now()
      WHERE id = ${userId}`;
    await tx`
      INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
      VALUES (NULL, 'user.deleted_on_request', 'user', ${userId},
              ${tx.json({ source, listingsDeleted: removable.length, listingsWithdrawn: kept.length })})`;

    return {
      login: user.login,
      listingsDeleted: removable.length,
      listingsWithdrawn: kept.length,
      profilesDeleted: deletedProfiles.count,
      profilesKept: keptProfiles.length,
    };
  });

  // Файлы удаляем после успешной транзакции.
  for (const dir of listingDirs) await removeMediaDir(dirs.uploadDir, dir);
  await removeMedia(dirs.privateDir, files);
  return result;
}
