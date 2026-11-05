-- Устройства Android для фоновых уведомлений. Приложение раз в ~15 минут
-- спрашивает сервер, есть ли новые уведомления, по отдельному ключу устройства.
-- Ключ годится только для чтения уведомлений: войти по нему или что-то
-- изменить нельзя. В базе хранится только его хеш.
CREATE TABLE push_devices (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  platform     text        NOT NULL CHECK (platform IN ('android')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id, created_at DESC);
