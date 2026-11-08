-- Apply once to an existing Wattar database to enable admin dashboard access.
-- The first admin must already have role = 'admin' or 'super_admin' in public.users.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin')
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS users_self_update ON public.users;
DROP POLICY IF EXISTS users_admin_select ON public.users;
CREATE POLICY users_admin_select ON public.users
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS users_admin_update ON public.users;
CREATE POLICY users_admin_update ON public.users
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS agents_admin_select ON public.agents;
CREATE POLICY agents_admin_select ON public.agents
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS deposits_admin_select ON public.deposits;
CREATE POLICY deposits_admin_select ON public.deposits
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS withdrawals_admin_select ON public.withdrawals;
CREATE POLICY withdrawals_admin_select ON public.withdrawals
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS transfers_admin_select ON public.transfers;
CREATE POLICY transfers_admin_select ON public.transfers
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS admin_audit_log_admin_select ON public.admin_audit_log;
CREATE POLICY admin_audit_log_admin_select ON public.admin_audit_log
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS rooms_admin_select ON public.rooms;
CREATE POLICY rooms_admin_select ON public.rooms
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS rooms_admin_update ON public.rooms;
CREATE POLICY rooms_admin_update ON public.rooms
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS game_configs_admin_update ON public.game_configs;
CREATE POLICY game_configs_admin_update ON public.game_configs
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS admin_settings_admin_select ON public.admin_settings;
CREATE POLICY admin_settings_admin_select ON public.admin_settings
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS admin_settings_admin_update ON public.admin_settings;
CREATE POLICY admin_settings_admin_update ON public.admin_settings
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
