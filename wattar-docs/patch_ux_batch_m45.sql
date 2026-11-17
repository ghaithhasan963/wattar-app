-- =====================================================================
-- Wattar — UX batch M4.6 (المحفظة + الأهلية + الإشعارات التفصيلية)
-- Registry: #62
-- =====================================================================
--
-- 1) get_my_wallet_options: exposes eligibility (verified host OR agent),
--    conversion rate, deposit fee + coins rate, withdrawal fee + USD limits.
-- 2) create_my_diamond_withdrawal: verified hosts AND agents may withdraw;
--    regular users keep Diamond -> Coin conversion only.
-- 3) list_my_deposit_methods: adds effective_rate + fee_percent so the app
--    can show exactly how many Coins the user will receive.
-- 4) create_wattar_event_notification: sender/actor name + amounts in every
--    notification body (private message, gift, friend request, follow, room
--    invitation, deposit / withdrawal updates).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Wallet options
-- ---------------------------------------------------------------------
drop function if exists public.get_my_wallet_options();

create or replace function public.get_my_wallet_options()
returns table (
  diamond_to_coin_rate numeric,
  diamonds_per_usd numeric,
  withdrawals_enabled boolean,
  min_withdrawal_diamonds bigint,
  has_assigned_agent boolean,
  is_verified_host boolean,
  is_agent boolean,
  withdrawal_fee_percent numeric,
  max_withdrawal_usd_per_day numeric,
  coins_per_usd numeric,
  deposit_fee_percent numeric,
  min_withdrawal_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'diamond_to_coin_rate'), 0) as diamond_to_coin_rate,
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'diamonds_per_usd'), 0) as diamonds_per_usd,
      coalesce((select s.value = 'true'::jsonb from public.admin_settings s where s.key = 'withdrawals_enabled'), false) as withdrawals_enabled,
      coalesce((select (s.value #>> '{}')::bigint from public.admin_settings s where s.key = 'min_withdrawal_diamonds'), 30000) as min_withdrawal_diamonds,
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'withdrawal_fee_percent'), 0) as withdrawal_fee_percent,
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'max_withdrawal_usd_per_day'), 500) as max_withdrawal_usd_per_day,
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'paid_coins_per_usd'), 0) as coins_per_usd,
      coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'deposit_fee_percent'), 0) as deposit_fee_percent
  ),
  eligibility as (
    select
      exists (
        select 1 from public.verified_hosts vh
        where vh.user_id = auth.uid() and vh.status = 'active'
      ) as is_verified_host,
      exists (
        select 1 from public.agents a
        where a.user_id = auth.uid() and a.status = 'active'
      ) as is_agent,
      exists (
        select 1
        from public.agent_group_memberships m
        join public.agent_groups g on g.id = m.group_id
        join public.agents a on a.id = g.agent_id and a.status = 'active' and a.can_approve_withdrawals
        where m.user_id = auth.uid() and m.status = 'active'
      ) as has_assigned_agent
  )
  select
    settings.diamond_to_coin_rate,
    settings.diamonds_per_usd,
    settings.withdrawals_enabled,
    settings.min_withdrawal_diamonds,
    eligibility.has_assigned_agent,
    eligibility.is_verified_host,
    eligibility.is_agent,
    settings.withdrawal_fee_percent,
    settings.max_withdrawal_usd_per_day,
    settings.coins_per_usd,
    settings.deposit_fee_percent,
    case
      when coalesce(settings.diamonds_per_usd, 0) > 0
        then round(settings.min_withdrawal_diamonds::numeric / settings.diamonds_per_usd, 2)
      else 0
    end as min_withdrawal_usd
  from settings, eligibility
  where auth.uid() is not null;
$$;

revoke all on function public.get_my_wallet_options() from public, anon;
grant execute on function public.get_my_wallet_options() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Withdrawal eligibility — verified host OR agent
-- ---------------------------------------------------------------------
create or replace function public.create_my_diamond_withdrawal(
  p_user_id uuid,
  p_amount_diamond bigint,
  p_method public.deposit_method,
  p_payout_details jsonb,
  p_idempotency_key text
) returns public.diamond_withdrawals
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.diamond_withdrawals%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(14,6);
  v_minimum bigint;
  v_fee_percent numeric(8,4);
  v_gross numeric(14,2);
  v_fee numeric(14,2);
  v_max_daily numeric(14,2);
  v_daily_total numeric(14,2);
  v_withdrawal public.diamond_withdrawals%ROWTYPE;
  v_is_host boolean;
  v_is_agent boolean;
BEGIN
  IF p_user_id IS NULL
     OR (auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id)
     OR p_amount_diamond IS NULL OR p_amount_diamond <= 0
     OR p_method IS NULL OR jsonb_typeof(coalesce(p_payout_details, '{}'::jsonb)) <> 'object'
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'Invalid withdrawal request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('diamond-withdrawal:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.diamond_withdrawals
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.amount_diamond <> p_amount_diamond
       OR v_existing.method <> p_method
       OR v_existing.payout_details IS DISTINCT FROM coalesce(p_payout_details, '{}'::jsonb) THEN
      RAISE EXCEPTION 'Idempotency key already used with different withdrawal data';
    END IF;
    RETURN v_existing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_settings s
    WHERE s.key = 'withdrawals_enabled' AND s.value = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'Diamond withdrawals are currently disabled'; END IF;

  -- M4.6: السحب متاح للمضيفات الموثقات النشطات وللوكلاء النشطين.
  -- المستخدم العادي يحوّل Diamond إلى Coin فقط ولا يسحب نقدًا.
  SELECT
    EXISTS (SELECT 1 FROM public.verified_hosts vh WHERE vh.user_id = p_user_id AND vh.status = 'active'),
    EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = p_user_id AND a.status = 'active')
  INTO v_is_host, v_is_agent;
  IF NOT coalesce(v_is_host, false) AND NOT coalesce(v_is_agent, false) THEN
    RAISE EXCEPTION 'Withdrawals are available to verified hosts and agents only; regular users can convert Diamonds to Coins';
  END IF;

  -- القسم 13: السحب عبر USDT (TRC20/BEP20) أو عبر الوكيل للمستخدمين التابعين
  IF p_method NOT IN ('usdt'::public.deposit_method, 'agent'::public.deposit_method) THEN
    RAISE EXCEPTION 'Withdrawals support USDT or assigned agent only';
  END IF;

  SELECT (s.value #>> '{}')::numeric INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'diamonds_per_usd';
  IF coalesce(v_rate, 0) <= 0 THEN RAISE EXCEPTION 'Withdrawal rate is not configured'; END IF;
  SELECT coalesce((s.value #>> '{}')::bigint, 30000) INTO v_minimum
  FROM public.admin_settings s WHERE s.key = 'min_withdrawal_diamonds';
  SELECT coalesce((s.value #>> '{}')::numeric, 0) INTO v_fee_percent
  FROM public.admin_settings s WHERE s.key = 'withdrawal_fee_percent';
  IF v_fee_percent < 0 OR v_fee_percent >= 100 THEN RAISE EXCEPTION 'Invalid withdrawal fee setting'; END IF;
  IF p_amount_diamond < coalesce(v_minimum, 30000) THEN RAISE EXCEPTION 'Withdrawal amount is below the minimum'; END IF;

  IF p_method = 'agent'::public.deposit_method THEN
    SELECT a.id INTO v_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active' AND a.can_approve_withdrawals
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY m.decided_at DESC NULLS LAST LIMIT 1;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'No active withdrawal agent is assigned'; END IF;
  ELSE
    IF coalesce(p_payout_details->>'network', '') NOT IN ('trc20', 'bep20') THEN
      RAISE EXCEPTION 'USDT withdrawals require network trc20 or bep20';
    END IF;
    IF (p_payout_details->>'network') = 'trc20' THEN
      IF coalesce(p_payout_details->>'address', '') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 payout address';
      END IF;
    ELSE
      IF coalesce(p_payout_details->>'address', '') !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid BEP20 payout address';
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Account is unavailable';
  END IF;
  IF v_user.balance_diamond < p_amount_diamond THEN RAISE EXCEPTION 'Insufficient withdrawable Diamonds'; END IF;
  v_gross := round(p_amount_diamond / v_rate, 2);
  v_fee := round(v_gross * v_fee_percent / 100, 2);
  IF v_gross <= v_fee OR v_gross - v_fee <= 0 THEN RAISE EXCEPTION 'Withdrawal amount is too small after fees'; END IF;

  SELECT coalesce((s.value #>> '{}')::numeric, 500) INTO v_max_daily
  FROM public.admin_settings s WHERE s.key = 'max_withdrawal_usd_per_day';
  v_max_daily := coalesce(v_max_daily, 500);
  SELECT coalesce(sum(w.amount_usd), 0) INTO v_daily_total
  FROM public.diamond_withdrawals w
  WHERE w.user_id = p_user_id AND w.created_at >= date_trunc('day', now())
    AND w.status IN ('pending', 'reviewing', 'approved', 'processing', 'completed');
  IF v_daily_total + v_gross > v_max_daily THEN
    RAISE EXCEPTION 'Daily withdrawal limit exceeded';
  END IF;

  INSERT INTO public.diamond_withdrawals (
    user_id, agent_id, method, payout_details, amount_diamond, amount_usd,
    fee_usd, net_usd, diamonds_per_usd, idempotency_key
  ) VALUES (
    p_user_id, v_agent_id, p_method, coalesce(p_payout_details, '{}'::jsonb),
    p_amount_diamond, v_gross, v_fee, v_gross - v_fee, v_rate, p_idempotency_key
  ) RETURNING * INTO v_withdrawal;
  PERFORM public.record_wallet_transaction(
    p_user_id, 'withdraw'::public.wallet_tx_type, -p_amount_diamond,
    'diamond', v_agent_id, 'diamond-withdrawal:' || v_withdrawal.id::text,
    'diamond_withdrawal', v_withdrawal.id,
    jsonb_build_object('amount_usd', v_gross, 'fee_usd', v_fee, 'net_usd', v_gross - v_fee),
    'withdrawal-request'
  );
  RETURN v_withdrawal;
END;
$$;

revoke all on function public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) from public, anon;
grant execute on function public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) Deposit methods with effective rate + fee for live estimates
-- ---------------------------------------------------------------------
drop function if exists public.list_my_deposit_methods();

create or replace function public.list_my_deposit_methods()
returns table (
  method public.deposit_method,
  name_ar text,
  instructions text,
  min_amount_usd numeric,
  max_amount_usd numeric,
  effective_rate numeric,
  fee_percent numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.method,
    d.name_ar::text,
    d.instructions,
    d.min_amount_usd,
    d.max_amount_usd,
    coalesce(
      d.exchange_rate_usd_to_coins,
      (
        select a.exchange_rate_usd_to_gold
        from public.agent_group_memberships m
        join public.agent_groups g on g.id = m.group_id
        join public.agents a on a.id = g.agent_id and a.status = 'active'
        where m.user_id = auth.uid() and m.status = 'active'
        order by m.decided_at desc nulls last
        limit 1
      ),
      (
        select a.exchange_rate_usd_to_gold
        from public.agents a
        where a.user_id = auth.uid() and a.status = 'active'
        limit 1
      ),
      (select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'paid_coins_per_usd')
    ) as effective_rate,
    coalesce((select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'deposit_fee_percent'), 0) as fee_percent
  from public.deposit_methods d
  join public.users u on u.id = auth.uid()
  where d.is_enabled
    and u.status = 'active'
    and u.adult_confirmed_at is not null
    and exists (
      select 1 from public.admin_settings s
      where s.key = 'deposits_enabled' and s.value = 'true'::jsonb
    )
    and (
      d.method <> 'agent'::public.deposit_method
      or exists (
        select 1
        from public.agent_group_memberships m
        join public.agent_groups g on g.id = m.group_id
        join public.agents a on a.id = g.agent_id and a.status = 'active'
        where m.user_id = auth.uid() and m.status = 'active'
      )
      or exists (
        select 1 from public.agents a
        where a.user_id = auth.uid() and a.status = 'active'
      )
    )
  order by d.sort_order, d.name_ar;
$$;

revoke all on function public.list_my_deposit_methods() from public, anon;
grant execute on function public.list_my_deposit_methods() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) Detailed notifications (actor name + amounts)
-- ---------------------------------------------------------------------
create or replace function public.create_wattar_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_recipient_id uuid;
  v_actor_id uuid;
  v_actor_name text;
  v_reference_id uuid;
  v_event_type text;
  v_title text;
  v_body text;
  v_route text;
  v_conversation public.private_conversations%ROWTYPE;
  v_gift_name text;
BEGIN
  IF TG_TABLE_NAME = 'friend_requests' THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
      v_recipient_id := NEW.recipient_id;
      v_actor_id := NEW.requester_id;
      v_reference_id := NEW.id;
      v_event_type := 'friend_request';
      v_title := 'طلب صداقة جديد';
      v_body := 'أرسل إليك شخص طلب صداقة.';
      v_route := '/(tabs)/friends';
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      v_recipient_id := NEW.requester_id;
      v_actor_id := NEW.recipient_id;
      v_reference_id := NEW.id;
      v_event_type := 'friend_accepted';
      v_title := 'تم قبول طلب الصداقة';
      v_body := 'أصبح بإمكانكما التواصل في Wattar.';
      v_route := '/(tabs)/friends';
    END IF;
  ELSIF TG_TABLE_NAME = 'private_messages' AND TG_OP = 'INSERT' THEN
    SELECT * INTO v_conversation
    FROM public.private_conversations
    WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_recipient_id := CASE
      WHEN NEW.sender_id = v_conversation.user_one_id THEN v_conversation.user_two_id
      ELSE v_conversation.user_one_id
    END;
    v_actor_id := NEW.sender_id;
    v_reference_id := NEW.id;
    v_event_type := 'private_message';
    v_title := 'رسالة خاصة جديدة';
    v_body := 'أرسل إليك شخص رسالة خاصة.';
    v_route := '/messages/' || NEW.conversation_id::text;
  ELSIF TG_TABLE_NAME = 'room_invitations' THEN
    IF NOT (TG_OP = 'INSERT' AND NEW.status = 'pending') THEN
      RETURN NEW;
    END IF;
    v_recipient_id := NEW.recipient_id;
    v_actor_id := NEW.sender_id;
    v_reference_id := NEW.id;
    v_event_type := 'room_invitation';
    v_title := 'دعوة إلى غرفة صوتية';
    v_body := 'دعاك شخص للانضمام إلى غرفة.';
    v_route := '/room/' || NEW.room_id::text;
  ELSIF TG_TABLE_NAME = 'user_follows' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.followed_id;
    v_actor_id := NEW.follower_id;
    v_reference_id := NEW.follower_id;
    v_event_type := 'new_follower';
    v_title := 'متابع جديد';
    v_body := 'بدأ شخص بمتابعتك.';
    v_route := '/(tabs)/friends';
  ELSIF TG_TABLE_NAME = 'gift_transactions' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.to_user_id;
    v_actor_id := NEW.from_user_id;
    v_reference_id := NEW.id;
    v_event_type := 'gift_received';
    v_title := 'وصلتك هدية';
    SELECT coalesce(g.name_ar, g.name) INTO v_gift_name
    FROM public.gifts g WHERE g.id = NEW.gift_id;
    v_body := 'أرسل إليك شخص هدية.';
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'deposits' THEN
    IF NOT (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
      RETURN NEW;
    END IF;
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'deposit_update';
    v_title := 'تحديث طلب الشحن';
    v_body := CASE NEW.status::text
      WHEN 'completed' THEN 'تم إكمال طلب شحن بقيمة $' || NEW.amount_usd::text
        || ' وأُضيف ' || NEW.amount_gold::text || ' Coin إلى رصيدك.'
      WHEN 'rejected' THEN 'تم رفض طلب شحن بقيمة $' || NEW.amount_usd::text
        || coalesce('. السبب: ' || nullif(NEW.rejected_reason, ''), '.')
      WHEN 'reviewing' THEN 'طلب شحنك بقيمة $' || NEW.amount_usd::text || ' قيد المراجعة.'
      WHEN 'processing' THEN 'طلب شحنك بقيمة $' || NEW.amount_usd::text || ' قيد التنفيذ.'
      WHEN 'failed' THEN 'تعذر تنفيذ طلب شحن بقيمة $' || NEW.amount_usd::text
        || coalesce('. السبب: ' || nullif(NEW.rejected_reason, ''), '.')
      ELSE 'تغيرت حالة طلب الشحن بقيمة $' || NEW.amount_usd::text || '.'
    END;
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'diamond_withdrawals' THEN
    IF NOT (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
      RETURN NEW;
    END IF;
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'withdrawal_update';
    v_title := 'تحديث طلب السحب';
    v_body := CASE NEW.status::text
      WHEN 'completed' THEN 'تم تنفيذ سحب ' || NEW.amount_diamond::text || ' Diamond'
        || ' واستلمت $' || NEW.net_usd::text || '.'
      WHEN 'rejected' THEN 'تم رفض طلب سحب ' || NEW.amount_diamond::text || ' Diamond وأُعيد الرصيد.'
      WHEN 'reviewing' THEN 'طلب سحب ' || NEW.amount_diamond::text || ' Diamond قيد المراجعة.'
      WHEN 'processing' THEN 'طلب سحب ' || NEW.amount_diamond::text || ' Diamond قيد التنفيذ.'
      WHEN 'failed' THEN 'تعذر تنفيذ سحب ' || NEW.amount_diamond::text || ' Diamond وأُعيد الرصيد.'
      ELSE 'تغيرت حالة طلب سحب ' || NEW.amount_diamond::text || ' Diamond.'
    END;
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'host_applications' THEN
    IF NOT (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
            AND NEW.status = 'rejected') THEN
      RETURN NEW;
    END IF;
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'host_update';
    v_title := 'تحديث طلب المضيفة';
    v_body := 'تم تحديث طلبك. راجعي ملاحظة الإدارة.';
    v_route := '/host-application';
  ELSIF TG_TABLE_NAME = 'verified_hosts' THEN
    v_recipient_id := NEW.user_id;
    IF TG_OP = 'INSERT' THEN
      v_actor_id := NEW.approved_by;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN
        v_actor_id := NEW.approved_by;
      ELSE
        v_actor_id := NULL;
      END IF;
    ELSE
      v_actor_id := NULL;
    END IF;
    v_reference_id := gen_random_uuid();
    v_event_type := 'host_update';
    v_title := 'تحديث حالة المضيفة';
    v_body := CASE NEW.status
      WHEN 'active' THEN 'تم تفعيل حسابك كمضيفة موثقة.'
      ELSE 'تم تعليق حالة التوثيق. تواصلي مع الإدارة للمراجعة.'
    END;
    v_route := '/(tabs)/profile';
  ELSIF TG_TABLE_NAME = 'membership_purchases' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.user_id;
    v_reference_id := NEW.id;
    v_event_type := 'membership_update';
    v_title := 'تم تفعيل عضويتك';
    v_body := 'تم تسجيل شراء العضوية بنجاح.';
    v_route := '/membership';
  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient_id IS NULL OR v_recipient_id = v_actor_id THEN
    RETURN NEW;
  END IF;
  IF v_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_actor_id AND b.blocked_id = v_recipient_id)
       OR (b.blocker_id = v_recipient_id AND b.blocked_id = v_actor_id)
  ) THEN
    RETURN NEW;
  END IF;

  -- اسم المرسل/الفاعل — يجعل الإشعار مفصّلًا بدل "شخص"
  IF v_actor_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.username), ''), 'مستخدم')
    INTO v_actor_name
    FROM public.users u WHERE u.id = v_actor_id;
  END IF;

  IF v_actor_name IS NOT NULL THEN
    v_body := CASE v_event_type
      WHEN 'friend_request' THEN v_actor_name || ' أرسل إليك طلب صداقة.'
      WHEN 'friend_accepted' THEN v_actor_name || ' قبل طلب صداقتك.'
      WHEN 'private_message' THEN v_actor_name || ' أرسل إليك رسالة خاصة.'
      WHEN 'room_invitation' THEN v_actor_name || ' دعاك للانضمام إلى غرفة صوتية.'
      WHEN 'new_follower' THEN v_actor_name || ' بدأ بمتابعتك.'
      WHEN 'gift_received' THEN v_actor_name || ' أرسل إليك هدية'
        || coalesce(' ' || v_gift_name, '') || '.'
      ELSE v_body
    END;
    IF v_event_type IN ('private_message', 'gift_received', 'room_invitation', 'friend_request', 'new_follower') THEN
      v_title := CASE v_event_type
        WHEN 'private_message' THEN 'رسالة من ' || v_actor_name
        WHEN 'gift_received' THEN 'هدية من ' || v_actor_name
        WHEN 'room_invitation' THEN 'دعوة من ' || v_actor_name
        WHEN 'friend_request' THEN 'طلب صداقة من ' || v_actor_name
        WHEN 'new_follower' THEN 'متابع جديد: ' || v_actor_name
      END;
    END IF;
  END IF;

  INSERT INTO public.user_notifications (
    user_id, actor_id, event_type, reference_id, title, body, route
  ) VALUES (
    v_recipient_id, v_actor_id, v_event_type, v_reference_id, v_title, v_body, v_route
  )
  ON CONFLICT (user_id, event_type, reference_id)
  DO NOTHING;

  RETURN NEW;
END;
$$;

revoke all on function public.create_wattar_event_notification() from public, anon, authenticated;
grant execute on function public.create_wattar_event_notification() to service_role;

-- ---------------------------------------------------------------------
-- 5) Re-assert service-only + public surface (P8)
-- ---------------------------------------------------------------------
revoke all on function public.settle_deposit_request(uuid, text, uuid, text, text) from public, anon, authenticated;

select json_build_object(
  'applied', true,
  'wallet_options', (select to_jsonb(o) from public.get_my_wallet_options() o),
  'methods_count', (select count(*) from public.list_my_deposit_methods())
) as result;

commit;
