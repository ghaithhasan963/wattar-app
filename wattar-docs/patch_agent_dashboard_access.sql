-- Scoped agent access for assigned users and financial tasks.
-- Run after patch_wattar_v2_wallet_economy.sql and patch_admin_audit_controls.sql.

-- Keep account owners able to load their own staff profiles after admin RLS setup.
DROP POLICY IF EXISTS users_self_select ON public.users;
CREATE POLICY users_self_select ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.wattar_current_agent_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id
  FROM public.agents a
  JOIN public.users u ON u.id = a.user_id
  WHERE a.user_id = auth.uid()
    AND a.status = 'active'
    AND u.status = 'active'
    AND u.role = 'agent'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.wattar_current_agent_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_current_agent_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_agent_can_review_deposits()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agents a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.id = public.wattar_current_agent_id()
      AND a.status = 'active'
      AND a.can_approve_deposits
      AND u.status = 'active'
      AND u.role = 'agent'
  );
$$;
REVOKE ALL ON FUNCTION public.wattar_agent_can_review_deposits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_agent_can_review_deposits() TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_agent_can_review_withdrawals()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agents a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.id = public.wattar_current_agent_id()
      AND a.status = 'active'
      AND a.can_approve_withdrawals
      AND u.status = 'active'
      AND u.role = 'agent'
  );
$$;
REVOKE ALL ON FUNCTION public.wattar_agent_can_review_withdrawals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_agent_can_review_withdrawals() TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_read_agent_deposit_proof(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deposits d
    WHERE d.proof_url = p_path
      AND d.agent_id = public.wattar_current_agent_id()
      AND public.wattar_agent_can_review_deposits()
  );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_read_agent_deposit_proof(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_read_agent_deposit_proof(text) TO authenticated;

GRANT SELECT ON public.agents, public.deposits, public.diamond_withdrawals TO authenticated;

DROP POLICY IF EXISTS agents_agent_self_select ON public.agents;
CREATE POLICY agents_agent_self_select ON public.agents
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'agent' AND u.status = 'active'
    )
  );

DROP POLICY IF EXISTS deposits_agent_assigned_select ON public.deposits;
CREATE POLICY deposits_agent_assigned_select ON public.deposits
  FOR SELECT TO authenticated
  USING (
    public.wattar_agent_can_review_deposits()
    AND agent_id = public.wattar_current_agent_id()
  );

DROP POLICY IF EXISTS wattar_agent_deposit_proof_read ON storage.objects;
CREATE POLICY wattar_agent_deposit_proof_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-proofs'
    AND public.wattar_can_read_agent_deposit_proof(name)
  );

DROP POLICY IF EXISTS diamond_withdrawals_select ON public.diamond_withdrawals;
CREATE POLICY diamond_withdrawals_select ON public.diamond_withdrawals
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR (
      public.wattar_agent_can_review_withdrawals()
      AND agent_id = public.wattar_current_agent_id()
    )
  );

DROP FUNCTION IF EXISTS public.list_my_agent_customers();
DROP FUNCTION IF EXISTS public.list_my_agent_customers(integer, integer);
CREATE FUNCTION public.list_my_agent_customers(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  status text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT u.id,
         u.username::text,
         u.display_name::text,
         u.status::text,
         u.created_at
  FROM public.users u
  WHERE public.wattar_current_agent_id() IS NOT NULL
    AND u.status = 'active'
    AND (
      u.referred_by_agent_id = public.wattar_current_agent_id()
      OR EXISTS (
        SELECT 1
        FROM public.agent_groups g
        JOIN public.agent_group_memberships m ON m.group_id = g.id
        WHERE g.agent_id = public.wattar_current_agent_id()
          AND m.user_id = u.id
          AND m.status = 'active'
      )
    )
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.list_my_agent_customers(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_agent_customers(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_manage_agent_withdrawal_proof(p_path text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.wattar_agent_can_review_withdrawals()
    AND left(p_path, length('wd_' || auth.uid()::text || '_')) = 'wd_' || auth.uid()::text || '_'
    AND (
      SELECT count(*) < 30
      FROM storage.objects o
      WHERE o.bucket_id = 'deposit-proofs'
        AND left(o.name, length('wd_' || auth.uid()::text || '_')) = 'wd_' || auth.uid()::text || '_'
        AND o.created_at > now() - interval '24 hours'
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_manage_agent_withdrawal_proof(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_manage_agent_withdrawal_proof(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_read_agent_withdrawal_proof(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    left(p_path, length('wd_' || auth.uid()::text || '_')) = 'wd_' || auth.uid()::text || '_'
      AND public.wattar_agent_can_review_withdrawals()
    )
    OR EXISTS (
      SELECT 1
      FROM public.diamond_withdrawals d
      WHERE d.proof_url = p_path
        AND d.agent_id = public.wattar_current_agent_id()
        AND public.wattar_agent_can_review_withdrawals()
    )
    OR EXISTS (
      SELECT 1 FROM public.diamond_withdrawals d
      WHERE d.proof_url = p_path AND d.user_id = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_read_agent_withdrawal_proof(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_read_agent_withdrawal_proof(text) TO authenticated;

DROP POLICY IF EXISTS wattar_agent_withdrawal_proof_insert ON storage.objects;
CREATE POLICY wattar_agent_withdrawal_proof_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deposit-proofs'
    AND public.wattar_can_manage_agent_withdrawal_proof(name)
  );
DROP POLICY IF EXISTS wattar_agent_withdrawal_proof_read ON storage.objects;
CREATE POLICY wattar_agent_withdrawal_proof_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-proofs'
    AND public.wattar_can_read_agent_withdrawal_proof(name)
  );
DROP POLICY IF EXISTS wattar_agent_withdrawal_proof_delete ON storage.objects;
CREATE POLICY wattar_agent_withdrawal_proof_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deposit-proofs'
    AND left(name, length('wd_' || auth.uid()::text || '_')) = 'wd_' || auth.uid()::text || '_'
    AND public.wattar_agent_can_review_withdrawals()
  );
