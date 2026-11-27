-- ============================================================
-- patch_m8_enum_prep.sql
-- M8 — إضافة قيم الأنواع اللازمة قبل الترحيل #74.
-- منفصل عن الترحيل لأن ALTER TYPE ... ADD VALUE لا يمكن استخدام
-- القيمة الجديدة في نفس المعاملة.
-- ============================================================
BEGIN;

ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'host_target_reward';
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'vip_purchase';
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'protection_purchase';

ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'revoke';

COMMIT;
