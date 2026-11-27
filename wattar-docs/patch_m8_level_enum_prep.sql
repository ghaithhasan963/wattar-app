-- ============================================================
-- patch_m8_level_enum_prep.sql  (Migration #77p — تمهيد #77)
-- M8.7: قيمة محفظة لمكافآت المستويات — ALTER TYPE ADD VALUE لا
-- يُنفَّذ داخل كتلة معاملة، فأُبعد عن ملف #77 الرئيسي (نمط #74p).
-- ============================================================
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'level_reward'
  AFTER 'protection_purchase';
