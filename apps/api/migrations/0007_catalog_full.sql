-- Справочник: остальные категории павильонов (по видео из игры от 01.11.2026),
-- ID предметов в игре, предпросмотр и содержимое кейсов, гены растений,
-- цвета фар и дрифт-дыма.

-- ── Предметы справочника: ID в игре, предпросмотр, содержимое ─────────────
ALTER TABLE catalog_items
  -- ID в игре: у одежды и анимаций он показан в павильоне.
  ADD COLUMN game_code text CHECK (game_code IS NULL OR char_length(game_code) BETWEEN 1 AND 40),
  -- Предпросмотр: картинка или гиф (хранится как WebP) либо видео WebM.
  ADD COLUMN preview_path text,
  ADD COLUMN preview_kind text CHECK (preview_kind IN ('image', 'video')),
  -- Звук к предпросмотру (у некоторых анимаций).
  ADD COLUMN audio_path text,
  -- Содержимое кейса или набора: строки «Название» или «Название — примечание».
  ADD COLUMN contents text[] NOT NULL DEFAULT '{}';

CREATE INDEX catalog_items_game_code_idx ON catalog_items (game_code) WHERE game_code IS NOT NULL;

-- ── Новый тип поля: гены (строка из букв) ─────────────────────────────────
ALTER TABLE attribute_definitions DROP CONSTRAINT attribute_definitions_data_type_check;
ALTER TABLE attribute_definitions ADD CONSTRAINT attribute_definitions_data_type_check
  CHECK (data_type IN ('number', 'text', 'select', 'multiselect', 'boolean', 'genes'));
ALTER TABLE attribute_definitions DROP CONSTRAINT attribute_definitions_check;
ALTER TABLE attribute_definitions ADD CONSTRAINT attribute_definitions_options_check
  CHECK (data_type NOT IN ('select', 'multiselect', 'genes') OR cardinality(options) > 0);

-- ── Предметы категорий ───────────────────────────────────────────────────
-- В том порядке, как в павильоне. Обрезанные в игре названия записаны с «…»;
-- в квадратных скобках — подсказка по иконке, чтобы различать одинаковые
-- обрезанные названия. Всё уточняется в админ-панели.

-- Продовольствие: 35
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Энергетик', NULL, 1),
    ('Готовая рыба', NULL, 2),
    ('Хот-дог', NULL, 3),
    ('Напиток «Байкал»', NULL, 4),
    ('Помидоры', NULL, 5),
    ('Огурцы', NULL, 6),
    ('Тыквы', NULL, 7),
    ('Баклажаны', NULL, 8),
    ('Кукуруза', NULL, 9),
    ('Картофель', NULL, 10),
    ('Лук репчатый', NULL, 11),
    ('Морковь', NULL, 12),
    ('Свекла', NULL, 13),
    ('Чеснок', NULL, 14),
    ('Белый виноград', NULL, 15),
    ('Розовый виноград', NULL, 16),
    ('Темно-синий виноград', NULL, 17),
    ('Арбуз', NULL, 18),
    ('Редис', NULL, 19),
    ('Перец', NULL, 20),
    ('Капуста', NULL, 21),
    ('Минеральные удобрения', NULL, 22),
    ('Азотные удобрения', NULL, 23),
    ('Фосфорные удобрения', NULL, 24),
    ('Калийные удобрения', NULL, 25),
    ('Биологические химикаты', NULL, 26),
    ('Системные химикаты', NULL, 27),
    ('Кишечные химикаты', NULL, 28),
    ('Контактные химикаты', NULL, 29),
    ('Ящик с консервами', NULL, 30),
    ('Чай «Азерчай»', NULL, 31),
    ('Овощная нарезка', NULL, 32),
    ('Сырные палочки', NULL, 33),
    ('Шаурма', NULL, 34),
    ('Вишневый пирожок', NULL, 35)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Продовольствие'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Одежда: 118
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Одежда Лапенко', '2764', 1),
    ('Одежда ученица-маг (девушка)', '895', 2),
    ('Одежда бомж', '2853', 3),
    ('Одежда мотоциклистка…', '896', 4),
    ('Одежда дилер', '2649', 5),
    ('Одежда триада', '2655', 6),
    ('Одежда Дедпул', '893', 7),
    ('Одежда скуф', '892', 8),
    ('Одежда тыквенная леди', '894', 9),
    ('Одежда мужчина', '843', 10),
    ('Одежда Паша Техник', '2775', 11),
    ('Одежда Пол Уокер', '156', 12),
    ('Одежда Слава Марлоу', '2675', 13),
    ('Одежда Нурлан Сабуров', '2774', 14),
    ('Одежда Кощей', '71', 15),
    ('Одежда мужчина', '264', 16),
    ('Одежда чертяка с тыквой', '2669', 17),
    ('Одежда мужчина', '96', 18),
    ('Одежда еврей', '241', 19),
    ('Одежда Маска', '833', 20),
    ('Одежда мужчина (сталкер)', '2854', 21),
    ('Одежда мужчина', '293', 22),
    ('Одежда мужчина', '182', 23),
    ('Одежда девушка в бежевом платье', '31', 24),
    ('Одежда девушка', '842', 25),
    ('Одежда розовый кролик (девушка)', '63', 26),
    ('Одежда Дора (девушка)', '69', 27),
    ('Одежда девушка в купальнике', '138', 28),
    ('Одежда ведьма', '828', 29),
    ('Одежда девушка', '54', 30),
    ('Одежда Снегурочка', '2890', 31),
    ('Одежда 2B', '2699', 32),
    ('Одежда гонщик Стиг', '2670', 33),
    ('Одежда Хасбик', '2663', 34),
    ('Одежда Хасбик', '2664', 35),
    ('Одежда мужчина', '2634', 36),
    ('Одежда девочка', '2658', 37),
    ('Одежда мальчик', '2657', 38),
    ('Одежда Мэйби Бэйби', '835', 39),
    ('Одежда Илон Маск', '270', 40),
    ('Одежда Санта Клаус', '213', 41),
    ('Одежда девушка', '257', 42),
    ('Одежда кромешник', '232', 43),
    ('Одежда Джек Фрост', '231', 44),
    ('Одежда мужчина', '186', 45),
    ('Одежда девушка в персиковом…', '178', 46),
    ('Одежда мужчина', '78', 47),
    ('Одежда парикмахер', '176', 48),
    ('Одежда мужчина', '173', 49),
    ('Одежда мужчина', '155', 50),
    ('Одежда мужчина', '144', 51),
    ('Одежда шейх в белом', '142', 52),
    ('Одежда бомж', '134', 53),
    ('Одежда Джон Уик', '130', 54),
    ('Одежда мужчина', '114', 55),
    ('Одежда мужчина', '100', 56),
    ('Одежда грабитель', '94', 57),
    ('Одежда Элвис', '83', 58),
    ('Одежда Devon Aoki (девушка)', '77', 59),
    ('Одежда качок с татуировками', '73', 60),
    ('Одежда мед. сестра (девушка)', '65', 61),
    ('Одежда мед. сестра (девушка)', '43', 62),
    ('Одежда черлидерша', '57', 63),
    ('Одежда Папа Римский', '49', 64),
    ('Одежда мужчина', '30', 65),
    ('Одежда мужчина', '2', 66),
    ('Одежда Gawr Gura', '819', 67),
    ('Одежда Рауль Дюк', '812', 68),
    ('Одежда девушка «Макима»', '887', 69),
    ('Одежда Барби', '881', 70),
    ('Одежда 2B', '882', 71),
    ('Одежда Дин Винчестер', '889', 72),
    ('Одежда мужчина (сталкер)', '2840', 73),
    ('Одежда мужчина (сталкер)', '2878', 74),
    ('Одежда девушка (сталкер)', '2841', 75),
    ('Одежда девушка (сталкер)', '2879', 76),
    ('Одежда мужчина (тактический…)', '2835', 77),
    ('Одежда девушка (тактический…)', '2836', 78),
    ('Одежда бармен (сталкер)', '2843', 79),
    ('Одежда сталкер (девушка)', '2771', 80),
    ('Одежда Alt Girl', '244', 81),
    ('Одежда фермер (мужчина)', '883', 82),
    ('Одежда рейдер (сталкер)', '902', 83),
    ('Одежда барыга в очках (сталкер)', '2883', 84),
    ('Одежда Шинобу', '2951', 85),
    ('Одежда Гокудо', '2953', 86),
    ('Одежда перекуп', '2955', 87),
    ('Одежда костюм скелета', '2958', 88),
    ('Одежда девушка в полосатом', '2959', 89),
    ('Одежда Уэнсдей', '2961', 90),
    ('Одежда косплей монашки', '2962', 91),
    ('Одежда снежный эльф', '2892', 92),
    ('Одежда Грин-де-Вальд', '2964', 93),
    ('Одежда мужчина', '2965', 94),
    ('Одежда девушка в новогодней…', '2966', 95),
    ('Одежда Mercedes (мужчина)', '145', 96),
    ('Одежда мастер кунг-фу', '2580', 97),
    ('Одежда футболка ONE', '2978', 98),
    ('Одежда гангстер с тату', '2979', 99),
    ('Одежда костюм единорожки…', '898', 100),
    ('Одежда костюм динозавра', '2967', 101),
    ('Одежда костюм горка', '2968', 102),
    ('Одежда Спектра', '2949', 103),
    ('Одежда Томас Шелби', '2988', 104),
    ('Одежда рейдерша', '2989', 105),
    ('Одежда уличный', '2990', 106),
    ('Одежда неко', '2981', 107),
    ('Одежда Goth Girl', '2970', 108),
    ('Одежда Goth Girl в платье', '2972', 109),
    ('Одежда девушка в рубашке-…', '2976', 110),
    ('Одежда девушка в жилетке', '2982', 111),
    ('Одежда мужчина в жилетке', '2983', 112),
    ('Одежда рубашка на поясе', '2987', 113),
    ('Одежда сотрудник ADS', '2575', 114),
    ('Одежда гопник', '2992', 115),
    ('Одежда Fluffy Girl', '2993', 116),
    ('Одежда самурай', '2994', 117),
    ('Одежда мужчина', '146', 118)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Одежда'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Тюнинг: 31
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Аудиосистема', NULL, 1),
    ('Стробоскопы', NULL, 2),
    ('Гидравлика', NULL, 3),
    ('Нитро', NULL, 4),
    ('Неон однотонный', NULL, 5),
    ('Неон «Градиент»', NULL, 6),
    ('Неон «Радуга»', NULL, 7),
    ('1 чип-тюнинг', NULL, 8),
    ('2 чип-тюнинг', NULL, 9),
    ('3 чип-тюнинг', NULL, 10),
    ('Брендовая рамка', NULL, 11),
    ('Цветная рамка', NULL, 12),
    ('Пневмоподвеска', NULL, 13),
    ('Дрифт-дым (малиновый)', NULL, 14),
    ('Дрифт-дым (оранжевый)', NULL, 15),
    ('Дрифт-дым (красный)', NULL, 16),
    ('Дрифт-дым (желтый)', NULL, 17),
    ('Дрифт-дым (зеленый)', NULL, 18),
    ('Дрифт-дым (синий)', NULL, 19),
    ('Дрифт-дым (фиолетовый)', NULL, 20),
    ('Дрифт-дым (морская волна)', NULL, 21),
    ('Фары (красные)', NULL, 22),
    ('Фары (синие)', NULL, 23),
    ('Фары (зеленые)', NULL, 24),
    ('Фары (морская волна)', NULL, 25),
    ('Фары (фиолетовые)', NULL, 26),
    ('Фары (оранжевые)', NULL, 27),
    ('Доп. топливный бак', NULL, 28),
    ('Доп. багажник', NULL, 29),
    ('Градиентная покраска', NULL, 30),
    ('Номера на выбор', NULL, 31)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Тюнинг'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Анимации: 66
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Анимация: Танец маленьких утят', '76', 1),
    ('Анимация: Лезгинка', '94', 2),
    ('Анимация: Брейк-данс', '95', 3),
    ('Анимация: Bye Bye Bye', '96', 4),
    ('Анимация: DNB', '97', 5),
    ('Анимация: 9MM', '98', 6),
    ('Анимация: Делай как я', '99', 7),
    ('Анимация: Electro Shuffle', '100', 8),
    ('Анимация: Forget Me Not', '101', 9),
    ('Анимация: Дементор', '102', 10),
    ('Анимация: Stalker', '147', 11),
    ('Анимация: Fortnite', '103', 12),
    ('Анимация: Hype', '104', 13),
    ('Анимация: Floss', '105', 14),
    ('Анимация: Величие', '88', 15),
    ('Анимация: Poker Face', '106', 16),
    ('Анимация: Сияй', '110', 17),
    ('Анимация: Better', '116', 18),
    ('Анимация: APT', '112', 19),
    ('Анимация: Rat Dance', '114', 20),
    ('Анимация: Drop It Hot', '120', 21),
    ('Анимация: Rasputin', '118', 22),
    ('Анимация: Legs Clap', '127', 23),
    ('Анимация: Flux', '128', 24),
    ('Анимация: Wave', '129', 25),
    ('Анимация: Хип-хоп', '77', 26),
    ('Анимация: Одзиги', '148', 27),
    ('Анимация: Плачь', '133', 28),
    ('Анимация: Смех', '134', 29),
    ('Анимация: Счастливый', '135', 30),
    ('Анимация: Крутость', '136', 31),
    ('Анимация: Влюбленный', '137', 32),
    ('Анимация: Вынос мозга', '138', 33),
    ('Анимация: Овации', '139', 34),
    ('Анимация: Фейспалм', '140', 35),
    ('Анимация: В раздумье', '141', 36),
    ('Анимация: Сила', '142', 37),
    ('Анимация: Злой смех', '143', 38),
    ('Анимация: Грусть', '144', 39),
    ('Анимация: Отрицание', '145', 40),
    ('Анимация: Скука', '146', 41),
    ('Анимация: Клоунада', '149', 42),
    ('Анимация: Плевок', '150', 43),
    ('Анимация: Выгодная сделка', '151', 44),
    ('Анимация: Pacu Dance', '154', 45),
    ('Анимация: To The Moon', '155', 46),
    ('Анимация: Spooky Skeleton', '156', 47),
    ('Анимация: Get My Way', '157', 48),
    ('Анимация: Left Right', '158', 49),
    ('Анимация: Wednesday Dance', '159', 50),
    ('Анимация: Pumpkin Dance', '160', 51),
    ('Анимация: Blured Lines', '161', 52),
    ('Анимация: Crazy In Love', '162', 53),
    ('Анимация: Rock That Body', '163', 54),
    ('Анимация: Танец Винсента Веги', '164', 55),
    ('Анимация: Танец Мии Уоллес', '165', 56),
    ('Анимация: Free Arms', '130', 57),
    ('Анимация: Swing Fan', '131', 58),
    ('Анимация: Around Dance', '132', 59),
    ('Анимация: Happy Feets', '123', 60),
    ('Анимация: Funked Up', '122', 61),
    ('Анимация: Jumpstyle', '124', 62),
    ('Анимация: Milly Rock', '115', 63),
    ('Анимация: Epic Sax', '117', 64),
    ('Анимация: Кукла колдуна', '107', 65),
    ('Анимация: Magnetic', '113', 66)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Анимации'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Кейсы: 23
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Кейс «Анимационный»', NULL, 1),
    ('Кейс «Анимационны…» [фиолетовый]', NULL, 2),
    ('Кейс «Анимационны…» [зеленый]', NULL, 3),
    ('Кейс «Porsche 911»', NULL, 4),
    ('Кейс «190E EVO II»', NULL, 5),
    ('Кейс «Staff»', NULL, 6),
    ('Кейс «Desert Eagle»', NULL, 7),
    ('Кейс «АС Вал»', NULL, 8),
    ('Кейс «Новогодний…» [синий с гирляндой]', NULL, 9),
    ('Кейс «Nightmare»', NULL, 10),
    ('Кейс «Кладоискатель»', NULL, 11),
    ('Кейс «Halloween»', NULL, 12),
    ('Кейс «Боевой»', NULL, 13),
    ('Кейс «Новогодний»', NULL, 14),
    ('Кейс «Новогодний…» [голубой]', NULL, 15),
    ('Кейс «Гонщик»', NULL, 16),
    ('Кейс «Amazing I»', NULL, 17),
    ('Кейс «Amazing II»', NULL, 18),
    ('Кейс «Майский»', NULL, 19),
    ('Кейс «Майский II»', NULL, 20),
    ('Кейс «Автомобильный»', NULL, 21),
    ('Кейс «STALKER»', NULL, 22),
    ('Кейс «STALKER II»', NULL, 23)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Кейсы'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Компоненты PC: 38
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Rig MK.I (пластик)', NULL, 1),
    ('Rig MK.I (дерево)', NULL, 2),
    ('Rig MK.I (металл)', NULL, 3),
    ('Rig MK.II (дерево)', NULL, 4),
    ('Rig MK.II (металл)', NULL, 5),
    ('Rig MK.II (алюминий)', NULL, 6),
    ('Rig MK.III (дерево)', NULL, 7),
    ('Rig MK.III (металл)', NULL, 8),
    ('Rig MK.III (алюминий)', NULL, 9),
    ('Rig MK.IV (дерево)', NULL, 10),
    ('Rig MK.IV (металл)', NULL, 11),
    ('Rig MK.IV (алюминий)', NULL, 12),
    ('Cooler MK.I', NULL, 13),
    ('Cooler MK.II', NULL, 14),
    ('Cooler MK.III', NULL, 15),
    ('Cooler MK.IV', NULL, 16),
    ('Power Unit MK.I', NULL, 17),
    ('Power Unit MK.II', NULL, 18),
    ('Power Unit MK.III', NULL, 19),
    ('Power Unit MK.IV', NULL, 20),
    ('Base MK.I', NULL, 21),
    ('Base MK.II', NULL, 22),
    ('Base MK.III', NULL, 23),
    ('AMX 1050Ti', NULL, 24),
    ('AMX 1650', NULL, 25),
    ('AX 570', NULL, 26),
    ('AMX 1660 Super', NULL, 27),
    ('AX 5600 XT', NULL, 28),
    ('AX 6600', NULL, 29),
    ('AMX 3060', NULL, 30),
    ('AMX 4060', NULL, 31),
    ('AX 6700 XT', NULL, 32),
    ('AMX 4070 Super', NULL, 33),
    ('AX 7800 XT', NULL, 34),
    ('AMX 4080', NULL, 35),
    ('AMX 4090', NULL, 36),
    ('AMX 5080', NULL, 37),
    ('AMX 5090', NULL, 38)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Компоненты PC'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Усилители: 14
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Трудовой контракт… [кирка и каска]', NULL, 1),
    ('Трудовой контракт… [топор и бревна]', NULL, 2),
    ('Трудовой контракт… [станок]', NULL, 3),
    ('Трудовой контракт… [руль и табличка автобуса]', NULL, 4),
    ('Трудовой контракт… [коробки]', NULL, 5),
    ('Трудовой контракт… [руль и шашечки такси]', NULL, 6),
    ('Трудовой контракт… [фура]', NULL, 7),
    ('Трудовой контракт… [двигатель и ключ]', NULL, 8),
    ('Трудовой контракт… [мусорный бак и метла]', NULL, 9),
    ('Трудовой контракт… [лейка и урожай]', NULL, 10),
    ('Трудовой контракт… [рыболовные снасти]', NULL, 11),
    ('Трудовой контракт «Повар»', NULL, 12),
    ('Трудовой контракт… [акваланг]', NULL, 13),
    ('Трудовой контракт… [руль и ключ]', NULL, 14)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Усилители'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Разное: 80
INSERT INTO catalog_items (category_id, name, game_code, sort_order)
SELECT c.id, i.name, i.game_code, i.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'items'
CROSS JOIN (VALUES
    ('Пачка сигарет «Беломор канал»', NULL, 1),
    ('Крестик ручной работы', NULL, 2),
    ('Четки перекидные', NULL, 3),
    ('Карта «Владимирский…»', NULL, 4),
    ('Карта «Матросская…»', NULL, 5),
    ('Карта «Бутырка»', NULL, 6),
    ('Карта «Белый лебедь»', NULL, 7),
    ('Карта «Черный дельфин»', NULL, 8),
    ('Карта «Кресты»', NULL, 9),
    ('Сабельная пила', NULL, 10),
    ('Болторез', NULL, 11),
    ('Ключи от тюремных…', NULL, 12),
    ('Газовый резак', NULL, 13),
    ('Тюремные отмычки', NULL, 14),
    ('Аккумулятор для электромобиля', NULL, 15),
    ('Аптечка', NULL, 16),
    ('Армейская аптечка', NULL, 17),
    ('Отбойный молоток', NULL, 18),
    ('Метла', NULL, 19),
    ('Бензопила', NULL, 20),
    ('Адреналин', NULL, 21),
    ('Адреналин-S', NULL, 22),
    ('Ремонтный комплект', NULL, 23),
    ('Патроны', NULL, 24),
    ('Бронежилет', NULL, 25),
    ('Стяжка', NULL, 26),
    ('Маска', NULL, 27),
    ('Наживка', NULL, 28),
    ('Fishnet', NULL, 29),
    ('Neptune', NULL, 30),
    ('Amazing', NULL, 31),
    ('Канистра с топливом', NULL, 32),
    ('Amazing Multitool', NULL, 33),
    ('Взрывчатка C4', NULL, 34),
    ('Музыкальный центр', NULL, 35),
    ('Бумбокс', NULL, 36),
    ('Жетон прачечной', NULL, 37),
    ('Аккумулятор для самоката', NULL, 38),
    ('Батарейки', NULL, 39),
    ('Ремонтный комплект для…', NULL, 40),
    ('Домкрат', NULL, 41),
    ('Бланк', NULL, 42),
    ('Ящик с материалами', NULL, 43),
    ('Отмычка', NULL, 44),
    ('Набор инструментов', NULL, 45),
    ('Ракета фейерверка', NULL, 46),
    ('Фейерверк «Бом-бом»', NULL, 47),
    ('Доп. слот для павильона', NULL, 48),
    ('Большая аптечка', NULL, 49),
    ('Набор «Юного пиротехника»', NULL, 50),
    ('Чертеж «Адреналин-X»', NULL, 51),
    ('Ведро с эмульсией', NULL, 52),
    ('Ведро с эмульсией…', NULL, 53),
    ('Рецепт оружия: Glock-18', NULL, 54),
    ('Рецепт оружия: M4A4', NULL, 55),
    ('Рецепт оружия: ППШ', NULL, 56),
    ('Рецепт оружия: MP40', NULL, 57),
    ('Рецепт оружия: Мосинка', NULL, 58),
    ('Рецепт оружия: Револьвер Наган', NULL, 59),
    ('Рецепт оружия: АС «Вал»', NULL, 60),
    ('Рецепт оружия: АН-94 «Абакан»', NULL, 61),
    ('Рецепт оружия: ОЦ-14 «Гроза»', NULL, 62),
    ('Рецепт оружия: Steyr AUG', NULL, 63),
    ('Рецепт оружия: FAMAS F1', NULL, 64),
    ('Рецепт оружия: Striker-12', NULL, 65),
    ('Рецепт оружия: Desert Eagle', NULL, 66),
    ('Рецепт оружия: СКС', NULL, 67),
    ('Рецепт оружия: MAC-10', NULL, 68),
    ('Баллончик с краской «Reoms…» [серый]', NULL, 69),
    ('Баллончик с краской «Reoms…» [белый]', NULL, 70),
    ('Баллончик с краской… [фиолетовый]', NULL, 71),
    ('Баллончик с краской… [желто-красный]', NULL, 72),
    ('Баллончик с краской «317 Ink…» [фиолетовый]', NULL, 73),
    ('Баллончик с краской «317 Ink…» [зеленый]', NULL, 74),
    ('Баллончик с краской «OST…» [черно-желтый]', NULL, 75),
    ('Баллончик с краской «OST…» [желтый]', NULL, 76),
    ('Баллончик с краской «Amazin…» [розово-синий]', NULL, 77),
    ('Баллончик с краской «Amazin…» [сине-зеленый]', NULL, 78),
    ('Баллончик с краской… [бело-красный]', NULL, 79),
    ('Баллончик с краской «PERMACH» выс. качества', NULL, 80)
  ) AS i (name, game_code, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Разное'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- ── Транспорт: цвета фар и дрифт-дыма (из вкладки «Тюнинг») ──────────────
UPDATE attribute_definitions a SET
  options    = ARRAY['Нет', 'Красные', 'Синие', 'Зеленые', 'Морская волна', 'Фиолетовые', 'Оранжевые'],
  is_active  = true,
  help_text  = NULL,
  updated_at = now()
FROM listing_types t
WHERE t.id = a.listing_type_id AND t.code = 'vehicle' AND a.key = 'headlights' AND a.options = ARRAY['Нет'];

-- Дрифт-дым был «есть / нет»: старые отметки не говорят цвет и убираются.
UPDATE listings l SET attributes = l.attributes - 'drift_smoke'
FROM listing_types t
WHERE t.id = l.listing_type_id AND t.code = 'vehicle' AND jsonb_typeof(l.attributes -> 'drift_smoke') = 'boolean';

UPDATE attribute_definitions a SET
  data_type  = 'select',
  options    = ARRAY['Нет', 'Малиновый', 'Оранжевый', 'Красный', 'Желтый', 'Зеленый', 'Синий', 'Фиолетовый', 'Морская волна'],
  updated_at = now()
FROM listing_types t
WHERE t.id = a.listing_type_id AND t.code = 'vehicle' AND a.key = 'drift_smoke' AND a.data_type = 'boolean';

-- ── Предметы: целостность у компонентов PC, геном у продовольствия ────────
UPDATE attribute_definitions a SET
  category_ids = a.category_ids || c.id,
  updated_at   = now()
FROM listing_types t, categories c JOIN sections s ON s.id = c.section_id
WHERE t.id = a.listing_type_id AND t.code = 'item' AND a.key = 'integrity'
  AND s.code = 'items' AND c.parent_id IS NULL AND c.name = 'Компоненты PC'
  AND NOT c.id = ANY(a.category_ids);

-- Геном растения: 6 генов из Y, G, H, W, X в любом сочетании.
INSERT INTO attribute_definitions (
  listing_type_id, key, label, data_type, options, min_value, max_value,
  category_ids, filterable, help_text, sort_order
)
SELECT t.id, 'genome', 'Геном', 'genes', ARRAY['Y', 'G', 'H', 'W', 'X'], 6, 6,
       ARRAY[c.id], true,
       'Для семян: 6 генов. Y — урожай, G — рост, H — устойчивость к паразитам, W — больше воды, X — приманивает паразитов',
       30
FROM listing_types t, categories c JOIN sections s ON s.id = c.section_id
WHERE t.code = 'item' AND s.code = 'items' AND c.parent_id IS NULL AND c.name = 'Продовольствие'
ON CONFLICT (listing_type_id, key) DO NOTHING;

