-- Run only after patch_slots_enum.sql has completed successfully.
-- Slots use non-purchasable, non-transferable free game points only.

INSERT INTO public.game_configs (
  game_type,
  is_enabled,
  default_rtp,
  min_bet_gold,
  max_bet_gold,
  max_multiplier,
  settings
)
VALUES (
  'slots',
  true,
  30,
  10,
  10000,
  10,
  '{"free_game_points_only":true,"payouts":{"cherry":2,"bell":5,"diamond":10}}'::jsonb
)
ON CONFLICT (game_type) DO NOTHING;
