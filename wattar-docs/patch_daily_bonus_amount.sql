-- ============================================================================
-- 59h. patch_daily_bonus_amount.sql
-- ضبط مكافأة الدخول اليومية على 50 Coin (الحد الأقصى 100) + توحيد سعر 1 USD = 3000
--
-- `daily_bonus_gold` كان 500 من الإعداد القديم (نقاط ألعاب)، والدالة الجديدة
-- تسقفه عند 100. نضبطه على 50 صراحةً حتى لا يظهر رقم مضلّل في لوحة الإدارة.
-- `usdt_to_gold_rate` مفتاح قديم غير مستخدم في أي دالة أو عميل؛ نوحّده مع
-- `paid_coins_per_usd` = 3000 لتفادي أي التباس في M4.
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

update public.admin_settings
set value = '50'::jsonb, updated_at = now()
where key = 'daily_bonus_gold' and (value #>> '{}')::numeric > 100;

update public.admin_settings
set value = '3000'::jsonb, updated_at = now()
where key = 'usdt_to_gold_rate';

select key, value from public.admin_settings
where key in ('daily_bonus_gold', 'paid_coins_per_usd', 'usdt_to_gold_rate')
order by key;

commit;