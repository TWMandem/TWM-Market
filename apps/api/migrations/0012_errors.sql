-- Ошибки приложения у игроков и внутренние ошибки сервера (500).
-- Нужны, чтобы находить сбои раньше, чем о них напишут. Хранятся 30 дней.

CREATE TABLE app_errors (
  id          bigserial   PRIMARY KEY,
  source      text        NOT NULL CHECK (source IN ('app', 'server')),
  -- Одинаковые ошибки группируются по отпечатку (источник, текст, первая строка стека).
  fingerprint text        NOT NULL,
  message     text        NOT NULL CHECK (char_length(message) <= 500),
  stack       text        NOT NULL DEFAULT '' CHECK (char_length(stack) <= 4000),
  route       text        NOT NULL DEFAULT '' CHECK (char_length(route) <= 200),
  app_version text        NOT NULL DEFAULT '' CHECK (char_length(app_version) <= 20),
  user_id     uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_errors_created_idx ON app_errors (created_at DESC);
CREATE INDEX app_errors_fingerprint_idx ON app_errors (fingerprint, created_at DESC);
