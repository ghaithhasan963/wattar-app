-- M10.1: توسيع كتالوج الهدايا بأسعار/فئات مختلفة
-- ملاحظة: animation_url يُملأ لاحقًا بأصول 3D مُصيّرة مسبقًا لكل هدية.

INSERT INTO public.gifts (name, name_ar, icon_url, icon_emoji, animation_url, price_gold, recipient_diamond_ratio, is_premium, is_active, category, sort_order)
VALUES
  -- عادي
  ('Rose',        'وردة',        '/gifts/rose.png',      '🌹', NULL, 100,    50.00, false, true, 'common',    1),
  ('Coffee',      'قهوة',        '/gifts/coffee.png',    '☕', NULL, 200,    50.00, false, true, 'common',    2),
  ('Heart',       'قلب',         '/gifts/heart.png',     '❤️', NULL, 500,    50.00, false, true, 'common',    3),
  ('Candy',       'حلوى',        '/gifts/candy.png',     '🍬', NULL, 800,    50.00, false, true, 'common',    4),

  -- مميز
  ('Perfume',     'عطر',         '/gifts/perfume.png',   '🧴', NULL, 1200,   50.00, false, true, 'special',  10),
  ('Microphone',  'مايك ذهبي',   '/gifts/mic.png',       '🎤', NULL, 1500,   50.00, false, true, 'special',  11),
  ('Fireworks',   'ألعاب نارية', '/gifts/fireworks.png', '🎆', NULL, 1800,   50.00, false, true, 'special',  12),

  -- نادر
  ('Crown',       'تاج',         '/gifts/crown.png',     '👑', NULL, 2500,   50.00, false, true, 'rare',     20),
  ('Diamond',     'ألماسة',      '/gifts/diamond.png',   '💎', NULL, 3500,   50.00, false, true, 'rare',     21),
  ('Sports Car',  'سيارة',       '/gifts/car.png',       '🏎️', NULL, 4500,   50.00, false, true, 'rare',     22),

  -- ملحمي
  ('Yacht',       'يخت',         '/gifts/yacht.png',     '🛥️', NULL, 6000,   50.00, true,  true, 'epic',     30),
  ('Falcon',      'صقر',         '/gifts/falcon.png',    '🦅', NULL, 7500,   50.00, true,  true, 'epic',     31),
  ('Ship',        'سفينة وتر',   '/gifts/ship.png',      '⛵', NULL, 9000,   50.00, true,  true, 'epic',     32),

  -- أسطوري
  ('Castle',      'قصر',         '/gifts/castle.png',    '🏰', NULL, 15000,  50.00, true,  true, 'legendary',40),
  ('Dragon',      'تنين',        '/gifts/dragon.png',    '🐉', NULL, 25000,  50.00, true,  true, 'legendary',41),
  ('Universe',    'مجرة',        '/gifts/universe.png',  '🌌', NULL, 50000,  50.00, true,  true, 'legendary',42)
ON CONFLICT DO NOTHING;
