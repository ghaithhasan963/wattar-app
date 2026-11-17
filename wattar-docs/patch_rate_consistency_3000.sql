-- ============================================================================
-- 60. patch_rate_consistency_3000.sql
-- توحيد النِسب بعد قرار «1 دولار = 3000 Coin» (migration #56)
--
-- المشكلة: كان `paid_coins_per_usd` = 3000 (سعر الشحن) بينما:
--   • `gold_to_usdt_rate` = 0.0009  → 1 Coin = 0.0009$ (أي 1$ = 1111 Coin)
--   • `diamonds_per_usd` = 1000     → 1 Diamond = 0.001$
-- فكانت القيمة المحاسبية للـCoin أعلى من سعر البيع بثلاثة أضعاف، وكان
-- `settle_gift_send` يحسب «ما دفعه المرسل» أكبر ممّا دفعه فعلاً، والهامش
-- المسجّل للمنصة مبالغ فيه — أي أن أي سحب لاحق كان سيدفع أكثر مما قُبض.
--
-- التصحيح (القسم 11/12): توحيد كل النِسب على أساس 1 USD = 3000 Coin:
--   1 Coin   = 1/3000 USD = 0.00033333$
--   1 Diamond = 1/3000 USD = 0.00033333$  (أي Diamond = Coin بالقيمة)
--   حد السحب الأدنى يبقى 10$ → 30000 Diamond بدل 10000
--   `diamond_to_coin_rate` يبقى 1 (متوافق مع القيمة الجديدة)
--
-- القيود التاريخية محفوظة: كل قيد يحمل `rates_snapshot` خاصته، لذا مطابقة
-- الهدايا القديمة تبقى صحيحة ولا يُعاد أي حساب قديم.
-- لا يتغيّر أي رصيد قائم.
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 60.1 سعر صرف Coin المحاسبي = سعر الشحن
update public.admin_settings
set value = '0.00033333'::jsonb, updated_at = now()
where key = 'gold_to_usdt_rate';

-- 60.2 قيمة الـDiamond = قيمة الـCoin (يحفظ نسبة 50% للمضيفة عند ratio 50)
update public.admin_settings
set value = '3000'::jsonb, updated_at = now()
where key = 'diamonds_per_usd';

-- 60.3 حد السحب الأدنى يبقى 10 دولارات
update public.admin_settings
set value = '30000'::jsonb, updated_at = now()
where key = 'min_withdrawal_diamonds' and (value #>> '{}')::numeric = 10000;

-- 60.4 توثيق
insert into public.admin_settings (key, value, description, is_public)
values
  ('gold_to_usdt_rate', '0.00033333'::jsonb, 'قيمة الـCoin بالدولار (1/3000). تُستخدم في محاسبة الهدايا والإيرادات.', false),
  ('diamonds_per_usd', '3000'::jsonb, 'عدد الـDiamond لكل دولار (1 Diamond = 1 Coin بالقيمة).', true)
on conflict (key) do nothing;

select json_build_object(
  'paid_coins_per_usd', (select value from public.admin_settings where key = 'paid_coins_per_usd'),
  'gold_to_usdt_rate', (select value from public.admin_settings where key = 'gold_to_usdt_rate'),
  'diamonds_per_usd', (select value from public.admin_settings where key = 'diamonds_per_usd'),
  'diamond_to_coin_rate', (select value from public.admin_settings where key = 'diamond_to_coin_rate'),
  'min_withdrawal_diamonds', (select value from public.admin_settings where key = 'min_withdrawal_diamonds'),
  'gift_economy', public.reconcile_gift_economy(),
  'wallet_ledger', public.reconcile_wallet_ledger()
) as result;

commit;