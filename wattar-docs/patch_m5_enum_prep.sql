-- ============================================================================
-- Wattar — M5.1 prep: قيم enum جديدة لنظام الوكالات
-- تاريخ: 2026-11-17 · ملف منفصل إلزامياً (قيمة enum لا تُستخدم في نفس المعاملة)
-- ============================================================================
begin;

-- دور مدير الوكالة في هرمية الإدارة (الإدارة العليا ← مدير الوكالة ← الوكيل ← المستخدم)
alter type public.user_role add value if not exists 'agency_manager';

-- أفعال سجل التدقيق الخاصة بالوكالات والمحافظ التشغيلية
alter type public.audit_action_type add value if not exists 'create_agency';
alter type public.audit_action_type add value if not exists 'update_agency';
alter type public.audit_action_type add value if not exists 'approve_agency';
alter type public.audit_action_type add value if not exists 'suspend_agency';
alter type public.audit_action_type add value if not exists 'revoke_agency';
alter type public.audit_action_type add value if not exists 'assign_agency_manager';
alter type public.audit_action_type add value if not exists 'assign_agent_agency';
alter type public.audit_action_type add value if not exists 'credit_agency';
alter type public.audit_action_type add value if not exists 'transfer_agency_funds';
alter type public.audit_action_type add value if not exists 'freeze_wallet';
alter type public.audit_action_type add value if not exists 'unfreeze_wallet';
alter type public.audit_action_type add value if not exists 'funding_request';
alter type public.audit_action_type add value if not exists 'funding_decision';

commit;
