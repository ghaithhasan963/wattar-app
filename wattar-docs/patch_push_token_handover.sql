-- M2.8 (F2): push token handover between accounts on the same device.
--
-- register_my_push_token previously refused to take over an Expo token that was
-- still attached to another account (e.g. the app was uninstalled or crashed
-- before sign-out). The row then stayed forever, so the new account on the same
-- device could never receive push notifications. A token can only be obtained by
-- the physical device, so moving it to the current authenticated user is safe and
-- matches how push registration works on Android/iOS.
--
-- Run after patch_social_foundation.sql. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_my_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR p_token IS NULL
     OR length(p_token) > 200
     OR p_token !~ '^Expo(nent)?PushToken\[[^]]+\]$'
     OR p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'بيانات الإشعارات غير صالحة';
  END IF;

  INSERT INTO public.push_tokens (user_id, expo_push_token, platform, updated_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (expo_push_token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.register_my_push_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_push_token(text, text) TO authenticated;

COMMIT;
