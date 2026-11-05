-- Уведомления веб-приложения (iPhone и браузеры): Web Push.
-- Подписка браузера (адрес службы уведомлений и ключи шифрования) хранится
-- у устройства; ключи VAPID сервера создаются один раз и лежат здесь.
ALTER TABLE push_devices DROP CONSTRAINT push_devices_platform_check;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform IN ('android', 'web'));
ALTER TABLE push_devices ADD COLUMN subscription jsonb;
ALTER TABLE push_devices ADD COLUMN endpoint text;
CREATE UNIQUE INDEX push_devices_endpoint_uq ON push_devices (endpoint) WHERE endpoint IS NOT NULL;

CREATE TABLE web_push_keys (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key  text        NOT NULL,
  private_key text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
