-- Persistent server-side throttling for unauthenticated account creation and SMS OTP.
-- Apply after the base schema. Only Edge Functions using service_role can consume limits.
BEGIN;

CREATE TABLE IF NOT EXISTS public.public_auth_rate_limits (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  request_count integer NOT NULL CHECK (request_count > 0),
  window_started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_auth_rate_limits_updated_at
  ON public.public_auth_rate_limits (updated_at);

ALTER TABLE public.public_auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_auth_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_public_auth_rate_limits(
  p_bucket_hashes text[],
  p_limits integer[],
  p_window_seconds integer[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_index integer;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_allowed boolean := true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_bucket_hashes IS NULL OR p_limits IS NULL OR p_window_seconds IS NULL
     OR cardinality(p_bucket_hashes) NOT BETWEEN 1 AND 4
     OR cardinality(p_bucket_hashes) <> cardinality(p_limits)
     OR cardinality(p_bucket_hashes) <> cardinality(p_window_seconds) THEN
    RAISE EXCEPTION 'بيانات تحديد المحاولات غير صالحة';
  END IF;

  FOR v_index IN 1..cardinality(p_bucket_hashes) LOOP
    IF p_bucket_hashes[v_index] !~ '^[0-9a-f]{64}$'
       OR p_limits[v_index] NOT BETWEEN 1 AND 100
       OR p_window_seconds[v_index] NOT BETWEEN 1 AND 2592000 THEN
      RAISE EXCEPTION 'بيانات تحديد المحاولات غير صالحة';
    END IF;

    INSERT INTO public.public_auth_rate_limits AS current_limit (
      bucket_hash, request_count, window_started_at, updated_at
    ) VALUES (
      p_bucket_hashes[v_index], 1, v_now, v_now
    )
    ON CONFLICT (bucket_hash) DO UPDATE
      SET request_count = CASE
            WHEN current_limit.window_started_at
              <= v_now - make_interval(secs => p_window_seconds[v_index]) THEN 1
            ELSE current_limit.request_count + 1
          END,
          window_started_at = CASE
            WHEN current_limit.window_started_at
              <= v_now - make_interval(secs => p_window_seconds[v_index]) THEN v_now
            ELSE current_limit.window_started_at
          END,
          updated_at = v_now
    RETURNING request_count INTO v_count;

    IF v_count > p_limits[v_index] THEN
      v_allowed := false;
    END IF;
  END LOOP;

  DELETE FROM public.public_auth_rate_limits
  WHERE updated_at < v_now - interval '30 days';

  RETURN v_allowed;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_public_auth_rate_limits(text[], integer[], integer[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_auth_rate_limits(text[], integer[], integer[])
  TO service_role;

COMMIT;
