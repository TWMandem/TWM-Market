-- Новые скины Amazing Online. Иконки взяты из файлов установленной игры;
-- 3D-модели и стили приложение читает у игрока по game_code.
WITH skins (game_code, name, position) AS (VALUES
  ('2918', 'Одежда девушка-призрак', 1),
  ('2919', 'Одежда окровавленный костюм', 2),
  ('2963', 'Одежда с тыквенной толстовкой', 3),
  ('2997', 'Одежда Ада Вонг', 4),
  ('2998', 'Одежда Леон Кеннеди', 5),
  ('2999', 'Одежда Ренч', 6)
), clothing AS (
  SELECT c.id, COALESCE(MAX(i.sort_order), 0) AS last_order
  FROM categories c
  JOIN sections s ON s.id = c.section_id AND s.code = 'items'
  LEFT JOIN catalog_items i ON i.category_id = c.id
  WHERE c.parent_id IS NULL AND c.name = 'Одежда'
  GROUP BY c.id
)
INSERT INTO catalog_items (category_id, name, game_code, sort_order, icon_path, icon_kind)
SELECT c.id, s.name, s.game_code, c.last_order + s.position,
       'seed-skins/' || s.game_code || '.png', 'image'
FROM clothing c CROSS JOIN skins s
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_items i WHERE i.category_id = c.id AND i.game_code = s.game_code
);

-- Если скин уже добавлен администратором, сохраняем его название и иконку.
-- Заполняем только отсутствующую иконку.
UPDATE catalog_items i
SET icon_path = 'seed-skins/' || i.game_code || '.png', icon_kind = 'image', updated_at = now()
FROM categories c JOIN sections s ON s.id = c.section_id AND s.code = 'items'
WHERE i.category_id = c.id AND c.name = 'Одежда' AND c.parent_id IS NULL
  AND i.game_code IN ('2918', '2919', '2963', '2997', '2998', '2999')
  AND i.icon_path IS NULL;
