-- Financial records are created and changed only by Edge Functions using
-- service_role. Clients may read their own records but cannot forge or edit them.

DROP POLICY IF EXISTS deposits_self_insert ON public.deposits;
DROP POLICY IF EXISTS deposits_self_update ON public.deposits;
DROP POLICY IF EXISTS withdrawals_self_insert ON public.withdrawals;
DROP POLICY IF EXISTS withdrawals_self_cancel ON public.withdrawals;
