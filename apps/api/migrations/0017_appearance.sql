-- Праздничное оформление приложения и сайта (например, на Хеллоуин в игре).
-- Включает и выключает администратор; «until» — когда выключится само.
CREATE TABLE app_appearance (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  season text NOT NULL DEFAULT 'none' CHECK (season IN ('none', 'halloween')),
  until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL
);

-- В игре сейчас Хеллоуин: оформление включено сразу после обновления.
INSERT INTO app_appearance (id, season) VALUES (1, 'halloween');
