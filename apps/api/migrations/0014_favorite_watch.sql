-- Слежение за избранным: сообщаем игроку, когда объявление из его избранного
-- подешевело, снято с продажи или снова опубликовано.

ALTER TABLE favorites
  -- Цена в момент добавления: в избранном видно «было → стало».
  ADD COLUMN added_price        bigint,
  -- Лучшая цена, о которой игрок уже знает (для продажи — самая низкая,
  -- для скупки — самая высокая). Сообщаем, только если стало ещё лучше.
  ADD COLUMN notified_price     bigint,
  ADD COLUMN price_notified_at  timestamptz,
  -- О каком состоянии игроку сообщили: active — в продаже, closed — снято.
  ADD COLUMN notified_state     text NOT NULL DEFAULT 'active' CHECK (notified_state IN ('active', 'closed')),
  ADD COLUMN status_notified_at timestamptz;

UPDATE favorites f
SET added_price = l.price,
    notified_price = l.price,
    notified_state = CASE WHEN l.status = 'active' THEN 'active' ELSE 'closed' END
FROM listings l
WHERE l.id = f.listing_id;

-- Настройка в личном кабинете: присылать ли такие уведомления.
ALTER TABLE users ADD COLUMN notify_favorites boolean NOT NULL DEFAULT true;
