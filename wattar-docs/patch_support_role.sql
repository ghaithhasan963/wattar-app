-- Add a least-privilege staff role for the support inbox.
-- Run this file separately before patch_support_tickets.sql.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'support';
