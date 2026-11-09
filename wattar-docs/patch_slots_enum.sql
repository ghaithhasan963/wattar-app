-- Run after patch_wattar_v2_social.sql.
-- Run this file separately, then run patch_slots_game_config.sql.

ALTER TYPE public.game_type ADD VALUE IF NOT EXISTS 'slots';
