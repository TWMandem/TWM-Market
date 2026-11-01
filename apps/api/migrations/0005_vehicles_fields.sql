-- Поля характеристик: шаг числа и привязка к категориям справочника.
-- Справочник транспорта и стартовые поля для авто, аксессуаров и одежды.

-- ── Конструктор полей ─────────────────────────────────────────────────────
ALTER TABLE attribute_definitions
  -- Шаг для чисел: клиренс 5, 10, … 100.
  ADD COLUMN step_value numeric CHECK (step_value IS NULL OR step_value > 0),
  -- Категории предметов, у которых есть поле. Пусто — у всех объявлений типа.
  ADD COLUMN category_ids integer[] NOT NULL DEFAULT '{}';

-- ── Справочник транспорта ─────────────────────────────────────────────────
-- Модели — из темы «Таблица транспорта» на форуме Amazing Online
-- (актуально на 21.08.2026). Типы транспорта расставлены по названиям моделей.
INSERT INTO categories (section_id, name, sort_order)
SELECT s.id, c.name, c.sort_order
FROM sections s,
  (VALUES
    ('Легковые', 1),
    ('Мотоциклы', 2),
    ('Грузовые и автобусы', 3),
    ('Водный транспорт', 4),
    ('Прочее', 5)
  ) AS c (name, sort_order)
WHERE s.code = 'cars'
  AND NOT EXISTS (
    SELECT 1 FROM categories x
    WHERE x.section_id = s.id AND x.parent_id IS NULL AND lower(x.name) = lower(c.name)
  );

-- Легковые: 235
INSERT INTO catalog_items (category_id, name, aliases, sort_order)
SELECT c.id, v.name, v.aliases, v.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'cars'
CROSS JOIN (VALUES
    ('Alfa Romeo Giulia', ARRAY['Альфа Ромео Giulia']::text[], 1),
    ('Alfa Romeo 33 Stradale', ARRAY['Альфа Ромео 33 Stradale']::text[], 2),
    ('Audi R8 2G', ARRAY['Ауди R8 2G']::text[], 3),
    ('Audi RS 7 C8', ARRAY['Ауди RS 7 C8']::text[], 4),
    ('Audi RS Q8', ARRAY['Ауди RS Q8']::text[], 5),
    ('Audi RS4 (B5)', ARRAY['Ауди RS4 (B5)']::text[], 6),
    ('Audi RS6 C7', ARRAY['Ауди RS6 C7']::text[], 7),
    ('Audi RS6 C8', ARRAY['Ауди RS6 C8']::text[], 8),
    ('Audi S3 Sedan', ARRAY['Ауди S3 Sedan']::text[], 9),
    ('Audi S5 B9', ARRAY['Ауди S5 B9']::text[], 10),
    ('Audi TT 8S', ARRAY['Ауди TT 8S']::text[], 11),
    ('Aurus Senat', ARRAY['Аурус Senat']::text[], 12),
    ('Aurus Senat Convertible', ARRAY['Аурус Senat Convertible']::text[], 13),
    ('Bentley Bentayga', ARRAY['Бентли Bentayga']::text[], 14),
    ('Bentley Continental GT', ARRAY['Бентли Continental GT']::text[], 15),
    ('Bentley Ultratank', ARRAY['Бентли Ultratank']::text[], 16),
    ('BMW 2002 Turbo E20', ARRAY['БМВ 2002 Turbo E20']::text[], 17),
    ('BMW 750iL E38', ARRAY['БМВ 750iL E38']::text[], 18),
    ('BMW i8 l12', ARRAY['БМВ i8 l12']::text[], 19),
    ('BMW M2 F87', ARRAY['БМВ M2 F87']::text[], 20),
    ('BMW M3 E30', ARRAY['БМВ M3 E30']::text[], 21),
    ('BMW M3 E36', ARRAY['БМВ M3 E36']::text[], 22),
    ('BMW M3 E46', ARRAY['БМВ M3 E46']::text[], 23),
    ('BMW M3 E92', ARRAY['БМВ M3 E92']::text[], 24),
    ('BMW M3 F80', ARRAY['БМВ M3 F80']::text[], 25),
    ('BMW M3 G80', ARRAY['БМВ M3 G80']::text[], 26),
    ('BMW M3 Touring G81', ARRAY['БМВ M3 Touring G81']::text[], 27),
    ('BMW M4 CS F82', ARRAY['БМВ M4 CS F82']::text[], 28),
    ('BMW M4 G82', ARRAY['БМВ M4 G82']::text[], 29),
    ('BMW M4 G83', ARRAY['БМВ M4 G83']::text[], 30),
    ('BMW M5 E34', ARRAY['БМВ M5 E34']::text[], 31),
    ('BMW M5 E39', ARRAY['БМВ M5 E39']::text[], 32),
    ('BMW M5 E60', ARRAY['БМВ M5 E60']::text[], 33),
    ('BMW M5 F10', ARRAY['БМВ M5 F10']::text[], 34),
    ('BMW M5 F90', ARRAY['БМВ M5 F90']::text[], 35),
    ('BMW M5 G90', ARRAY['БМВ M5 G90']::text[], 36),
    ('BMW M8 F92', ARRAY['БМВ M8 F92']::text[], 37),
    ('BMW M8 F93', ARRAY['БМВ M8 F93']::text[], 38),
    ('BMW X5 E53', ARRAY['БМВ X5 E53']::text[], 39),
    ('BMW X5M Competition F95', ARRAY['БМВ X5M Competition F95']::text[], 40),
    ('BMW X6M Competition F96', ARRAY['БМВ X6M Competition F96']::text[], 41),
    ('BMW X7 G07', ARRAY['БМВ X7 G07']::text[], 42),
    ('Bugatti Chiron', ARRAY['Бугатти Chiron']::text[], 43),
    ('Bugatti EB110', ARRAY['Бугатти EB110']::text[], 44),
    ('Cadillac Escalade GMT K2XL', ARRAY['Кадиллак Escalade GMT K2XL']::text[], 45),
    ('Cadillac Devile 1949 Hearse', ARRAY['Кадиллак Devile 1949 Hearse']::text[], 46),
    ('Chevrolet C10', ARRAY['Шевроле C10']::text[], 47),
    ('Chevrolet Camaro I', ARRAY['Шевроле Camaro I']::text[], 48),
    ('Chevrolet Camaro SS VI', ARRAY['Шевроле Camaro SS VI']::text[], 49),
    ('Chevrolet Corvette C3', ARRAY['Шевроле Corvette C3']::text[], 50),
    ('Chevrolet Corvette C7', ARRAY['Шевроле Corvette C7']::text[], 51),
    ('Chevrolet Corvette ZR1 C8', ARRAY['Шевроле Corvette ZR1 C8']::text[], 52),
    ('Chevrolet Impala SS Hardtop', ARRAY['Шевроле Impala SS Hardtop']::text[], 53),
    ('Chevrolet Monster', ARRAY['Шевроле Monster']::text[], 54),
    ('Daewoo Matiz M150', ARRAY['Дэу Matiz M150']::text[], 55),
    ('DeLorean DMC-12', ARRAY['Делориан DMC-12']::text[], 56),
    ('Dodge Challenger R/T', ARRAY['Додж Challenger R/T']::text[], 57),
    ('Dodge Challenger SRT Demon', ARRAY['Додж Challenger SRT Demon']::text[], 58),
    ('Dodge Charger SRT Hellcat', ARRAY['Додж Charger SRT Hellcat']::text[], 59),
    ('Dodge RAM 1500 Rebel TRX', ARRAY['Додж RAM 1500 Rebel TRX']::text[], 60),
    ('Dodge Viper SRT', ARRAY['Додж Viper SRT']::text[], 61),
    ('Ferrari 488 GTB', ARRAY['Феррари 488 GTB']::text[], 62),
    ('Ferrari F12tdf', ARRAY['Феррари F12tdf']::text[], 63),
    ('Ferrari F8 Tributo', ARRAY['Феррари F8 Tributo']::text[], 64),
    ('Ferrari F40', ARRAY['Феррари F40']::text[], 65),
    ('Fiat 500 Abarth', ARRAY['Фиат 500 Abarth']::text[], 66),
    ('Flanker F', '{}'::text[], 67),
    ('Ford Crown Victoria EN53', ARRAY['Форд Crown Victoria EN53']::text[], 68),
    ('Ford F-150 Raptor', ARRAY['Форд F-150 Raptor']::text[], 69),
    ('Ford Falcon XB V8 Interceptor', ARRAY['Форд Falcon XB V8 Interceptor']::text[], 70),
    ('Ford Focus III', ARRAY['Форд Focus III']::text[], 71),
    ('Ford GT40', ARRAY['Форд GT40']::text[], 72),
    ('Ford Model B', ARRAY['Форд Model B']::text[], 73),
    ('Ford Mustang Hoonicorn', ARRAY['Форд Mustang Hoonicorn']::text[], 74),
    ('Ford Mustang Shelby GT500', ARRAY['Форд Mustang Shelby GT500']::text[], 75),
    ('Genesis G90 Wingback', ARRAY['Генезис G90 Wingback']::text[], 76),
    ('GMC Hummer EV', ARRAY['ДжиЭмСи Hummer EV']::text[], 77),
    ('GMC Vandura', ARRAY['ДжиЭмСи Vandura']::text[], 78),
    ('HiPhi Z', '{}'::text[], 79),
    ('Holden Sandman HQ Panelvan', '{}'::text[], 80),
    ('Honda Civic Type-R EK9', ARRAY['Хонда Civic Type-R EK9']::text[], 81),
    ('Honda Civic Type-R FK8', ARRAY['Хонда Civic Type-R FK8']::text[], 82),
    ('Honda NSX NA1', ARRAY['Хонда NSX NA1']::text[], 83),
    ('Honda S2000', ARRAY['Хонда S2000']::text[], 84),
    ('Hummer H1', ARRAY['Хаммер H1']::text[], 85),
    ('Hyundai N Vision 74', ARRAY['Хендай N Vision 74']::text[], 86),
    ('Infiniti Q50 V37', ARRAY['Инфинити Q50 V37']::text[], 87),
    ('Jaguar F-Type', ARRAY['Ягуар F-Type']::text[], 88),
    ('Jeep Gladiator', ARRAY['Джип Gladiator']::text[], 89),
    ('Jeep Grand Cherokee Trackhawk', ARRAY['Джип Grand Cherokee Trackhawk']::text[], 90),
    ('Kia Rio FB', ARRAY['Киа Rio FB']::text[], 91),
    ('KTM X-Bow', ARRAY['КТМ X-Bow']::text[], 92),
    ('Lada 4x4', ARRAY['Лада 4x4']::text[], 93),
    ('Lada Granta', ARRAY['Лада Гранта']::text[], 94),
    ('LADA Largus', ARRAY['Лада Ларгус']::text[], 95),
    ('LADA Largus Cross', ARRAY['Лада Ларгус Cross']::text[], 96),
    ('Lada Niva Travel', ARRAY['Лада Нива Travel']::text[], 97),
    ('Lada Priora', ARRAY['Лада Приора']::text[], 98),
    ('Lada Vesta NG', ARRAY['Лада Веста NG']::text[], 99),
    ('Lada Vesta SW', ARRAY['Лада Веста SW']::text[], 100),
    ('Lamborghini Aventador', ARRAY['Ламборгини Aventador']::text[], 101),
    ('Lamborghini Huracan', ARRAY['Ламборгини Huracan']::text[], 102),
    ('Lamborghini Urus', ARRAY['Ламборгини Urus']::text[], 103),
    ('Land Rover Defender L663', ARRAY['Ленд Ровер Defender L663']::text[], 104),
    ('Lexus IS300 XE10', ARRAY['Лексус IS300 XE10']::text[], 105),
    ('Lexus IS350 XE30', ARRAY['Лексус IS350 XE30']::text[], 106),
    ('Lexus IS-F', ARRAY['Лексус IS-F']::text[], 107),
    ('Lexus LC500 URZ100', ARRAY['Лексус LC500 URZ100']::text[], 108),
    ('Lexus LX570 URJ201', ARRAY['Лексус LX570 URJ201']::text[], 109),
    ('Lexus LX600 FJA310', ARRAY['Лексус LX600 FJA310']::text[], 110),
    ('Lexus RX350 F Sport AL20', ARRAY['Лексус RX350 F Sport AL20']::text[], 111),
    ('Lincoln Continental 10G', ARRAY['Линкольн Continental 10G']::text[], 112),
    ('LiXiang L9', '{}'::text[], 113),
    ('Lotus Evija', ARRAY['Лотус Evija']::text[], 114),
    ('LR Range Rover SVAutobiography L405', ARRAY['Рендж Ровер SVAutobiography L405']::text[], 115),
    ('Mazda RX-7 FD', ARRAY['Мазда RX-7 FD']::text[], 116),
    ('Mazda RX-8', ARRAY['Мазда RX-8']::text[], 117),
    ('Mercedes-Benz 190e W201 Evo II Asap Rocky', ARRAY['Мерседес 190e W201 Evo II Asap Rocky']::text[], 118),
    ('McLaren Senna', ARRAY['Макларен Senna']::text[], 119),
    ('Mercedes-Benz AMG GT S X290', ARRAY['Мерседес AMG GT S X290']::text[], 120),
    ('Mercedes-Benz AMG GTR', ARRAY['Мерседес AMG GTR']::text[], 121),
    ('Mercedes-Benz C-class W204 AMG', ARRAY['Мерседес C-class W204 AMG']::text[], 122),
    ('Mercedes-Benz C63 W205', ARRAY['Мерседес C63 W205']::text[], 123),
    ('Mercedes-Benz CLS C218', ARRAY['Мерседес CLS C218']::text[], 124),
    ('Mercedes-Benz CLS AMG W219', ARRAY['Мерседес CLS AMG W219']::text[], 125),
    ('Mercedes-Benz E500 W124', ARRAY['Мерседес E500 W124']::text[], 126),
    ('Mercedes-Benz E55 AMG W210', ARRAY['Мерседес E55 AMG W210']::text[], 127),
    ('Mercedes-Benz E63 W212', ARRAY['Мерседес E63 W212']::text[], 128),
    ('Mercedes-Benz E63s W213', ARRAY['Мерседес E63s W213']::text[], 129),
    ('Mercedes-Benz EQS 580', ARRAY['Мерседес EQS 580']::text[], 130),
    ('Mercedes-Benz G63 4x4', ARRAY['Мерседес G63 4x4']::text[], 131),
    ('Mercedes-Benz G63 W464', ARRAY['Мерседес G63 W464']::text[], 132),
    ('Mercedes-Benz G65 W463', ARRAY['Мерседес G65 W463']::text[], 133),
    ('Mercedes-Benz GLE 63 AMG', ARRAY['Мерседес GLE 63 AMG']::text[], 134),
    ('Mercedes-Benz S450 W223', ARRAY['Мерседес S450 W223']::text[], 135),
    ('Mercedes-Benz S600 W140', ARRAY['Мерседес S600 W140']::text[], 136),
    ('Mercedes-Benz Sprinter W907', ARRAY['Мерседес Sprinter W907']::text[], 137),
    ('Mercedes-Benz Unimog', ARRAY['Мерседес Unimog']::text[], 138),
    ('Mercedes-Benz V-class W447', ARRAY['Мерседес V-class W447']::text[], 139),
    ('Mercedes-Benz VISION AVTR', ARRAY['Мерседес VISION AVTR']::text[], 140),
    ('Mercedes-Benz X-Class W470', ARRAY['Мерседес X-Class W470']::text[], 141),
    ('Mercedes-Maybach GLS 600 X167', ARRAY['Майбах GLS 600 X167']::text[], 142),
    ('Mercedes-Maybach S650', ARRAY['Майбах S650']::text[], 143),
    ('MINI Cooper S JCW', ARRAY['Мини Cooper S JCW']::text[], 144),
    ('MINI JCW GP III F56', ARRAY['Мини JCW GP III F56']::text[], 145),
    ('Mitsubishi Lancer Evo IX', ARRAY['Мицубиси Lancer Evo IX']::text[], 146),
    ('Mitsubishi Lancer Evolution X', ARRAY['Мицубиси Lancer Evolution X']::text[], 147),
    ('Mitsubishi Pajero V80', ARRAY['Мицубиси Pajero V80']::text[], 148),
    ('Nissan 240SX', ARRAY['Ниссан 240SX']::text[], 149),
    ('Nissan 370Z', ARRAY['Ниссан 370Z']::text[], 150),
    ('Nissan Fairlady 240Z', ARRAY['Ниссан Fairlady 240Z']::text[], 151),
    ('Nissan Fairlady Z RZ34', ARRAY['Ниссан Fairlady Z RZ34']::text[], 152),
    ('Nissan GT-R R35', ARRAY['Ниссан GT-R R35']::text[], 153),
    ('Nissan Pulsar GTI-R', ARRAY['Ниссан Pulsar GTI-R']::text[], 154),
    ('Nissan Silvia S13', ARRAY['Ниссан Silvia S13']::text[], 155),
    ('Nissan Silvia S14', ARRAY['Ниссан Silvia S14']::text[], 156),
    ('Nissan Silvia S15', ARRAY['Ниссан Silvia S15']::text[], 157),
    ('Nissan Skyline GT-R R32', ARRAY['Ниссан Skyline GT-R R32']::text[], 158),
    ('Nissan Skyline GT-R R33', ARRAY['Ниссан Skyline GT-R R33']::text[], 159),
    ('Nissan Skyline GT-R R34', ARRAY['Ниссан Skyline GT-R R34']::text[], 160),
    ('Peugeot 406 Track', ARRAY['Пежо 406 Track']::text[], 161),
    ('Porsche 911 964', ARRAY['Порше 911 964']::text[], 162),
    ('Porsche 911 992', ARRAY['Порше 911 992']::text[], 163),
    ('Porsche 911 Carrera GTS 992', ARRAY['Порше 911 Carrera GTS 992']::text[], 164),
    ('Porsche 911 GT3 992', ARRAY['Порше 911 GT3 992']::text[], 165),
    ('Porsche 911 991', ARRAY['Порше 911 991']::text[], 166),
    ('Porsche Cayenne Coupe', ARRAY['Порше Cayenne Coupe']::text[], 167),
    ('Porsche Cayenne Turbo III', ARRAY['Порше Cayenne Turbo III']::text[], 168),
    ('Porsche Panamera 971', ARRAY['Порше Panamera 971']::text[], 169),
    ('Porsche Taycan', ARRAY['Порше Taycan']::text[], 170),
    ('Proto Speedster', '{}'::text[], 171),
    ('Quadra V-Tech', '{}'::text[], 172),
    ('Range Rover Velar L560', ARRAY['Рендж Ровер Velar L560']::text[], 173),
    ('Renault Logan II', ARRAY['Рено Logan II']::text[], 174),
    ('Renault Megane II', ARRAY['Рено Megane II']::text[], 175),
    ('Rolls-Royce Cullinan', ARRAY['Роллс-Ройс Cullinan']::text[], 176),
    ('Rolls-Royce Dawn', ARRAY['Роллс-Ройс Dawn']::text[], 177),
    ('Rolls-Royce Ghost Limousine', ARRAY['Роллс-Ройс Ghost Limousine']::text[], 178),
    ('Rolls-Royce Phantom', ARRAY['Роллс-Ройс Phantom']::text[], 179),
    ('Saleen S7', '{}'::text[], 180),
    ('Skoda Octavia MK3', ARRAY['Шкода Octavia MK3']::text[], 181),
    ('Subaru Impreza WRX STI GD', ARRAY['Субару Impreza WRX STI GD']::text[], 182),
    ('Subaru Impreza WRX STI GR', ARRAY['Субару Impreza WRX STI GR']::text[], 183),
    ('Subaru Legacy BC', ARRAY['Субару Legacy BC']::text[], 184),
    ('Suzuki Jimny JB74', ARRAY['Сузуки Jimny JB74']::text[], 185),
    ('Tesla Cybertruck', ARRAY['Тесла Cybertruck']::text[], 186),
    ('Tesla Model S', ARRAY['Тесла Model S']::text[], 187),
    ('Tesla Model S Plaid', ARRAY['Тесла Model S Plaid']::text[], 188),
    ('Toyota Camry XV50', ARRAY['Тойота Camry XV50']::text[], 189),
    ('Toyota Camry XV70', ARRAY['Тойота Camry XV70']::text[], 190),
    ('Toyota Chaser JZX100', ARRAY['Тойота Chaser JZX100']::text[], 191),
    ('Toyota Crown Athlete S S180', ARRAY['Тойота Crown Athlete S S180']::text[], 192),
    ('Toyota GR GT', ARRAY['Тойота GR GT']::text[], 193),
    ('Toyota GR86', ARRAY['Тойота GR86']::text[], 194),
    ('Toyota GT86', ARRAY['Тойота GT86']::text[], 195),
    ('Toyota Land Cruiser 200', ARRAY['Тойота Land Cruiser 200']::text[], 196),
    ('Toyota Land Cruiser 300', ARRAY['Тойота Land Cruiser 300']::text[], 197),
    ('Toyota Land Cruiser Prado', ARRAY['Тойота Land Cruiser Prado']::text[], 198),
    ('Toyota Mark II', ARRAY['Тойота Mark II']::text[], 199),
    ('Toyota Sprinter Trueno IV AE86', ARRAY['Тойота Sprinter Trueno IV AE86']::text[], 200),
    ('Toyota Supra A80', ARRAY['Тойота Supra A80']::text[], 201),
    ('Toyota Supra A90', ARRAY['Тойота Supra A90']::text[], 202),
    ('Volkswagen Golf MK8 GTI', ARRAY['Фольксваген Golf MK8 GTI']::text[], 203),
    ('Volkswagen Golf MKI', ARRAY['Фольксваген Golf MKI']::text[], 204),
    ('Volkswagen Golf R MK7', ARRAY['Фольксваген Golf R MK7']::text[], 205),
    ('Volkswagen ID. Buzz', ARRAY['Фольксваген ID. Buzz']::text[], 206),
    ('Volkswagen Kaefer', ARRAY['Фольксваген Kaefer']::text[], 207),
    ('Volkswagen Multivan T6', ARRAY['Фольксваген Multivan T6']::text[], 208),
    ('Volkswagen Polo Liftback', ARRAY['Фольксваген Polo Liftback']::text[], 209),
    ('Буханка 2077', '{}'::text[], 210),
    ('ВАЗ-2101', ARRAY['Жигули 2101', 'Лада 2101']::text[], 211),
    ('ВАЗ-2102', ARRAY['Жигули 2102', 'Лада 2102']::text[], 212),
    ('ВАЗ-2104', ARRAY['Жигули 2104', 'Лада 2104']::text[], 213),
    ('ВАЗ-2105', ARRAY['Жигули 2105', 'Лада 2105']::text[], 214),
    ('ВАЗ-2106', ARRAY['Жигули 2106', 'Лада 2106']::text[], 215),
    ('ВАЗ-2107', ARRAY['Жигули 2107', 'Лада 2107']::text[], 216),
    ('ВАЗ-2108', ARRAY['Жигули 2108', 'Лада 2108']::text[], 217),
    ('ВАЗ-2109', ARRAY['Жигули 2109', 'Лада 2109']::text[], 218),
    ('ВАЗ-21099', ARRAY['Жигули 21099', 'Лада 21099']::text[], 219),
    ('ВАЗ-2110', ARRAY['Жигули 2110', 'Лада 2110']::text[], 220),
    ('ВАЗ-2112', ARRAY['Жигули 2112', 'Лада 2112']::text[], 221),
    ('ВАЗ-2114', ARRAY['Жигули 2114', 'Лада 2114']::text[], 222),
    ('ВАЗ-2329', ARRAY['Жигули 2329', 'Лада 2329']::text[], 223),
    ('ГАЗ М-1', '{}'::text[], 224),
    ('ГАЗ-М20', '{}'::text[], 225),
    ('ГАЗ-13 «Чайка»', '{}'::text[], 226),
    ('ГАЗ-24', '{}'::text[], 227),
    ('ГАЗ-3110', '{}'::text[], 228),
    ('ЗАЗ-968M', '{}'::text[], 229),
    ('ЗиС 101-А «Спорт»', '{}'::text[], 230),
    ('Ока', '{}'::text[], 231),
    ('УАЗ-3163 «Patriot»', '{}'::text[], 232),
    ('УАЗ-3303', '{}'::text[], 233),
    ('УАЗ-469', '{}'::text[], 234),
    ('УАЗ СГР', '{}'::text[], 235)
  ) AS v (name, aliases, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Легковые'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Мотоциклы: 8
INSERT INTO catalog_items (category_id, name, aliases, sort_order)
SELECT c.id, v.name, v.aliases, v.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'cars'
CROSS JOIN (VALUES
    ('Ducati Desmosedici RR', ARRAY['Дукати Desmosedici RR']::text[], 1),
    ('Ducati XDiavel S', ARRAY['Дукати XDiavel S']::text[], 2),
    ('Harley-Davidson FLHRXS', ARRAY['Харлей FLHRXS']::text[], 3),
    ('Yamaha V-Max 1700', ARRAY['Ямаха V-Max 1700']::text[], 4),
    ('Мотоцикл BMW S1000RR', ARRAY['Мотоцикл БМВ S1000RR']::text[], 5),
    ('Мотоцикл KTM 1290 Super Duke R', ARRAY['Мотоцикл КТМ 1290 Super Duke R']::text[], 6),
    ('Мотоцикл KTM 350 EXC-F', ARRAY['Мотоцикл КТМ 350 EXC-F']::text[], 7),
    ('Мотоцикл Ява 350', '{}'::text[], 8)
  ) AS v (name, aliases, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Мотоциклы'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Грузовые и автобусы: 14
INSERT INTO catalog_items (category_id, name, aliases, sort_order)
SELECT c.id, v.name, v.aliases, v.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'cars'
CROSS JOIN (VALUES
    ('Kenworth W900', ARRAY['Кенворт W900']::text[], 1),
    ('MAN TGL', '{}'::text[], 2),
    ('Военный КамАЗ-43118', '{}'::text[], 3),
    ('ГАЗ-66', '{}'::text[], 4),
    ('ГАЗон NEXT', '{}'::text[], 5),
    ('ЗИЛ-130 (600 л.с.)', '{}'::text[], 6),
    ('КаВЗ-685', '{}'::text[], 7),
    ('Тягач IVECO Stralis', '{}'::text[], 8),
    ('Тягач KAMAZ-54901', '{}'::text[], 9),
    ('Тягач Renault Magnum', ARRAY['Тягач Рено Magnum']::text[], 10),
    ('Тягач Renault T', ARRAY['Тягач Рено T']::text[], 11),
    ('Тягач Tesla Semi', ARRAY['Тягач Тесла Semi']::text[], 12),
    ('Тягач Volvo FH16', '{}'::text[], 13),
    ('Тягач Volvo VNL 670', '{}'::text[], 14)
  ) AS v (name, aliases, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Грузовые и автобусы'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Водный транспорт: 3
INSERT INTO catalog_items (category_id, name, aliases, sort_order)
SELECT c.id, v.name, v.aliases, v.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'cars'
CROSS JOIN (VALUES
    ('Скоростной катер', '{}'::text[], 1),
    ('Яхта «Альтаир»', '{}'::text[], 2),
    ('Яхта «Тропик»', '{}'::text[], 3)
  ) AS v (name, aliases, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Водный транспорт'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- Прочее: 6
INSERT INTO catalog_items (category_id, name, aliases, sort_order)
SELECT c.id, v.name, v.aliases, v.sort_order
FROM categories c
JOIN sections s ON s.id = c.section_id AND s.code = 'cars'
CROSS JOIN (VALUES
    ('Can-Am Maverick X3', '{}'::text[], 1),
    ('Велосипед', '{}'::text[], 2),
    ('Велосипед Аист', '{}'::text[], 3),
    ('Гольфкар', '{}'::text[], 4),
    ('Квадроцикл', '{}'::text[], 5),
    ('Электросамокат «Xiaomi»', '{}'::text[], 6)
  ) AS v (name, aliases, sort_order)
WHERE c.parent_id IS NULL AND c.name = 'Прочее'
  AND NOT EXISTS (SELECT 1 FROM catalog_items x WHERE x.category_id = c.id);

-- ── Характеристики транспорта ─────────────────────────────────────────────
-- По экрану характеристик авто в игре. Фары скрыты, пока в список не внесены
-- цвета из вкладки «Тюнинг»: администратор добавит их и включит поле.
INSERT INTO attribute_definitions (
  listing_type_id, key, label, data_type, unit, options, min_value, max_value, step_value,
  filterable, help_text, is_active, sort_order
)
SELECT t.id, f.key, f.label, f.data_type, f.unit, f.options, f.min_value, f.max_value, f.step_value,
       f.filterable, f.help_text, f.is_active, f.sort_order
FROM listing_types t
CROSS JOIN (VALUES
    ('vehicle_id', 'Идентификатор автомобиля', 'text', NULL, '{}'::text[], NULL::numeric, NULL::numeric, NULL::numeric,
      false, 'Число из характеристик авто в игре, например 129787 — по нему покупатель сверит машину', true, 10),
    ('integrity', 'Целостность', 'number', '%', '{}', 0, 100, 1, true, NULL, true, 20),
    ('engine_stage', 'Улучшение двигателя', 'select', NULL, ARRAY['Нет', 'STAGE 1', 'STAGE 2', 'STAGE 3'], NULL, NULL, NULL,
      true, NULL, true, 30),
    ('nitro', 'Нитро', 'boolean', NULL, '{}', NULL, NULL, NULL, true, NULL, true, 40),
    ('neon', 'Неон', 'boolean', NULL, '{}', NULL, NULL, NULL, true, NULL, true, 50),
    ('headlights', 'Фары', 'select', NULL, ARRAY['Нет'], NULL, NULL, NULL, true, NULL, false, 60),
    ('clearance', 'Клиренс', 'number', '%', '{}', 5, 100, 5, false, 'От 5 до 100 с шагом 5', true, 70),
    ('fuel_type', 'Тип топлива', 'select', NULL, ARRAY['АИ-92', 'АИ-95', 'АИ-98', 'Дизель', 'ЭКО (электричество)'], NULL, NULL, NULL,
      false, NULL, true, 80),
    ('fuel_tank', 'Бензобак', 'number', 'л', '{}', 0, NULL, NULL, false, NULL, true, 90),
    ('hydraulics', 'Гидравлика', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 100),
    ('air_suspension', 'Пневмоподвеска', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 110),
    ('negative_camber', 'Отрицательный развал', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 120),
    ('alarm', 'Сигнализация', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 130),
    ('radar_detector', 'Антирадар', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 140),
    ('audio_system', 'Аудиосистема', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 150),
    ('strobes', 'Стробоскопы', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 160),
    ('drift_smoke', 'Дрифт-дым', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 170),
    ('extra_fuel_tank', 'Доп. бензобак', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 180),
    ('gradient_paint', 'Градиентная покраска', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 190),
    ('extra_trunk', 'Доп. багажник', 'boolean', NULL, '{}', NULL, NULL, NULL, false, NULL, true, 200)
  ) AS f (key, label, data_type, unit, options, min_value, max_value, step_value, filterable, help_text, is_active, sort_order)
WHERE t.code = 'vehicle'
ON CONFLICT (listing_type_id, key) DO NOTHING;

-- ── Аксессуары и одежда ───────────────────────────────────────────────────
-- Улучшение X1–X15 есть у аксессуаров и одежды, целостность — у одежды.
-- Поле добавляется, только если найдены все его категории: иначе оно
-- оказалось бы у всех предметов.
WITH cats AS (
  SELECT c.name, c.id
  FROM categories c JOIN sections s ON s.id = c.section_id
  WHERE s.code = 'items' AND c.parent_id IS NULL AND c.name IN ('Аксессуары', 'Одежда')
),
fields (key, label, unit, min_value, max_value, help_text, sort_order, category_names) AS (
  VALUES
    ('upgrade', 'Улучшение', 'X{}', 1::numeric, 15::numeric, 'От X1 до X15', 10, ARRAY['Аксессуары', 'Одежда']),
    ('integrity', 'Целостность', '%', 0::numeric, 100::numeric, NULL, 20, ARRAY['Одежда'])
)
INSERT INTO attribute_definitions (
  listing_type_id, key, label, data_type, unit, min_value, max_value, step_value,
  category_ids, filterable, help_text, sort_order
)
SELECT t.id, f.key, f.label, 'number', f.unit, f.min_value, f.max_value, 1,
       ARRAY(SELECT cats.id FROM cats WHERE cats.name = ANY(f.category_names) ORDER BY cats.id),
       true, f.help_text, f.sort_order
FROM listing_types t
CROSS JOIN fields f
WHERE t.code = 'item'
  AND (SELECT count(*) FROM cats WHERE cats.name = ANY(f.category_names)) = cardinality(f.category_names)
ON CONFLICT (listing_type_id, key) DO NOTHING;
