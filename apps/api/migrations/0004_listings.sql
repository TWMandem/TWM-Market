-- Шаг 4: объявления, фотографии, избранное, история цен.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE listings (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES users (id),
  game_profile_id      uuid        NOT NULL REFERENCES game_profiles (id),
  server_id            smallint    NOT NULL REFERENCES servers (id),
  listing_type_id      smallint    NOT NULL REFERENCES listing_types (id),
  category_id          integer     REFERENCES categories (id),
  catalog_item_id      integer     REFERENCES catalog_items (id),
  operation            text        NOT NULL CHECK (operation IN ('sell', 'buy', 'exchange')),
  title                text        NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description          text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  -- Цена в игровых рублях. У обмена цены может не быть.
  price                bigint      CHECK (price IS NULL OR price BETWEEN 1 AND 1000000000000),
  quantity             integer     NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100000),
  transfer_mode        text        NOT NULL DEFAULT 'none' CHECK (transfer_mode IN ('none', 'seller_moves', 'buyer_moves')),
  -- Где проходит сделка (для транспорта: авторынок и/или нотариус).
  deal_places          text[]      NOT NULL DEFAULT '{}'
                                   CHECK (deal_places <@ ARRAY['car_market', 'notary']::text[]),
  attributes           jsonb       NOT NULL DEFAULT '{}',
  -- Обмен: что хотят получить взамен и доплата.
  want_listing_type_id smallint    REFERENCES listing_types (id),
  want_attributes      jsonb       NOT NULL DEFAULT '{}',
  want_description     text        NOT NULL DEFAULT '' CHECK (char_length(want_description) <= 1000),
  surcharge            bigint      CHECK (surcharge IS NULL OR surcharge BETWEEN 1 AND 1000000000000),
  surcharge_direction  text        CHECK (surcharge_direction IN ('i_pay', 'they_pay')),
  status               text        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft', 'moderation', 'active', 'rejected', 'sold', 'withdrawn', 'archived')),
  rejection_reason     text,
  views                integer     NOT NULL DEFAULT 0,
  published_at         timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Полнотекстовый поиск по названию и описанию.
  search_vector        tsvector GENERATED ALWAYS AS (
                         setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
                         setweight(to_tsvector('russian', coalesce(description, '')), 'C')
                       ) STORED,
  CHECK (operation = 'exchange' OR price IS NOT NULL),
  CHECK ((surcharge IS NULL) = (surcharge_direction IS NULL))
);

CREATE INDEX listings_catalog_idx ON listings (status, listing_type_id, server_id, published_at DESC);
CREATE INDEX listings_price_idx ON listings (status, listing_type_id, price);
CREATE INDEX listings_item_idx ON listings (catalog_item_id, server_id, status);
CREATE INDEX listings_category_idx ON listings (category_id, status);
CREATE INDEX listings_user_idx ON listings (user_id, status, updated_at DESC);
CREATE INDEX listings_expiry_idx ON listings (expires_at) WHERE status = 'active';
CREATE INDEX listings_search_idx ON listings USING gin (search_vector);
CREATE INDEX listings_title_trgm_idx ON listings USING gin (lower(title) gin_trgm_ops);
CREATE INDEX listings_attributes_idx ON listings USING gin (attributes jsonb_path_ops);

-- Ник продавца ищется с опечатками.
CREATE INDEX game_profiles_nick_trgm_idx ON game_profiles USING gin (lower(nickname) gin_trgm_ops);

CREATE TABLE listing_images (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  -- Пути к файлам относительно хранилища: полный размер и превью.
  full_path   text        NOT NULL,
  thumb_path  text        NOT NULL,
  width       integer     NOT NULL,
  height      integer     NOT NULL,
  bytes       integer     NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_main     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_images_listing_idx ON listing_images (listing_id, sort_order);
CREATE UNIQUE INDEX listing_images_main_uq ON listing_images (listing_id) WHERE is_main;

CREATE TABLE favorites (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  listing_id uuid        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX favorites_listing_idx ON favorites (listing_id);

-- История цены: из неё строятся графики и средние цены.
CREATE TABLE listing_price_history (
  id         bigserial   PRIMARY KEY,
  listing_id uuid        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  price      bigint      NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_price_history_idx ON listing_price_history (listing_id, changed_at);

-- Профиль, от имени которого есть объявления, нельзя удалить — только скрыть.
ALTER TABLE game_profiles ADD COLUMN archived_at timestamptz;
