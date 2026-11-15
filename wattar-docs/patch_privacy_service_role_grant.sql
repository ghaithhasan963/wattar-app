-- ============================================================
-- patch_privacy_service_role_grant.sql — M1.7: السماح لدوال الخادم بفحص الخصوصية
-- السبب: check_privacy_permission مُنحت سابقاً لـ authenticated فقط.
--        الدوال السحابية (Edge Functions) تعمل بهوية service_role، فتحتاج
--        صلاحية تنفيذ صريحة لتفحص «من يستطيع دخول غرفي» قبل إصدار توكن LiveKit.
-- الأثر: GRANT واحد فقط. لا تغيير على المنطق ولا على البيانات.
-- ============================================================
BEGIN;

GRANT EXECUTE ON FUNCTION public.check_privacy_permission(uuid, text, uuid) TO service_role;

COMMIT;
