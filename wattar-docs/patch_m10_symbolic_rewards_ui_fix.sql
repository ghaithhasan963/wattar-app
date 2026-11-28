-- ============================================================
-- patch_m10_symbolic_rewards_ui_fix.sql
-- M10.1: مهمة الهدية الرمزية اليومية تصبح مكافأة رمزية بحتة (بلا Coin).
-- سبب: البذرة الأولى تركت reward_gold على قيمته الافتراضية (10) فأضافت Coin
--       إلى جانب الهدية، خلافاً لوصف المهمة.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

UPDATE public.daily_missions
SET reward_gold = 0,
    updated_at = now()
WHERE mission_key = 'symbolic_daily_story'
  AND reward_gift_id IS NOT NULL;

COMMIT;
