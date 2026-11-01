-- Шаг 3: справочники площадки, двухфакторный вход, журнал действий администрации.

-- ── Разделы ───────────────────────────────────────────────────────────────
-- Код раздела фиксирован (от него зависит логика приложения), название и описание меняются в админке.
CREATE TABLE sections (
  id          smallserial PRIMARY KEY,
  code        text        NOT NULL UNIQUE CHECK (code IN ('items', 'cars', 'notary')),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sections (code, name, description, sort_order) VALUES
  ('items',  'Рынок предметов',      'Аксессуары и предметы с Центрального рынка и рынка ТЦ «Анашан». Продажа и скупка.', 1),
  ('cars',   'Авторынок',            'Весь транспорт в одном каталоге: продажа через авторынок «Анашан» или нотариальную контору.', 2),
  ('notary', 'Нотариальная контора', 'Дома, квартиры, бизнесы, SIM-карты и семейное имущество. Продажа и обмен с доплатой.', 3);

-- ── Типы имущества ────────────────────────────────────────────────────────
-- У каждого типа свой набор полей характеристик и свои допустимые операции.
CREATE TABLE listing_types (
  id          smallserial PRIMARY KEY,
  section_id  smallint    NOT NULL REFERENCES sections (id),
  code        text        NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  operations  text[]      NOT NULL CHECK (
                cardinality(operations) > 0
                AND operations <@ ARRAY['sell', 'buy', 'exchange']::text[]
              ),
  max_images  smallint    NOT NULL DEFAULT 10 CHECK (max_images BETWEEN 0 AND 20),
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Типы из технического задания. Транспорт живёт только в авторынке,
-- нотариальная контора ссылается на него, чтобы не было дублей.
INSERT INTO listing_types (section_id, code, name, operations, max_images, sort_order)
SELECT s.id, t.code, t.name, t.operations, t.max_images, t.sort_order
FROM (VALUES
  ('items',  'item',             'Предмет или аксессуар',      ARRAY['sell', 'buy'],             5,  1),
  ('cars',   'vehicle',          'Транспорт',                  ARRAY['sell', 'buy', 'exchange'], 10, 1),
  ('notary', 'sim_card',         'SIM-карта',                  ARRAY['sell', 'exchange'],        3,  1),
  ('notary', 'house',            'Дом',                        ARRAY['sell', 'exchange'],        10, 2),
  ('notary', 'apartment',        'Квартира',                   ARRAY['sell'],                    10, 3),
  ('notary', 'business',         'Бизнес',                     ARRAY['sell', 'exchange'],        10, 4),
  ('notary', 'family_mansion',   'Особняк семьи',              ARRAY['sell'],                    10, 5),
  ('notary', 'transport_company','Транспортная компания',      ARRAY['sell'],                    10, 6),
  ('notary', 'taxi_company',     'Таксопарк',                  ARRAY['sell'],                    10, 7),
  ('notary', 'diner',            'Закусочная',                 ARRAY['sell'],                    10, 8),
  ('notary', 'dorm_room',        'Комната в общежитии (для семьи)', ARRAY['sell'],               10, 9)
) AS t (section, code, name, operations, max_images, sort_order)
JOIN sections s ON s.code = t.section;

-- ── Категории ─────────────────────────────────────────────────────────────
-- Дерево в два уровня: категория → подкатегория. Наполняется в админке.
CREATE TABLE categories (
  id          serial      PRIMARY KEY,
  section_id  smallint    NOT NULL REFERENCES sections (id),
  parent_id   integer     REFERENCES categories (id),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_section_idx ON categories (section_id, parent_id, sort_order);
CREATE UNIQUE INDEX categories_name_uq ON categories (section_id, COALESCE(parent_id, 0), lower(name));

-- ── Справочник предметов и моделей ────────────────────────────────────────
-- Объявления будут ссылаться на запись справочника, а не на свободный текст:
-- так работают средние цены, подписки и сравнение.
CREATE TABLE catalog_items (
  id          serial      PRIMARY KEY,
  category_id integer     NOT NULL REFERENCES categories (id),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Другие названия, по которым игроки ищут предмет.
  aliases     text[]      NOT NULL DEFAULT '{}',
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_items_name_uq ON catalog_items (category_id, lower(name));

-- ── Конструктор полей характеристик ───────────────────────────────────────
CREATE TABLE attribute_definitions (
  id               serial      PRIMARY KEY,
  listing_type_id  smallint    NOT NULL REFERENCES listing_types (id),
  key              text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label            text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  data_type        text        NOT NULL CHECK (data_type IN ('number', 'text', 'select', 'multiselect', 'boolean')),
  unit             text        CHECK (unit IS NULL OR char_length(unit) <= 16),
  options          text[]      NOT NULL DEFAULT '{}',
  min_value        numeric,
  max_value        numeric,
  required         boolean     NOT NULL DEFAULT false,
  filterable       boolean     NOT NULL DEFAULT false,
  -- offer — что продают или отдают; want — что хотят получить при обмене.
  applies_to       text        NOT NULL DEFAULT 'offer' CHECK (applies_to IN ('offer', 'want', 'both')),
  help_text        text        CHECK (help_text IS NULL OR char_length(help_text) <= 200),
  is_active        boolean     NOT NULL DEFAULT true,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_type_id, key),
  CHECK (data_type NOT IN ('select', 'multiselect') OR cardinality(options) > 0),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

-- ── Двухфакторный вход (TOTP) ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN totp_secret_enc text,        -- секрет, зашифрованный ключом сервера
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step  bigint,      -- последний использованный интервал: код нельзя применить дважды
  ADD COLUMN blocked_reason  text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) <= 300),
  ADD COLUMN blocked_at      timestamptz;

-- Сессия, в которой администратор ввёл код из приложения-аутентификатора.
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- ── Журнал действий администрации ─────────────────────────────────────────
CREATE TABLE audit_log (
  id          bigserial   PRIMARY KEY,
  actor_id    uuid        REFERENCES users (id),
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb       NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);

-- Записи журнала нельзя изменить или удалить даже через базу данных напрямую
-- (кроме полной очистки таблицы, которая доступна только владельцу базы).
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Журнал действий нельзя изменять';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
