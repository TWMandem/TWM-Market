-- Шаг 6: статистика просмотров и активности, история цен, подписки на поиск.

-- Просмотры объявления по дням — для статистики продавца и дашборда.
CREATE TABLE listing_views_daily (
  listing_id uuid    NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  day        date    NOT NULL,
  views      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day)
);
CREATE INDEX listing_views_daily_day_idx ON listing_views_daily (day);

-- Игроки, заходившие в приложение, по дням («активные пользователи»).
CREATE TABLE user_activity_daily (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX user_activity_daily_day_idx ON user_activity_daily (day);

-- Цены предложений о продаже по дням (снимок раз в час): основа графика
-- «история цены» предмета или модели на сервере.
CREATE TABLE price_snapshots (
  catalog_item_id integer  NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
  server_id       smallint NOT NULL REFERENCES servers (id),
  day             date     NOT NULL,
  offers          integer  NOT NULL,
  median          bigint   NOT NULL,
  average         bigint   NOT NULL,
  min             bigint   NOT NULL,
  max             bigint   NOT NULL,
  PRIMARY KEY (catalog_item_id, server_id, day)
);

-- Подписки на поиск: сохранённые фильтры каталога. Когда появляется
-- подходящее объявление, игрок получает уведомление.
CREATE TABLE saved_searches (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- Раздел каталога и параметры фильтра в виде строки адреса (category=3&priceMax=…).
  section          text        NOT NULL CHECK (section IN ('items', 'cars', 'notary', 'search')),
  params           text        NOT NULL DEFAULT '' CHECK (char_length(params) <= 1000),
  notify           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Когда игрок последний раз открывал подписку: от этой даты считаются «новые».
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz
);
CREATE INDEX saved_searches_user_idx ON saved_searches (user_id, created_at);
CREATE INDEX saved_searches_notify_idx ON saved_searches (section) WHERE notify;
