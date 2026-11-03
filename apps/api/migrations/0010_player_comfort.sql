-- Удобство для игроков: поднятие объявлений, статус «в сети»,
-- шаблоны ответов в переписке и чёрный список.

-- Поднятие: объявление снова оказывается вверху «Новых», не чаще раза в сутки.
ALTER TABLE listings ADD COLUMN bumped_at timestamptz;
CREATE INDEX listings_fresh_idx ON listings ((COALESCE(bumped_at, published_at)) DESC) WHERE status = 'active';

-- Когда игрок последний раз пользовался приложением; показывать ли это другим.
ALTER TABLE users
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN show_online  boolean NOT NULL DEFAULT true;

-- Свои заготовки ответов в переписке.
CREATE TABLE chat_templates (
  id         serial      PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_templates_user_idx ON chat_templates (user_id, sort_order, id);

-- Чёрный список: заблокированный игрок не может начать переписку и писать.
CREATE TABLE user_blocks (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);
