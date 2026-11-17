-- ============================================================================
-- 58. patch_opening_balances.sql
-- إصلاح خلل #56 + تسوية الدفتر مع الأرصدة القائمة (قيود افتتاحية موثّقة)
--
-- ما حدث: في #56 استُخدم `UPDATE ... SET game_points = 0 RETURNING game_points`
-- و`RETURNING` في PostgreSQL يعيد القيمة **بعد** التحديث، فكانت كل القيم صفراً.
-- النتيجة: حُوّلت نقاط الألعاب إلى Coin فعلياً (32 مستخدماً) لكن بلا أي قيد
-- في الدفتر، فظهرت فروق في المطابقة.
--
-- الإصلاح (القسم 12: لا حذف، التصحيح بقيود موثّقة):
--   لكل (مستخدم، عملة) يوجد فرق بين مجموع قيود الدفتر والرصيد الحقيقي،
--   نُسجّل قيداً افتتاحياً واحداً `entry_kind='opening'` يشرح الفرق:
--      balance_before = مجموع الدفتر الحالي
--      balance_after  = الرصيد الحقيقي
--      amount         = الفرق
--   لا يتغيّر أي رصيد إطلاقاً — القيد يوثّق فقط، ولا يمسّ جدول users.
--
-- سبب الفرق تاريخياً: أرصدة افتتاحية زُرعت قبل إنشاء الدفتر + تحويل النقاط.
-- ============================================================================

begin;

-- الجلسة تعمل بصلاحية المالك؛ نعلن دور الخدمة حتى تعمل دوال المطابقة الداخلية
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

create temp table _backfill_plan on commit drop as
with led as (
  select user_id, currency, sum(amount)::bigint as ledger_sum
  from public.wallet_transactions
  group by user_id, currency
),
live as (
  select u.id as user_id, x.currency, x.balance
  from public.users u
  cross join lateral (values
    ('gold'::text, u.balance_gold),
    ('diamond'::text, u.balance_diamond),
    ('conv_gold'::text, u.balance_converted_coins),
    ('promo_dia'::text, u.balance_diamond_promo)
  ) as x(currency, balance)
)
select coalesce(l.user_id, v.user_id) as user_id,
       coalesce(l.currency, v.currency) as currency,
       coalesce(l.ledger_sum, 0)::bigint as ledger_sum,
       coalesce(v.balance, 0)::bigint as live_balance,
       (coalesce(v.balance, 0) - coalesce(l.ledger_sum, 0))::bigint as difference
from led l
full join live v on v.user_id = l.user_id and v.currency = l.currency
where coalesce(l.ledger_sum, 0) <> coalesce(v.balance, 0)
  and coalesce(v.balance, 0) >= 0;

insert into public.wallet_transactions (
  user_id, type, amount, balance_before, balance_after, currency,
  idempotency_key, reference_type, reference_id, metadata, created_by_function,
  reason, executed_by_role, entry_kind
)
select
  p.user_id,
  'admin_adjustment'::public.wallet_tx_type,
  p.difference,
  p.ledger_sum,
  p.live_balance,
  p.currency,
  'opening-balance-' || p.user_id::text || '-' || p.currency,
  'opening_balance',
  null,
  jsonb_build_object(
    'source', 'ledger_opening_backfill',
    'ledger_sum_before', p.ledger_sum,
    'live_balance', p.live_balance,
    'note', 'أرصدة سابقة لإنشاء الدفتر + تحويل نقاط الألعاب في #56'
  ),
  'opening-balance-backfill',
  'opening_balance_backfill',
  'system',
  'opening'
from _backfill_plan p
where p.difference <> 0;

-- تحقق فوري: يجب أن تكون المطابقة نظيفة بعد الإصلاح
do $$
declare
  v_ok boolean;
begin
  select (public.reconcile_wallet_ledger()->>'ok')::boolean into v_ok;
  if v_ok is not true then
    raise exception 'المطابقة ما زالت غير نظيفة بعد التعبئة — تراجع تلقائي';
  end if;
end $$;

commit;
