-- Run after the wallet/economy patches. Apply this statement separately and
-- commit it before running patch_memberships_xp_acceleration.sql.
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'membership_purchase';
