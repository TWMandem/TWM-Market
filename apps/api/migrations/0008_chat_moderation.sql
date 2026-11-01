-- Шаг 5: переписка по объявлению, сделки и отзывы, уведомления,
-- жалобы, стоп-слова и модерация.

-- ── Переписка ─────────────────────────────────────────────────────────────
-- Один диалог на пару «объявление — покупатель». Продавец — автор объявления.
CREATE TABLE conversations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          uuid        NOT NULL REFERENCES listings (id),
  buyer_id            uuid        NOT NULL REFERENCES users (id),
  seller_id           uuid        NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  buyer_last_read_at  timestamptz NOT NULL DEFAULT now(),
  seller_last_read_at timestamptz NOT NULL DEFAULT '-infinity',
  UNIQUE (listing_id, buyer_id),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX conversations_buyer_idx ON conversations (buyer_id, last_message_at DESC);
CREATE INDEX conversations_seller_idx ON conversations (seller_id, last_message_at DESC);

CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- NULL — служебное сообщение площадки (сделка предложена, подтверждена…).
  sender_id       uuid        REFERENCES users (id),
  kind            text        NOT NULL DEFAULT 'text'
                              CHECK (kind IN ('text', 'image', 'deal_proposed', 'deal_confirmed', 'deal_cancelled')),
  body            text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  image_path      text,
  image_width     integer,
  image_height    integer,
  -- Найдено стоп-слово: сообщение доставлено, но попало в очередь модерации.
  flagged         boolean     NOT NULL DEFAULT false,
  flag_reason     text,
  -- Скрыто модератором: текст больше не показывается участникам.
  hidden_at       timestamptz,
  hidden_by       uuid        REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'image' OR image_path IS NOT NULL)
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_flagged_idx ON messages (created_at DESC) WHERE flagged AND hidden_at IS NULL;

-- ── Сделки и отзывы ───────────────────────────────────────────────────────
-- Сделку предлагает одна сторона, подтверждает другая. Только после
-- подтверждения обе стороны могут оставить отзыв.
CREATE TABLE deals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL UNIQUE REFERENCES conversations (id),
  listing_id      uuid        NOT NULL REFERENCES listings (id),
  buyer_id        uuid        NOT NULL REFERENCES users (id),
  seller_id       uuid        NOT NULL REFERENCES users (id),
  proposed_by     uuid        NOT NULL REFERENCES users (id),
  status          text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'cancelled')),
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE INDEX deals_buyer_idx ON deals (buyer_id, status);
CREATE INDEX deals_seller_idx ON deals (seller_id, status);

CREATE TABLE reviews (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid        NOT NULL REFERENCES deals (id),
  author_id  uuid        NOT NULL REFERENCES users (id),
  target_id  uuid        NOT NULL REFERENCES users (id),
  positive   boolean     NOT NULL,
  comment    text        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
  hidden_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, author_id),
  CHECK (author_id <> target_id)
);
CREATE INDEX reviews_target_idx ON reviews (target_id, created_at DESC);

-- ── Уведомления ───────────────────────────────────────────────────────────
-- Приложение раз в несколько секунд спрашивает новые уведомления
-- и показывает их во всплывающих окнах Windows.
CREATE TABLE notifications (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id),
  kind       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL DEFAULT '',
  -- Куда вести по щелчку: #/chats/…, #/listing/…
  link       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ── Жалобы ────────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL — жалобу создала площадка сама (стоп-слово).
  author_id   uuid        REFERENCES users (id),
  target_type text        NOT NULL CHECK (target_type IN ('listing', 'message', 'user', 'review')),
  target_id   text        NOT NULL,
  reason      text        NOT NULL CHECK (reason IN (
                            'real_money', 'scam', 'wrong_info', 'duplicate', 'insult', 'spam', 'other', 'stop_word')),
  comment     text        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by uuid        REFERENCES users (id),
  resolved_at timestamptz,
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
-- Одна открытая жалоба от игрока на один объект.
CREATE UNIQUE INDEX reports_one_open_uq ON reports (author_id, target_type, target_id) WHERE status = 'open';

-- ── Стоп-слова ────────────────────────────────────────────────────────────
-- Защита от торговли за реальные деньги и выманивания денег. Совпадение
-- ищется без учёта регистра; объявление уходит на проверку, сообщение
-- доставляется, но попадает в очередь модерации.
CREATE TABLE stop_words (
  id         serial      PRIMARY KEY,
  phrase     text        NOT NULL CHECK (char_length(phrase) BETWEEN 2 AND 60),
  -- Регулярное выражение вместо простой фразы (для номеров карт, ссылок).
  is_regex   boolean     NOT NULL DEFAULT false,
  note       text,
  -- Без внешнего ключа: список не должен зависеть от удаления аккаунтов.
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stop_words_phrase_uq ON stop_words (lower(phrase));

INSERT INTO stop_words (phrase, is_regex, note) VALUES
  ('реальные деньги', false, 'Торговля за реальные деньги запрещена'),
  ('за реал', false, 'Торговля за реальные деньги запрещена'),
  ('реальных рублей', false, 'Торговля за реальные деньги запрещена'),
  ('переводом на карту', false, 'Оплата вне игры'),
  ('на карту', false, 'Оплата вне игры'),
  ('сбербанк', false, 'Оплата вне игры'),
  ('тинькофф', false, 'Оплата вне игры'),
  ('qiwi', false, 'Оплата вне игры'),
  ('юмани', false, 'Оплата вне игры'),
  ('криптовалют', false, 'Оплата вне игры'),
  ('donationalerts', false, 'Оплата вне игры'),
  ('(?:\d[ -]?){15}\d', true, 'Похоже на номер банковской карты'),
  ('(https?://|www\.)', true, 'Ссылка на сторонний сайт'),
  ('(t\.me|vk\.com|discord\.gg)/', true, 'Ссылка на мессенджер или соцсеть');

-- ── Объявления на проверке ────────────────────────────────────────────────
-- Почему объявление на проверке: найдено стоп-слово или пришли жалобы.
ALTER TABLE listings ADD COLUMN moderation_reason text;
CREATE INDEX listings_moderation_idx ON listings (updated_at) WHERE status = 'moderation';
