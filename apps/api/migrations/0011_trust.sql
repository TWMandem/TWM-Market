-- Доверие к сделкам: заявки на подтверждение ника в игре.
-- Игрок присылает скриншот статистики персонажа (видно только ник),
-- модератор сверяет и подтверждает. Скриншоты лежат вне публичной папки
-- и удаляются после решения.

CREATE TABLE nickname_verifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_profile_id uuid        NOT NULL REFERENCES game_profiles (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Ник на момент заявки: если его сменят, заявка закрывается.
  nickname        text        NOT NULL,
  -- Одноразовый код: если получится, игрок пишет его в игровой чат на скриншоте.
  code            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  image_path      text,
  reject_reason   text,
  decided_by      uuid        REFERENCES users (id),
  decided_at      timestamptz,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Одна открытая заявка на профиль.
CREATE UNIQUE INDEX nickname_verifications_open_uq ON nickname_verifications (game_profile_id)
  WHERE status IN ('draft', 'pending');
CREATE INDEX nickname_verifications_queue_idx ON nickname_verifications (submitted_at) WHERE status = 'pending';

ALTER TABLE game_profiles ADD COLUMN verified_by uuid REFERENCES users (id);
