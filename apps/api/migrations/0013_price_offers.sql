-- Предложение цены в переписке: торг до встречи в игре.
-- Одна сторона предлагает цену, другая принимает, отклоняет или предлагает свою.
-- Согласованная цена записывается в сделку и учитывается в истории цен.

CREATE TABLE price_offers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  author_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  price           bigint      NOT NULL CHECK (price > 0),
  -- pending — ждёт ответа; countered — собеседник предложил свою цену.
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'countered')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz
);

-- В переписке одновременно ждёт ответа не больше одного предложения.
CREATE UNIQUE INDEX price_offers_pending_uq ON price_offers (conversation_id) WHERE status = 'pending';
CREATE INDEX price_offers_conversation_idx ON price_offers (conversation_id, created_at DESC);

-- Сообщение с предложением хранит цену (снимок на момент предложения).
ALTER TABLE messages ADD COLUMN offer_price bigint;
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN (
  'text', 'image', 'deal_proposed', 'deal_confirmed', 'deal_cancelled',
  'price_offer', 'offer_accepted', 'offer_declined', 'offer_withdrawn'
));

-- Цена сделки: согласованная в переписке или цена объявления на момент отметки.
ALTER TABLE deals ADD COLUMN price bigint CHECK (price IS NULL OR price > 0);
UPDATE deals d SET price = l.price FROM listings l WHERE l.id = d.listing_id AND l.operation IN ('sell', 'buy');
