-- Run this patch and commit it before patch_paid_messaging.sql.
-- PostgreSQL does not permit newly added enum values to be used in the same transaction.

ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'message_sent';
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'message_commission';
