-- ============================================================================
-- 61-prep2. إضافة أفعال التدقيق الجديدة لآلة حالات M4
-- (تُنفَّذ منفصلة: قيمة enum جديدة لا تُستخدم في نفس المعاملة)
-- ============================================================================
alter type public.audit_action_type add value if not exists 'review';
alter type public.audit_action_type add value if not exists 'request_info';
alter type public.audit_action_type add value if not exists 'processing';
alter type public.audit_action_type add value if not exists 'fail';