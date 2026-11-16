-- ============================================================
-- patch_harden_table_grants.sql — migration #46 (M2.2 / M2.1)
--
-- الهدف: إغلاق سطح الهجوم الموروث من `GRANT ALL` الافتراضي.
-- الدليل: wattar-docs/AUDIT_M2_SECURITY_MATRIX.md (القسم 2 و3.2).
--
-- ما تفعله هذه المهاجرة:
--   1. سحب كل صلاحيات الجداول/التسلسلات/الدوال في `public` من الدور `anon`.
--      لا واجهة في التطبيق تقرأ أو تكتب أو تستدعي RPC قبل تسجيل الدخول،
--      وكل ما قبل الدخول يمرّ عبر GoTrue وحده.
--   2. سحب TRUNCATE / REFERENCES / TRIGGER / MAINTAIN من `authenticated`
--      (لا يستخدمها أي عميل؛ RLS لا تحمي TRUNCATE أصلاً).
--   3. سحب الكتابة المباشرة من `authenticated` على الجداول المالية
--      والجداول التي تُكتب حصراً عبر RPC أو service_role.
--   4. تثبيت الصلاحيات الافتراضية للأشياء المستقبلية.
--   5. توحيد `search_path` إلى `public, pg_temp` للدوال الثلاث الناقصة.
--
-- ما لا تلمسه: صلاحيات `authenticated` التي تستخدمها لوحة الإدارة فعلياً
--   (admin_settings, daily_missions, deposit_methods, game_configs, gifts, rooms)
--   وصلاحيات القراءة، وصلاحيات `user_notifications` (تعليم كمقروء).
--
-- آمن للإعادة بالكامل (REVOKE/ALTER متكررة بلا أثر تراكمي).
-- التراجع: GRANT ALL ON ALL TABLES IN SCHEMA public TO anon; … (غير مستحسن)
-- ============================================================
BEGIN;

-- ---------- 1) anon: لا شيء ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- ---------- 2) authenticated: إزالة الصلاحيات غير المستخدمة ----------
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ---------- 3) authenticated: منع الكتابة المباشرة على الجداول الحساسة ----------
-- المالية والدفتر: تُكتب حصراً عبر دوال ذرّية (M3) أو service_role.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_transactions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.withdrawals         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.deposits            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transfers           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.gift_transactions   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.game_bets           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.game_rounds         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.leaderboards        FROM authenticated;

-- هوية وجلسات ومراجع: تُدار عبر RPC / GoTrue / تريغرات SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.users         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.otp_codes     FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.referrals     FROM authenticated;

-- وكالات: تُدار عبر RPC إداري.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agents       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_groups FROM authenticated;

-- ---------- 4) الصلاحيات الافتراضية للأشياء المستقبلية ----------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM authenticated;

-- ---------- 5) توحيد search_path ----------
ALTER FUNCTION public.create_room_seats()      SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_auth_user()   SET search_path = public, pg_temp;
ALTER FUNCTION public.record_adult_consent()   SET search_path = public, pg_temp;

-- ---------- 6) تعليقات توثيقية ----------
COMMENT ON TABLE public.users IS
  'هوية المستخدم. القراءة حسب السياسات؛ الكتابة عبر update_my_profile / RPC إداري فقط.';
COMMENT ON TABLE public.wallet_transactions IS
  'دفتر أستاذ مالي append-only. لا كتابة من العميل إطلاقاً.';

COMMIT;
