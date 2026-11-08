-- ============================================================================
-- Wattar — قاعدة بيانات Supabase الكاملة
-- تطبيق صوتي اجتماعي + ألعاب + محفظة داخلية + نظام وكلاء + لوحة أدمن
--
-- Version: 1.0.0
-- Target:  Supabase (PostgreSQL 15+)
-- License: Proprietary
--
-- المبادئ التصميمية:
--   1) Append-only ledger للمحفظة (لا UPDATE / لا DELETE)
--   2) Atomic operations عبر دالة record_wallet_transaction
--   3) Row Level Security على كل جدول
--   4) Audit log لكل عملية إدارية
--   5) التصميم قابل للتوسع (multi-tier agents, multi-currency, future games)
-- ============================================================================

-- ============================================================================
-- 0) الإعدادات الأساسية + الإضافات
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- بحث نصي سريع
CREATE EXTENSION IF NOT EXISTS "btree_gist";     -- لمنع التداخل الزمني

SET timezone TO 'Asia/Damascus';
SET statement_timeout TO '30s';

-- ============================================================================
-- 1) الأنواع المخصصة (ENUMs)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('guest', 'user', 'agent', 'admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'blacklisted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE wallet_tx_type AS ENUM (
        'deposit',            -- شحن (USDT/شام كاش/سيرياتيل كاش/وكيل) - يدوي
        'withdraw',           -- سحب (عن طريق الوكيل/الأدمن) - يدوي
        'transfer_out',       -- تحويل صادر لمستخدم آخر
        'transfer_in',        -- تحويل وارد من مستخدم آخر
        'bet',                -- رهان في لعبة
        'win',                -- ربح في لعبة
        'gift_sent',          -- إرسال هدية
        'gift_received',      -- استقبال هدية
        'agent_credit',       -- شحن رصيد وكيل من الأدمن
        'agent_debit',        -- خصم من رصيد وكيل
        'admin_adjustment',   -- تعديل يدوي من الأدمن
        'referral_bonus',     -- مكافأة إحالة
        'daily_bonus',        -- مكافأة يومية مجانية
        'signup_bonus'        -- مكافأة تسجيل
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE deposit_method AS ENUM ('usdt', 'sham_cash', 'syriatel_cash', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE tx_status AS ENUM ('pending', 'reviewing', 'approved', 'completed', 'failed', 'cancelled', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE game_type AS ENUM ('wheel', 'dice', 'aviator', 'plinko');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE room_status AS ENUM ('waiting', 'live', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE seat_status AS ENUM ('empty', 'locked', 'occupied', 'muted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE platform_type AS ENUM ('android', 'ios', 'web');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE audit_action_type AS ENUM (
        'create', 'update', 'delete', 'approve', 'reject', 'suspend',
        'ban', 'unban', 'force_win', 'force_lose', 'adjust_balance',
        'set_rtp', 'create_agent', 'credit_agent', 'reset_password'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2) جدول المستخدمين الأساسي (users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- معرّفات الدخول
    phone               VARCHAR(20) UNIQUE,
    email               VARCHAR(255) UNIQUE,
    oauth_google        VARCHAR(255) UNIQUE,
    oauth_facebook      VARCHAR(255) UNIQUE,
    oauth_apple         VARCHAR(255) UNIQUE,
    pin_code            VARCHAR(6),                          -- PIN للقفل السريع (hashed)

    -- الملف الشخصي
    username            VARCHAR(50)  NOT NULL,
    display_name        VARCHAR(80),
    avatar_url          TEXT,
    bio                 TEXT,
    frame_url           TEXT,                                -- إطار الصورة (ميزة VIP مستقبلاً)
    background_url      TEXT,

    -- الصلاحيات والحالة
    role                user_role    NOT NULL DEFAULT 'user',
    status              user_status  NOT NULL DEFAULT 'active',
    banned_reason       TEXT,
    banned_until        TIMESTAMPTZ,

    -- المحفظة
    balance_gold        BIGINT       NOT NULL DEFAULT 0,
    balance_diamond     BIGINT       NOT NULL DEFAULT 0,
    -- إجمالي تراكمي للإحصائيات (للتصنيفات)
    total_deposited     NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_withdrawn     NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_wagered       BIGINT       NOT NULL DEFAULT 0,
    total_won           BIGINT       NOT NULL DEFAULT 0,
    total_gifts_sent    BIGINT       NOT NULL DEFAULT 0,
    total_gifts_received BIGINT      NOT NULL DEFAULT 0,

    -- الإحالات
    referred_by_agent_id UUID REFERENCES agents(id),
    referred_by_user_id  UUID REFERENCES users(id),
    referral_code      VARCHAR(20) UNIQUE,                   -- كود إحالة المستخدم الخاص

    -- التحكم بالألعاب (admin-controlled)
    rtp_override        NUMERIC(5,2),                          -- NULL = افتراضي
    is_force_win        BOOLEAN NOT NULL DEFAULT FALSE,
    is_force_lose       BOOLEAN NOT NULL DEFAULT FALSE,
    force_outcome_count SMALLINT NOT NULL DEFAULT 1,           -- عدد الجولات القادمة للقاعدة
    bet_limit_override  JSONB,                                 -- {min, max}

    -- الإعدادات
    daily_bonus_claimed_at TIMESTAMPTZ,
    preferred_language VARCHAR(10) DEFAULT 'ar',
    platform            platform_type,
    app_version         VARCHAR(20),
    fcm_token           TEXT,
    last_login_at       TIMESTAMPTZ,
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 50),
    CONSTRAINT balance_non_negative CHECK (balance_gold >= 0 AND balance_diamond >= 0),
    CONSTRAINT not_both_force CHECK (NOT (is_force_win AND is_force_lose))
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_balance_gold ON users(balance_gold DESC);
CREATE INDEX IF NOT EXISTS idx_users_agent ON users(referred_by_agent_id) WHERE referred_by_agent_id IS NOT NULL;

-- ============================================================================
-- 3) جدول الوكلاء (agents) — يُنشؤهم الأدمن فقط
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    created_by_admin_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- رصيد الوكيل (بالدولار، يُشحن من الأدمن)
    wallet_usd               NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit_limit_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- نسبة العمولة
    commission_rate          NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    -- عمولات الإحالات متعددة المستويات (JSONB قابل للتعديل لكل وكيل)
    referral_commission_tiers JSONB NOT NULL DEFAULT
        '[{"tier":1,"rate":10.00},{"tier":2,"rate":5.00},{"tier":3,"rate":2.00}]'::jsonb,

    -- صلاحيات الوكيل
    can_create_users         BOOLEAN NOT NULL DEFAULT TRUE,
    can_approve_deposits     BOOLEAN NOT NULL DEFAULT TRUE,
    can_approve_withdrawals  BOOLEAN NOT NULL DEFAULT TRUE,
    can_set_user_rtp         BOOLEAN NOT NULL DEFAULT FALSE,
    can_force_outcome        BOOLEAN NOT NULL DEFAULT FALSE,
    can_suspend_users        BOOLEAN NOT NULL DEFAULT FALSE,
    max_users                INTEGER NOT NULL DEFAULT 500,
    daily_deposit_limit_usd  NUMERIC(14,2) NOT NULL DEFAULT 10000,

    -- أسعار الصرف الخاصة بالوكيل
    exchange_rate_usd_to_gold NUMERIC(10,2) NOT NULL DEFAULT 1000.00,  -- 1$ = 1000 ذهب
    exchange_rate_gold_to_usd NUMERIC(10,6) NOT NULL DEFAULT 0.000900,  -- مع رسوم ضمنية

    -- إحصائيات تراكمية
    total_users              INTEGER NOT NULL DEFAULT 0,
    total_deposit_usd        NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_withdrawal_usd     NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_commission_usd     NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_credit_received_usd NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- الحالة
    status                   user_status NOT NULL DEFAULT 'active',
    notes                    TEXT,                                     -- ملاحظات داخلية من الأدمن
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT commission_range CHECK (commission_rate BETWEEN 0 AND 100),
    CONSTRAINT wallet_non_negative CHECK (wallet_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- ============================================================================
-- 4) الإحالات بين المستخدمين (Referrals Tree - متعدد المستويات)
-- ============================================================================
CREATE TABLE IF NOT EXISTS referrals (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL,
    tier              SMALLINT NOT NULL DEFAULT 1,
    total_earnings    NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_tier CHECK (tier BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_agent ON referrals(agent_id);

-- ============================================================================
-- 5) المحفظة — معاملات (Ledger بأسلوب القيد المزدوج)
-- ============================================================================
-- كل عملية = سطر واحد فقط (entry)، الرصيد يُحسب بالتراكم
-- للأمان المالي: الجدول append-only، لا UPDATE ولا DELETE
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id            UUID REFERENCES agents(id) ON DELETE SET NULL,
    type                wallet_tx_type NOT NULL,
    amount              BIGINT NOT NULL,                       -- موجب = إضافة، سالب = خصم
    balance_before      BIGINT NOT NULL,
    balance_after       BIGINT NOT NULL,
    currency            VARCHAR(10) NOT NULL DEFAULT 'gold',   -- gold/diamond
    idempotency_key     VARCHAR(100) UNIQUE,                   -- لمنع الازدواج
    reference_type      VARCHAR(50),                           -- game_round/gift/deposit/withdrawal/transfer
    reference_id        UUID,
    metadata            JSONB DEFAULT '{}'::jsonb,
    -- التدقيق
    created_by_function VARCHAR(50),                           -- اسم Edge Function التي أنشأت المعاملة
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_amount CHECK (amount <> 0),
    CONSTRAINT valid_balance_check CHECK (balance_after = balance_before + amount AND balance_after >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_time ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type_time ON wallet_transactions(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_agent ON wallet_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions(idempotency_key);

-- منع تعديل/حذف صفوف المحفظة (append-only)
CREATE OR REPLACE FUNCTION prevent_wallet_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'wallet_transactions is append-only: modification/deletion forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_no_update ON wallet_transactions;
CREATE TRIGGER trg_wallet_no_update
    BEFORE UPDATE ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_wallet_modification();

DROP TRIGGER IF EXISTS trg_wallet_no_delete ON wallet_transactions;
CREATE TRIGGER trg_wallet_no_delete
    BEFORE DELETE ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_wallet_modification();

-- ============================================================================
-- 6) الشحن (Deposits) — يديوي بالكامل
-- ============================================================================
-- التدفق:
--   1) المستخدم يطلب شحن → status=pending
--   2) المستخدم يحوّل خارجيًا (USDT/شام كاش/سيرياتيل كاش)
--   3) المستخدم يرفع: رقم العملية + صورة الإثبات
--   4) الأدمن/الوكيل يراجع → status=approved
--   5) ينفّذ Edge Function: يضيف الرصيد + يسجّل في wallet_transactions
--   6) status=completed
CREATE TABLE IF NOT EXISTS deposits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,

    method          deposit_method NOT NULL,
    amount_usd      NUMERIC(14,2) NOT NULL,
    amount_gold     BIGINT NOT NULL,
    fee_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- بيانات الإثبات (يدوي)
    external_ref    VARCHAR(200) NOT NULL,                     -- رقم العملية / مرجع الحوالة
    proof_url       TEXT NOT NULL,                             -- صورة إثبات التحويل (Storage URL)
    sender_phone    VARCHAR(20),                               -- هاتف المرسل (للشام/سيرياتيل كاش)
    sender_name     VARCHAR(100),

    -- بيانات USDT خاصة
    usdt_network    VARCHAR(20),                               -- TRC20/ERC20/BEP20
    usdt_tx_hash    VARCHAR(200),
    usdt_from_address VARCHAR(200),

    -- معالجة الطلب
    status          tx_status NOT NULL DEFAULT 'pending',
    assigned_to     UUID REFERENCES users(id),                 -- الأدمن/الوكيل المسؤول
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    rejected_reason TEXT,
    admin_notes     TEXT,

    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT deposit_amount_positive CHECK (amount_usd > 0 AND amount_gold > 0),
    CONSTRAINT deposit_has_proof CHECK (external_ref IS NOT NULL AND proof_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_deposits_user_time ON deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_agent ON deposits(agent_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_method ON deposits(method);
CREATE INDEX IF NOT EXISTS idx_deposits_assigned ON deposits(assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================================
-- 7) السحب (Withdrawals) — يدوي بالكامل (عن طريق الوكيل/الأدمن)
-- ============================================================================
-- التدفق:
--   1) المستخدم يطلب سحب → status=pending
--   2) النظام يخصم ذهب مؤقتًا (held_gold) - أو يبقى حتى الموافقة
--   3) الوكيل/الأدمن يراجع → status=approved
--   4) الوكيل يحول للمستخدم خارجيًا (USDT/شام كاش/سيرياتيل كاش)
--   5) الوكيل يرفع: رقم العملية + صورة الإثبات
--   6) يضغط "تم الدفع" → status=completed
CREATE TABLE IF NOT EXISTS withdrawals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id        UUID REFERENCES agents(id),

    -- المبالغ
    amount_gold     BIGINT NOT NULL,
    amount_usd      NUMERIC(14,2) NOT NULL,
    fee_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_usd         NUMERIC(14,2) GENERATED ALWAYS AS (amount_usd - fee_usd) STORED,

    method          deposit_method NOT NULL DEFAULT 'agent',

    -- بيانات التسليم
    usdt_address    VARCHAR(200),
    usdt_network    VARCHAR(20),
    sham_cash_phone VARCHAR(20),
    syriatel_phone  VARCHAR(20),

    -- إثبات الدفع (يرفعه الوكيل بعد التحويل)
    external_ref    VARCHAR(200),                              -- رقم العملية الخارجية
    proof_url       TEXT,                                      -- صورة إثبات التحويل
    paid_at         TIMESTAMPTZ,

    -- المعالجة
    status          tx_status NOT NULL DEFAULT 'pending',
    assigned_to     UUID REFERENCES users(id),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    admin_notes     TEXT,

    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT withdrawal_amount_positive CHECK (amount_gold > 0 AND amount_usd > 0)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_time ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_agent ON withdrawals(agent_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_assigned ON withdrawals(assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================================
-- 8) التحويلات بين المستخدمين (P2P Transfers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_gold     BIGINT NOT NULL,
    fee_gold        BIGINT NOT NULL DEFAULT 0,                 -- رسوم يأخذها النظام
    net_gold        BIGINT GENERATED ALWAYS AS (amount_gold - fee_gold) STORED,
    note            TEXT,
    status          tx_status NOT NULL DEFAULT 'completed',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT transfer_amount_positive CHECK (amount_gold > 0),
    CONSTRAINT transfer_not_self CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_from_time ON transfers(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to_time ON transfers(to_user_id, created_at DESC);

-- ============================================================================
-- 9) الغرف الصوتية (Voice Rooms)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rooms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    cover_url       TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    seat_count      SMALLINT NOT NULL DEFAULT 8,                -- 4 أو 8 (16 مستقبلاً)
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    password        VARCHAR(50),
    -- معرّف LiveKit
    livekit_room_id VARCHAR(100) UNIQUE NOT NULL,
    livekit_token   TEXT,
    status          room_status NOT NULL DEFAULT 'waiting',
    listeners_count INTEGER NOT NULL DEFAULT 0,
    speakers_count  INTEGER NOT NULL DEFAULT 0,
    category        VARCHAR(50),
    tags            TEXT[],
    -- حماية
    is_recorded     BOOLEAN NOT NULL DEFAULT FALSE,             -- ميزة مدفوعة مستقبلاً
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_seat_count CHECK (seat_count IN (4, 8, 16))
);

CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_category ON rooms(category);
CREATE INDEX IF NOT EXISTS idx_rooms_listeners ON rooms(listeners_count DESC);

-- مقاعد الغرفة
CREATE TABLE IF NOT EXISTS room_seats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    seat_index      SMALLINT NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    status          seat_status NOT NULL DEFAULT 'empty',
    is_mic_on       BOOLEAN NOT NULL DEFAULT FALSE,
    is_owner_seat   BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at       TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_seat_index CHECK (seat_index >= 0 AND seat_index < 16),
    UNIQUE (room_id, seat_index)
);

CREATE INDEX IF NOT EXISTS idx_room_seats_room ON room_seats(room_id);
CREATE INDEX IF NOT EXISTS idx_room_seats_user ON room_seats(user_id);

-- رسائل الشات
CREATE TABLE IF NOT EXISTS room_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    gift_id         UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room_time ON room_messages(room_id, created_at DESC);

-- ============================================================================
-- 10) الألعاب — الإعدادات + الجولات + الرهانات
-- ============================================================================

-- إعدادات كل لعبة (يحررها الأدمن)
CREATE TABLE IF NOT EXISTS game_configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type       game_type NOT NULL UNIQUE,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    default_rtp     NUMERIC(5,2) NOT NULL DEFAULT 30.00,
    min_bet_gold    BIGINT NOT NULL DEFAULT 100,
    max_bet_gold    BIGINT NOT NULL DEFAULT 1000000,
    max_multiplier  NUMERIC(10,2) NOT NULL DEFAULT 100.00,
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES users(id),

    CONSTRAINT valid_rtp CHECK (default_rtp BETWEEN 0 AND 100)
);

INSERT INTO game_configs (game_type, default_rtp, min_bet_gold, max_bet_gold, max_multiplier, settings)
VALUES
    ('wheel',   30.00, 100, 1000000, 50.00,
        '{"segments":[
            {"value":0,"probability":0.55,"color":"black","label":"خسارة"},
            {"value":2,"probability":0.20,"color":"red","label":"x2"},
            {"value":5,"probability":0.15,"color":"blue","label":"x5"},
            {"value":10,"probability":0.07,"color":"green","label":"x10"},
            {"value":20,"probability":0.025,"color":"purple","label":"x20"},
            {"value":50,"probability":0.005,"color":"gold","label":"x50"}
        ]}'::jsonb),
    ('dice',    30.00, 100, 1000000, 10.00,
        '{"min_value":1,"max_value":100,"default_target":50}'::jsonb),
    ('aviator', 25.00, 100, 1000000, 100.00,
        '{"crash_curve":"exponential","seed_rotation":"per_round","min_crash":1.00,"instant_crash_probability":0.03}'::jsonb),
    ('plinko',  28.00, 100, 1000000, 1000.00,
        '{"rows":12,"risk_levels":["low","medium","high"],"multipliers":{"low":[5,3,2,1.5,1,0.5,1,1.5,2,3,5],"medium":[10,5,3,1.5,1,0.3,1,1.5,3,5,10],"high":[100,20,5,1.5,0.5,0.2,0.5,1.5,5,20,100]}}'::jsonb)
ON CONFLICT (game_type) DO NOTHING;

-- الجولات (Round)
CREATE TABLE IF NOT EXISTS game_rounds (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type       game_type NOT NULL,
    room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
    seed            VARCHAR(100) NOT NULL,
    result          JSONB NOT NULL,
    crash_point     NUMERIC(10,2),
    total_bets      INTEGER NOT NULL DEFAULT 0,
    total_bet_gold  BIGINT NOT NULL DEFAULT 0,
    total_payout    BIGINT NOT NULL DEFAULT 0,
    rtp_applied     NUMERIC(5,2) NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_type_time ON game_rounds(game_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rounds_room ON game_rounds(room_id);

-- الرهانات (Bets)
CREATE TABLE IF NOT EXISTS game_bets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id        UUID NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    game_type       game_type NOT NULL,
    bet_amount      BIGINT NOT NULL,
    bet_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    payout          BIGINT NOT NULL DEFAULT 0,
    multiplier      NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_win          BOOLEAN NOT NULL DEFAULT FALSE,
    forced_outcome  VARCHAR(20),
    settled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_bet_amount CHECK (bet_amount > 0 AND payout >= 0)
);

CREATE INDEX IF NOT EXISTS idx_game_bets_round ON game_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_game_bets_user_time ON game_bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_bets_game_time ON game_bets(game_type, created_at DESC);

-- ============================================================================
-- 11) الهدايا (Gifts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gifts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(50) NOT NULL,
    name_ar         VARCHAR(50),
    icon_url        TEXT NOT NULL,
    icon_emoji      VARCHAR(8) NOT NULL DEFAULT '🎁',
    animation_url   TEXT,
    price_gold      BIGINT NOT NULL,
    recipient_diamond_ratio NUMERIC(5,2) NOT NULL DEFAULT 50.00,
    is_premium      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    category        VARCHAR(30) DEFAULT 'common',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gifts_active ON gifts(is_active, sort_order);

INSERT INTO gifts (name, name_ar, icon_url, icon_emoji, price_gold, category, sort_order) VALUES
    ('Rose',        'وردة',         '/gifts/rose.json',      '🌹', 100,     'common',    1),
    ('Heart',       'قلب',          '/gifts/heart.json',     '❤️',  500,     'common',    2),
    ('Ice Cream',   'آيس كريم',     '/gifts/icecream.json',  '🍦', 1000,    'common',    3),
    ('Crown',       'تاج',          '/gifts/crown.json',     '👑', 5000,    'rare',      4),
    ('Ring',        'خاتم',         '/gifts/ring.json',      '💍', 10000,   'rare',      5),
    ('Sports Car',  'سيارة رياضية', '/gifts/car.json',       '🏎️',  50000,   'epic',      6),
    ('Yacht',       'يخت',          '/gifts/yacht.json',     '🛥️',  100000,  'epic',      7),
    ('Castle',      'قلعة',         '/gifts/castle.json',    '🏰', 500000,  'legendary', 8),
    ('Universe',    'كون',          '/gifts/universe.json',  '🌌', 1000000, 'legendary', 9)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS gift_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gift_id         UUID NOT NULL REFERENCES gifts(id),
    from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    total_gold      BIGINT NOT NULL,
    received_diamond BIGINT NOT NULL,
    message         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_gift_tx_from_time ON gift_transactions(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_tx_to_time ON gift_transactions(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_tx_room ON gift_transactions(room_id);

-- ============================================================================
-- 12) إعدادات النظام العامة (Admin Settings) — مفاتيح JSONB
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,             -- public = يُرسل للعميل
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES users(id)
);

INSERT INTO admin_settings (key, value, description, is_public) VALUES
    ('global_rtp_default',           '30'::jsonb,                'RTP الافتراضي لكل المستخدمين (%)', false),
    ('transfers_enabled',            'true'::jsonb,              'تفعيل التحويل بين المستخدمين', true),
    ('transfer_fee_percent',         '5'::jsonb,                 'رسوم التحويل (%)', true),
    ('min_transfer_gold',            '100'::jsonb,               'أقل مبلغ للتحويل', true),
    ('withdrawals_enabled',          'true'::jsonb,              'تفعيل طلبات السحب', true),
    ('withdrawal_fee_percent',       '5'::jsonb,                 'رسوم السحب (%)', true),
    ('min_withdrawal_gold',          '10000'::jsonb,             'أقل مبلغ للسحب', true),
    ('max_withdrawal_usd_per_day',   '500'::jsonb,               'أعلى سحب يومي لكل مستخدم ($)', false),
    ('deposits_enabled',             'true'::jsonb,              'تفعيل الشحن', true),
    ('daily_bonus_gold',             '500'::jsonb,               'المكافأة اليومية المجانية', true),
    ('new_user_bonus_gold',          '1000'::jsonb,              'مكافأة التسجيل', true),
    ('referral_bonus_gold',          '500'::jsonb,               'مكافأة الإحالة', true),
    ('default_room_seat_count',      '8'::jsonb,                 'عدد المقاعد الافتراضي', true),
    ('usdt_wallets',                 '{}'::jsonb,                'محافظ USDT للاستلام', true),
    ('usdt_to_gold_rate',            '1000'::jsonb,              '1 USDT = X ذهب', true),
    ('gold_to_usdt_rate',            '0.0009'::jsonb,            '1 ذهب = X USDT', false),
    ('maintenance_mode',             'false'::jsonb,             'وضع الصيانة', true),
    ('min_app_version',              '1.0.0'::jsonb,             'أقل إصدار مسموح', true),
    ('force_update_message',         ''::jsonb,                  'رسالة التحديث الإجباري', true),
    ('signup_bonus_enabled',         'true'::jsonb,              'تفعيل مكافأة التسجيل', false),
    ('max_deposit_usd_per_day',      '2000'::jsonb,              'أعلى شحن يومي لكل مستخدم', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 13) سجل العمليات الإدارية (Audit Log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id        UUID NOT NULL REFERENCES users(id),
    action          audit_action_type NOT NULL,
    target_type     VARCHAR(50),
    target_id       UUID,
    before          JSONB,
    after           JSONB,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_time ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log(action);

-- ============================================================================
-- 14) الجداول المساعدة
-- ============================================================================

-- OTP للتحقق
CREATE TABLE IF NOT EXISTS otp_codes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           VARCHAR(20) NOT NULL,
    code            VARCHAR(10) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_used         BOOLEAN NOT NULL DEFAULT FALSE,
    attempts        SMALLINT NOT NULL DEFAULT 0,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_time ON otp_codes(phone, created_at DESC);

-- طلبات الدعم
CREATE TABLE IF NOT EXISTS support_tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject         VARCHAR(200) NOT NULL,
    description     TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    priority        VARCHAR(10) NOT NULL DEFAULT 'normal',
    assigned_to     UUID REFERENCES users(id),
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

-- التصنيفات
CREATE TABLE IF NOT EXISTS leaderboards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period          VARCHAR(20) NOT NULL,
    category        VARCHAR(30) NOT NULL,
    score           NUMERIC(14,2) NOT NULL DEFAULT 0,
    rank            INTEGER,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period, category, period_start)
);

CREATE INDEX IF NOT EXISTS idx_leaderboards_period ON leaderboards(period, category, rank);
CREATE INDEX IF NOT EXISTS idx_leaderboards_user ON leaderboards(user_id);

-- جلسات المستخدمين (للتحكم بالجلسات النشطة وإلغائها)
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255),
    device_info     JSONB DEFAULT '{}'::jsonb,
    ip_address      INET,
    user_agent      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(user_id) WHERE is_active = TRUE;

-- ============================================================================
-- 15) الدوال (Functions)
-- ============================================================================

-- محدّث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at' AND table_schema = 'public'
    LOOP
        EXECUTE format($$
            DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;
            CREATE TRIGGER trg_set_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        $$, t, t);
    END LOOP;
END $$;

-- دالة لتسجيل معاملة محفظة (atomic + idempotent)
-- IMPORTANT: كل Edge Functions المالية MUST تنادي هذه الدالة فقط
CREATE OR REPLACE FUNCTION record_wallet_transaction(
    p_user_id         UUID,
    p_type            wallet_tx_type,
    p_amount          BIGINT,
    p_currency        VARCHAR(10) DEFAULT 'gold',
    p_agent_id        UUID DEFAULT NULL,
    p_idempotency_key VARCHAR(100) DEFAULT NULL,
    p_reference_type  VARCHAR(50) DEFAULT NULL,
    p_reference_id    UUID DEFAULT NULL,
    p_metadata        JSONB DEFAULT '{}'::jsonb,
    p_function_name   VARCHAR(50) DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    tx_id        UUID;
    bal_before   BIGINT;
    bal_after    BIGINT;
    cur_balance  BIGINT;
BEGIN
    -- منع الازدواجية
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO tx_id FROM wallet_transactions
        WHERE idempotency_key = p_idempotency_key;
        IF tx_id IS NOT NULL THEN RETURN tx_id; END IF;
    END IF;

    -- قفل صف المستخدم + منع الرصيد السالب
    IF p_currency = 'gold' THEN
        SELECT balance_gold INTO cur_balance FROM users WHERE id = p_user_id FOR UPDATE;
        bal_before := cur_balance;
        bal_after  := cur_balance + p_amount;
        IF bal_after < 0 THEN
            RAISE EXCEPTION 'Insufficient gold balance: have=%, need=%', cur_balance, -p_amount;
        END IF;
        UPDATE users SET balance_gold = bal_after WHERE id = p_user_id;
    ELSIF p_currency = 'diamond' THEN
        SELECT balance_diamond INTO cur_balance FROM users WHERE id = p_user_id FOR UPDATE;
        bal_before := cur_balance;
        bal_after  := cur_balance + p_amount;
        IF bal_after < 0 THEN
            RAISE EXCEPTION 'Insufficient diamond balance: have=%, need=%', cur_balance, -p_amount;
        END IF;
        UPDATE users SET balance_diamond = bal_after WHERE id = p_user_id;
    ELSE
        RAISE EXCEPTION 'Unknown currency: %', p_currency;
    END IF;

    INSERT INTO wallet_transactions
        (user_id, agent_id, type, amount, balance_before, balance_after,
         currency, idempotency_key, reference_type, reference_id,
         metadata, created_by_function)
    VALUES
        (p_user_id, p_agent_id, p_type, p_amount, bal_before, bal_after,
         p_currency, p_idempotency_key, p_reference_type, p_reference_id,
         p_metadata, p_function_name)
    RETURNING id INTO tx_id;

    RETURN tx_id;
END;
$$ LANGUAGE plpgsql;

-- توليد referral_code فريد
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS VARCHAR(20) AS $$
DECLARE
    code VARCHAR(20);
    exists INTEGER;
BEGIN
    LOOP
        code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        SELECT count(*) INTO exists FROM users WHERE referral_code = code;
        EXIT WHEN exists = 0;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_referral_code ON users;
CREATE TRIGGER trg_set_referral_code
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION set_referral_code();

-- دالة للحصول على إجمالي شحن/سحب اليوم للمستخدم (للحدود اليومية)
CREATE OR REPLACE FUNCTION get_user_daily_totals(p_user_id UUID)
RETURNS TABLE (deposits_usd NUMERIC, withdrawals_usd NUMERIC) AS $$
    SELECT
        COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount_usd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type = 'withdraw' THEN amount_usd ELSE 0 END), 0)
    FROM (
        SELECT 'deposit'::text AS type, amount_usd, created_at FROM deposits
        WHERE user_id = p_user_id AND status = 'completed' AND created_at::date = now()::date
        UNION ALL
        SELECT 'withdraw'::text AS type, amount_usd, created_at FROM withdrawals
        WHERE user_id = p_user_id AND status = 'completed' AND created_at::date = now()::date
    ) t;
$$ LANGUAGE sql STABLE;

-- دالة لزيادة حقل إحصائي للمستخدم (total_wagered, total_won, ...)
CREATE OR REPLACE FUNCTION increment_user_stat(
    p_user_id UUID,
    p_field   VARCHAR(50),
    p_amount  BIGINT
) RETURNS VOID AS $$
BEGIN
    IF p_field = 'total_wagered' THEN
        UPDATE users SET total_wagered = total_wagered + p_amount WHERE id = p_user_id;
    ELSIF p_field = 'total_won' THEN
        UPDATE users SET total_won = total_won + p_amount WHERE id = p_user_id;
    ELSIF p_field = 'total_gifts_sent' THEN
        UPDATE users SET total_gifts_sent = total_gifts_sent + p_amount WHERE id = p_user_id;
    ELSIF p_field = 'total_gifts_received' THEN
        UPDATE users SET total_gifts_received = total_gifts_received + p_amount WHERE id = p_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- دالة لتحديث إحصائيات الشحن للمستخدم
CREATE OR REPLACE FUNCTION update_user_deposit_stats(
    p_user_id   UUID,
    p_amount_usd NUMERIC
) RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET total_deposited = total_deposited + p_amount_usd
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 16) Row Level Security (RLS)
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- المستخدم: بياناته فقط
CREATE POLICY users_self_select ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY users_self_update ON users FOR UPDATE USING (auth.uid() = id);

-- المحفظة: SELECT فقط (INSERT/UPDATE فقط من service_role عبر Edge Functions)
CREATE POLICY wallet_self_select ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY deposits_self_select ON deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY deposits_self_insert ON deposits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY deposits_self_update ON deposits FOR UPDATE USING (auth.uid() = user_id AND status IN ('pending', 'cancelled'));

CREATE POLICY withdrawals_self_select ON withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY withdrawals_self_insert ON withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY withdrawals_self_cancel ON withdrawals FOR UPDATE USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY transfers_self_select ON transfers
    FOR SELECT USING (auth.uid() = user_id OR auth.uid() = to_user_id);

-- الغرف: عام للقراءة، المالك للتعديل
CREATE POLICY rooms_public_select ON rooms
    FOR SELECT USING (status <> 'closed' OR auth.uid() = owner_id);
CREATE POLICY rooms_owner_update ON rooms FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY rooms_owner_delete ON rooms FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY room_seats_room_select ON room_seats FOR SELECT USING (true);
CREATE POLICY room_messages_room_select ON room_messages FOR SELECT USING (true);

CREATE POLICY game_bets_self_select ON game_bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY game_rounds_public_select ON game_rounds FOR SELECT USING (true);

CREATE POLICY gift_tx_self_select ON gift_transactions
    FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY gifts_public_select ON gifts FOR SELECT USING (is_active = true);
CREATE POLICY game_configs_public_select ON game_configs FOR SELECT USING (true);
CREATE POLICY admin_settings_public_select ON admin_settings FOR SELECT USING (is_public = true);
CREATE POLICY leaderboards_public_select ON leaderboards FOR SELECT USING (true);

-- ============================================================================
-- 17) الفهارس الإضافية للأداء
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_bets_user_game ON game_bets(user_id, game_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at DESC) WHERE last_seen_at IS NOT NULL;

-- ============================================================================
-- ملاحظات تنفيذية:
-- ============================================================================
-- 1. ينفّذ هذا الملف في محرر SQL في Supabase Dashboard أو supabase db push
-- 2. أنشئ مستخدم Auth (Email/Password) للأدمن الأول، ثم:
--    UPDATE users SET role = 'super_admin' WHERE id = <uuid>;
-- 3. كل العمليات المالية MUST تتم عبر Edge Functions التي تنادي record_wallet_transaction
-- 4. الشحن اليدوي: deposits.status = pending → approved → completed
--    - بعد approved، Edge Function تنفّذ: record_wallet_transaction(type='deposit', amount=+gold)
--    - و record_wallet_transaction(type='agent_credit', amount=+commission_usd) للوكيل
-- 5. السحب اليدوي: withdrawals.status = pending → approved → completed
--    - عند الطلب، تُخصم الكمية من رصيد المستخدم فورًا (held)
--    - إذا رُفض الطلب، تُعاد الكمية للمستخدم
-- 6. كل تعديل إداري يُسجّل في admin_audit_log (before/after)
-- ============================================================================
