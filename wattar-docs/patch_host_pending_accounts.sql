-- Track admin-created host accounts without bypassing the user's own age
-- confirmation and profile-completion requirements.
BEGIN;

ALTER TABLE public.verified_hosts
  ALTER COLUMN approved_by DROP NOT NULL,
  ALTER COLUMN approved_at DROP NOT NULL;

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_status_check;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_status_check
  CHECK (status IN ('pending', 'active', 'suspended'));

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_active_approval_complete;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_active_approval_complete
  CHECK (status <> 'active' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

COMMIT;
