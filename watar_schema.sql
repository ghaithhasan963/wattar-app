-- ============================================================================
-- وَتَر (Watar) — قاعدة بيانات Supabase الكاملة
-- تطبيق صوتي اجتماعي + ألعاب مراهنة + محفظة داخلية + نظام وكلاء
-- Version: 1.0.0  ·  Target: Supabase (PostgreSQL 15+)
-- ============================================================================

-- ============================================================================
-- 0) الإعدادات الأساسية + الإضافات
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";      -- لتخزين موقع المستخدمين (اختياري لاحقًا)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- بحث نصي سريع

-- إعداد إعدادات جلسة العمل الافتراضية
SET timezone TO 'Asia/Damascus';

-- ============================================================================
-- 1) الأدوار المخصصة (Custom Types)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('guest', 'user', 'agent', 'admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'blacklisted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE wallet_tx_type AS ENUM (
        'deposit',           -- شحن (USDT/شام كاش/سيرياتيل كاش/وكيل)
        'withdraw',          -- سحب (عن طريق الوكيل)
        'transfer_out',      -- تحويل صادر لمستخدم آخر
        'transfer_in',       -- تحويل وارد من مستخدم آخر
        'bet',               -- رهان في لعبة
        'win',               -- ربح في لعبة
        'gift_sent',         -- إرسال هدية
        'gift_received',     -- استقبال هدية
        'agent_credit',      -- شحن رصيد وكيل من الأدمن
        'agent_debit',       -- خصم من رصيد وكيل
        'admin_adjustment',  -- تعديل يدوي من الأدمن
        'referral_bonus',    -- مكافأة إحالة
        'daily_bonus'        -- مكافأة يومية مجانية
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE deposit_method AS ENUM ('usdt', 'sham_cash', 'syriatel_cash', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE tx_status AS ENUM ('pending', 'completed', 'failed', 'cancelled', 'rejected');
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
    CREATE TYPE platform AS ENUM ('android', 'ios', 'web');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2) جدول المستخدمين الأساسي
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           VARCHAR(20) UNIQUE,
    email           VARCHAR(255) UNIQUE,
    oauth_google    VARCHAR(255) UNIQUE,
    oauth_facebook  VARCHAR(255) UNIQUE,
    oauth_apple     VARCHAR(255) UNIQUE,

    username        VARCHAR(50)  NOT NULL,
    display_name    VARCHAR(80),
    avatar_url      TEXT,
    bio             TEXT,

    role            user_role    NOT NULL DEFAULT 'user',
    status          user_status  NOT NULL DEFAULT 'active',

    -- المحفظة
    balance_gold    BIGINT       NOT NULL DEFAULT 0,        -- عملة اللعب الأساسية
    balance_diamond BIGINT       NOT NULL DEFAULT 0,        -- عملة المكافآت/الهدايا

    -- الإحالات
    referred_by_agent_id UUID REFERENCES agents(id),
    referral_code   VARCHAR(20) UNIQUE,                     -- كود إحالة المستخدم الخاص
    referred_by_user_id  UUID REFERENCES users(id),

    -- التحكم بالألعاب (admin-controlled)
    rtp_override    NUMERIC(5,2),                            -- RTP مخصص للمستخدم (NULL = افتراضي)
    is_force_win    BOOLEAN NOT NULL DEFAULT FALSE,          -- إجبار فوز في الجولة القادمة
    is_force_lose   BOOLEAN NOT NULL DEFAULT FALSE,          -- إجبار خسارة في الجولة القادمة
    bet_limit_override JSONB,                                -- حدود رهان مخصصة (min/max)

    -- إعدادات
    daily_bonus_claimed_at TIMESTAMPTZ,
    preferred_language VARCHAR(10) DEFAULT 'ar',
    platform        platform,
    fcm_token       TEXT,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 50),
    CONSTRAINT balance_non_negative CHECK (balance_gold >= 0 AND balance_diamond >= 0)
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================================
-- 3) جدول الوكلاء (يُنشؤهم الأدمن فقط)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    created_by_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- رصيد الوكيل (بالدولار، يُشحن من الأدمن)
    wallet_usd          NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- سقف ائتمان يحدده الأدمن
    credit_limit_usd   NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- نسبة العمولة
    commission_rate     NUMERIC(5,2) NOT NULL DEFAULT 10.00,  -- نسبة افتراضية 10%
    -- عمولة الإحالات متعددة المستويات
    referral_commission_tiers JSONB NOT NULL DEFAULT
        '[{"tier":1,"rate":10.00},{"tier":2,"rate":5.00},{"tier":3,"rate":2.00}]'::jsonb,

    -- صلاحيات
    can_create_users        BOOLEAN NOT NULL DEFAULT TRUE,
    can_approve_withdrawals BOOLEAN NOT NULL DEFAULT TRUE,
    can_set_user_rtp        BOOLEAN NOT NULL DEFAULT FALSE,
    max_users               INTEGER NOT NULL DEFAULT 500,

    -- إعدادات الشحن/السحب للعملة الداخلية
    exchange_rate_usd_to_gold NUMERIC(10,2) NOT NULL DEFAULT 1000.00,  -- 1$ = 1000 ذهب
    exchange_rate_gold_to_usd NUMERIC(10,4) NOT NULL DEFAULT 0.0009,  -- عمولة سحب ضمنية

    -- إحصائيات
    total_users           INTEGER NOT NULL DEFAULT 0,
    total_deposit_usd     NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_commission_usd  NUMERIC(14,2) NOT NULL DEFAULT 0,

    status                user_status NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT commission_range CHECK (commission_rate BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- ============================================================================
-- 4) الإحالات بين المستخدمين (Referrals Tree)
-- ============================================================================
CREATE TABLE IF NOT EXISTS referrals (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL,
    tier              SMALLINT NOT NULL DEFAULT 1,        -- المستوى (1=مباشر، 2=غير مباشر...)
    total_earnings    NUMERIC(14,2) NOT NULL DEFAULT 0,
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
    amount              BIGINT NOT NULL,                  -- موجب = إضافة، سالب = خصم
    balance_before      BIGINT NOT NULL,
    balance_after       BIGINT NOT NULL,
    currency            VARCHAR(10) NOT NULL DEFAULT 'gold',  -- gold/diamond/usd
    idempotency_key     VARCHAR(100) UNIQUE,              -- لمنع الازدواج
    reference_type      VARCHAR(50),                      -- game_round/gift/deposit/etc
    reference_id        UUID,
    metadata            JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_amount CHECK (amount <> 0),
    CONSTRAINT valid_balance CHECK (balance_after = balance_before + amount AND balance_after >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_agent ON wallet_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions(idempotency_key);

-- منع تعديل/حذف صفوف المحفظة (append-only)
CREATE OR REPLACE FUNCTION prevent_wallet_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'wallet_transactions is append-only: modification/deletion is forbidden';
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
-- 6) الشحن (Deposits) — طلبات شحن المستخدمين
-- ============================================================================
CREATE TABLE IF NOT EXISTS deposits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
    method          deposit_method NOT NULL,
    amount_usd      NUMERIC(14,2) NOT NULL,
    amount_gold     BIGINT NOT NULL,                       -- المحوّل بناءً على سعر الوكيل أو الافتراضي
    fee_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,
    status          tx_status NOT NULL DEFAULT 'pending',
    -- لطرق الـUSDT/الشام كاش: رقم العملية/الحوالة
    external_ref    VARCHAR(200),
    proof_url       TEXT,                                  -- صورة إثبات التحويل
    -- بيانات USDT
    usdt_network    VARCHAR(20),                           -- TRC20/ERC20/BEP20
    usdt_tx_hash    VARCHAR(200),
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT deposit_amount_positive CHECK (amount_usd > 0 AND amount_gold > 0)
);

CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_agent ON deposits(agent_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_method ON deposits(method);

-- ============================================================================
-- 7) السحب (Withdrawals) — عن طريق الوكيل فقط
-- ============================================================================
CREATE TABLE IF NOT EXISTS withdrawals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id        UUID REFERENCES agents(id),            -- يُحدد عند الموافقة
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
    -- الحالة
    status          tx_status NOT NULL DEFAULT 'pending',
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    rejected_reason TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT withdrawal_amount_positive CHECK (amount_gold > 0 AND amount_usd > 0)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_agent ON withdrawals(agent_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- ============================================================================
-- 8) التحويلات بين المستخدمين (P2P Transfers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_gold     BIGINT NOT NULL,
    fee_gold        BIGINT NOT NULL DEFAULT 0,             -- رسوم تحويل يأخذها النظام
    note            TEXT,
    status          tx_status NOT NULL DEFAULT 'completed',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT transfer_amount_positive CHECK (amount_gold > 0),
    CONSTRAINT transfer_not_self CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_user_id, created_at DESC);

-- ============================================================================
-- 9) الغرف الصوتية (Voice Rooms)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rooms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    cover_url       TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- عدد المقاعد (4 أو 8، قابل للترقية لـ 16)
    seat_count      SMALLINT NOT NULL DEFAULT 8,
    -- إعدادات الغرفة
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    password        VARCHAR(50),                           -- للغرف الخاصة
    -- معرّفات LiveKit
    livekit_room_id VARCHAR(100) UNIQUE NOT NULL,
    livekit_token   TEXT,
    -- الحالة
    status          room_status NOT NULL DEFAULT 'waiting',
    listeners_count INTEGER NOT NULL DEFAULT 0,
    speakers_count  INTEGER NOT NULL DEFAULT 0,
    -- التصنيف
    category        VARCHAR(50),
    tags            TEXT[],
    -- تاريخ
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
    seat_index      SMALLINT NOT NULL,                     -- 0..(seat_count-1)
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

-- رسائل الشات في الغرفة
CREATE TABLE IF NOT EXISTS room_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    gift_id         UUID,                                  -- إذا كانت رسالة مرتبطة بهدية
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, created_at DESC);

-- ============================================================================
-- 10) الألعاب — الإعدادات + الجولات + الرهانات
-- ============================================================================

-- إعدادات كل لعبة (يحررها الأدمن)
CREATE TABLE IF NOT EXISTS game_configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type       game_type NOT NULL UNIQUE,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    -- RTP الافتراضي (نسبة العائد للاعب) — مثال: 30% = المنزل يأخذ 70%
    default_rtp     NUMERIC(5,2) NOT NULL DEFAULT 30.00,
    -- حدود الرهان
    min_bet_gold    BIGINT NOT NULL DEFAULT 100,
    max_bet_gold    BIGINT NOT NULL DEFAULT 1000000,
    -- الحد الأقصى للمضاعف (مهم لـ Aviator/Plinko)
    max_multiplier  NUMERIC(10,2) NOT NULL DEFAULT 100.00,
    -- إعدادات خاصة بكل لعبة (مثلاً: احتمالات عجلة الحظ، مستويات Plinko)
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES users(id),

    CONSTRAINT valid_rtp CHECK (default_rtp BETWEEN 0 AND 100)
);

-- إدراج الإعدادات الافتراضية للألعاب الأربعة
INSERT INTO game_configs (game_type, default_rtp, min_bet_gold, max_bet_gold, max_multiplier, settings)
VALUES
    ('wheel',   30.00, 100, 1000000, 50.00,
        '{"segments":[
            {"value":0,"probability":0.55,"color":"black"},
            {"value":2,"probability":0.20,"color":"red"},
            {"value":5,"probability":0.15,"color":"blue"},
            {"value":10,"probability":0.07,"color":"green"},
            {"value":20,"probability":0.025,"color":"purple"},
            {"value":50,"probability":0.005,"color":"gold"}
        ]}'::jsonb),
    ('dice',    30.00, 100, 1000000, 10.00,
        '{"min_value":1,"max_value":100}'::jsonb),
    ('aviator', 25.00, 100, 1000000, 100.00,
        '{"crash_curve":"exponential","seed_rotation":"per_round"}'::jsonb),
    ('plinko',  28.00, 100, 1000000, 1000.00,
        '{"rows":12,"risk_levels":["low","medium","high"]}'::jsonb)
ON CONFLICT (game_type) DO NOTHING;

-- الجولات (Round) — صف لكل جولة لعبة
CREATE TABLE IF NOT EXISTS game_rounds (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type       game_type NOT NULL,
    room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,    -- NULL إذا كانت خارج غرفة
    -- بيانات النتيجة
    seed            VARCHAR(100) NOT NULL,                            -- seed عشوائي للتحقق
    result          JSONB NOT NULL,                                   -- النتيجة النهائية
    crash_point     NUMERIC(10,2),                                    -- لـ Aviator
    -- إحصائيات الجولة
    total_bets      INTEGER NOT NULL DEFAULT 0,
    total_bet_gold  BIGINT NOT NULL DEFAULT 0,
    total_payout    BIGINT NOT NULL DEFAULT 0,
    rtp_applied     NUMERIC(5,2) NOT NULL,                            -- RTP المستخدم فعليًا
    -- التوقيت
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_type ON game_rounds(game_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rounds_room ON game_rounds(room_id);

-- الرهانات (Bets)
CREATE TABLE IF NOT EXISTS game_bets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id        UUID NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    game_type       game_type NOT NULL,
    bet_amount      BIGINT NOT NULL,
    -- بيانات الرهان (مثلاً: لـ Aviator متى يسحب، لـ Plinko مستوى المخاطرة، لـ Wheel أي خانة)
    bet_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- النتيجة
    payout          BIGINT NOT NULL DEFAULT 0,
    multiplier      NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_win          BOOLEAN NOT NULL DEFAULT FALSE,
    -- التحكم من الأدمن
    forced_outcome  VARCHAR(20),                                      -- 'win' / 'lose' (إذا تم فرض النتيجة)
    settled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_bet_amount CHECK (bet_amount > 0 AND payout >= 0)
);

CREATE INDEX IF NOT EXISTS idx_game_bets_round ON game_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_game_bets_user ON game_bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_bets_game ON game_bets(game_type, created_at DESC);

-- ============================================================================
-- 11) الهدايا (Gifts) + المعاملات
-- ============================================================================
CREATE TABLE IF NOT EXISTS gifts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(50) NOT NULL,
    name_ar         VARCHAR(50),
    icon_url        TEXT NOT NULL,                                    -- صورة/أنيميشن Lottie
    animation_url   TEXT,
    price_gold      BIGINT NOT NULL,
    -- عملة الاستلام (المالك يستلم بالنسبة المحددة)
    recipient_diamond_ratio NUMERIC(5,2) NOT NULL DEFAULT 50.00,     -- 50% من القيمة جواهر للمستلم
    is_premium      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    category        VARCHAR(30) DEFAULT 'common',                    -- common/rare/epic/legendary
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gifts_active ON gifts(is_active, category);

INSERT INTO gifts (name, name_ar, icon_url, price_gold, category) VALUES
    ('Rose',       'وردة',        '/gifts/rose.json',       100,    'common'),
    ('Heart',      'قلب',         '/gifts/heart.json',      500,    'common'),
    ('Crown',      'تاج',         '/gifts/crown.json',      5000,   'rare'),
    ('Sports Car', 'سيارة رياضية','/gifts/car.json',        50000,  'epic'),
    ('Castle',     'قلعة',        '/gifts/castle.json',     500000, 'legendary')
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

CREATE INDEX IF NOT EXISTS idx_gift_tx_from ON gift_transactions(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_tx_to ON gift_transactions(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_tx_room ON gift_transactions(room_id);

-- ============================================================================
-- 12) إعدادات النظام العامة (Admin Settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES users(id)
);

INSERT INTO admin_settings (key, value, description) VALUES
    ('global_rtp_default',           '30'::jsonb,                'RTP الافتراضي لكل المستخدمين (%)'),
    ('transfers_enabled',            'true'::jsonb,              'تفعيل التحويل بين المستخدمين'),
    ('transfer_fee_percent',         '5'::jsonb,                 'رسوم التحويل (%)'),
    ('min_transfer_gold',            '100'::jsonb,               'أقل مبلغ للتحويل'),
    ('withdrawals_enabled',          'true'::jsonb,              'تفعيل طلبات السحب'),
    ('withdrawal_fee_percent',       '5'::jsonb,                 'رسوم السحب (%)'),
    ('min_withdrawal_gold',          '10000'::jsonb,             'أقل مبلغ للسحب'),
    ('max_withdrawal_usd_per_day',   '500'::jsonb,               'أعلى سحب يومي لكل مستخدم ($)'),
    ('deposits_enabled',             'true'::jsonb,              'تفعيل الشحن'),
    ('daily_bonus_gold',             '500'::jsonb,               'المكافأة اليومية المجانية'),
    ('new_user_bonus_gold',          '1000'::jsonb,              'مكافأة التسجيل'),
    ('referral_bonus_gold',          '500'::jsonb,               'مكافأة الإحالة'),
    ('default_room_seat_count',      '8'::jsonb,                 'عدد المقاعد الافتراضي للغرف'),
    ('usdt_wallets',                 '{}'::jsonb,                'محافظ USDT للاستلام (TRC20/ERC20)'),
    ('usdt_to_gold_rate',            '1000'::jsonb,              '1 USDT = X ذهب (افتراضي عالمي)'),
    ('gold_to_usdt_rate',            '0.0009'::jsonb,            '1 ذهب = X USDT (مع رسوم ضمنية)'),
    ('maintenance_mode',             'false'::jsonb,             'وضع الصيانة'),
    ('min_app_version',              '1.0.0'::jsonb,             'أقل إصدار مسموح')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 13) سجل العمليات الإدارية (Audit Log) — لكل تعديل يقوم به الأدمن
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id        UUID NOT NULL REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,                       -- create_agent/force_win/ban_user/...
    target_type     VARCHAR(50),                                 -- user/agent/room/game_config
    target_id       UUID,
    before          JSONB,
    after           JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log(action);

-- ============================================================================
-- 14) الجداول المساعدة
-- ============================================================================

-- إعدادات OTP/التحقق
CREATE TABLE IF NOT EXISTS otp_codes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           VARCHAR(20) NOT NULL,
    code            VARCHAR(10) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_used         BOOLEAN NOT NULL DEFAULT FALSE,
    attempts        SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at DESC);

-- طلبات دعم
CREATE TABLE IF NOT EXISTS support_tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject         VARCHAR(200) NOT NULL,
    description     TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',         -- open/pending/resolved/closed
    priority        VARCHAR(10) NOT NULL DEFAULT 'normal',
    assigned_to     UUID REFERENCES users(id),
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

-- تصنيفات يومية/أسبوعية (تُحدّث بواسطة cron)
CREATE TABLE IF NOT EXISTS leaderboards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period          VARCHAR(20) NOT NULL,                        -- daily/weekly/monthly
    category        VARCHAR(30) NOT NULL,                        -- wealth/gifts_sent/winnings/referrals
    score           NUMERIC(14,2) NOT NULL DEFAULT 0,
    rank            INTEGER,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period, category, period_start)
);

CREATE INDEX IF NOT EXISTS idx_leaderboards_period ON leaderboards(period, category, rank);
CREATE INDEX IF NOT EXISTS idx_leaderboards_user ON leaderboards(user_id);

-- ============================================================================
-- 15) دوال مساعدة (Functions)
-- ============================================================================

-- دالة محدّثة لـ updated_at تلقائيًا
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق الـtrigger على كل الجداول ذات updated_at
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

-- دالة للحصول على رصيد المستخدم الحالي (آخر صف في wallet_transactions)
CREATE OR REPLACE FUNCTION get_user_balance(p_user_id UUID)
RETURNS TABLE (gold BIGINT, diamond BIGINT) AS $$
    SELECT
        COALESCE(SUM(CASE WHEN currency = 'gold' THEN amount ELSE 0 END), 0) +
        COALESCE((SELECT balance_gold FROM users WHERE id = p_user_id), 0),
        COALESCE(SUM(CASE WHEN currency = 'diamond' THEN amount ELSE 0 END), 0) +
        COALESCE((SELECT balance_diamond FROM users WHERE id = p_user_id), 0)
    FROM wallet_transactions
    WHERE user_id = p_user_id;
$$ LANGUAGE sql STABLE;

-- دالة لتوليد referral_code فريد
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

-- Trigger لتوليد referral_code تلقائيًا عند إنشاء مستخدم جديد
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

-- دالة لتسجيل معاملة محفظة (atomic + idempotent)
CREATE OR REPLACE FUNCTION record_wallet_transaction(
    p_user_id        UUID,
    p_type           wallet_tx_type,
    p_amount         BIGINT,
    p_currency       VARCHAR(10) DEFAULT 'gold',
    p_agent_id       UUID DEFAULT NULL,
    p_idempotency_key VARCHAR(100) DEFAULT NULL,
    p_reference_type VARCHAR(50) DEFAULT NULL,
    p_reference_id   UUID DEFAULT NULL,
    p_metadata       JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    tx_id      UUID;
    bal_before BIGINT;
    bal_after  BIGINT;
    cur_balance BIGINT;
BEGIN
    -- منع الازدواجية
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO tx_id FROM wallet_transactions
        WHERE idempotency_key = p_idempotency_key;
        IF tx_id IS NOT NULL THEN RETURN tx_id; END IF;
    END IF;

    -- قفل صف المستخدم ومنع الرصيد السالب
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
         currency, idempotency_key, reference_type, reference_id, metadata)
    VALUES
        (p_user_id, p_agent_id, p_type, p_amount, bal_before, bal_after,
         p_currency, p_idempotency_key, p_reference_type, p_reference_id, p_metadata)
    RETURNING id INTO tx_id;

    RETURN tx_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 16) Row Level Security (RLS) — حماية كل جدول
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

-- المستخدم العادي: يرى بياناته فقط
CREATE POLICY users_self_select ON users
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY users_self_update ON users
    FOR UPDATE USING (auth.uid() = id);

-- المحفظة: المستخدم يرى معاملاته فقط (لكن لا يضيف/يعدّل — السيرفر فقط)
CREATE POLICY wallet_self_select ON wallet_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- الشحن/السحب/التحويل: المستخدم يرى معاملاته، يضيف صفوف فقط
CREATE POLICY deposits_self_select ON deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY deposits_self_insert ON deposits FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY withdrawals_self_select ON withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY withdrawals_self_insert ON withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY transfers_self_select ON transfers
    FOR SELECT USING (auth.uid() = user_id OR auth.uid() = to_user_id);

-- الغرف: القراءة للجميع (للقائمة العامة)
CREATE POLICY rooms_public_select ON rooms FOR SELECT USING (status <> 'closed' OR auth.uid() = owner_id);
CREATE POLICY rooms_owner_update ON rooms FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY rooms_owner_delete ON rooms FOR DELETE USING (auth.uid() = owner_id);

-- الألعاب: يرى الجولات والرهانات الخاصة به فقط
CREATE POLICY game_bets_self_select ON game_bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY game_rounds_public_select ON game_rounds FOR SELECT USING (true);

-- الهدايا: يرى معاملاته فقط
CREATE POLICY gift_tx_self_select ON gift_transactions
    FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- الهدايا والإعدادات: عام للقراءة
CREATE POLICY gifts_public_select ON gifts FOR SELECT USING (is_active = true);
CREATE POLICY game_configs_public_select ON game_configs FOR SELECT USING (true);

-- التصنيفات: عام للقراءة
CREATE POLICY leaderboards_public_select ON leaderboards FOR SELECT USING (true);

-- ============================================================================
-- 17) المستخدم الأدمن الافتراضي (يجب تغيير كلمة المرور فورًا)
-- ============================================================================
-- يُنشأ يدويًا من Supabase Auth
-- ثم يُربط هنا بـ role = 'super_admin'

-- ============================================================================
-- 18) الفهائر الإضافية للأداء
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_balance_gold ON users(balance_gold DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_bets_user_game ON game_bets(user_id, game_type, created_at DESC);

-- ============================================================================
-- ملاحظات تنفيذية مهمة:
-- ============================================================================
-- 1. يتم تنفيذ هذا الملف كاملاً في محرر SQL في Supabase Dashboard
--    أو عبر supabase db push
-- 2. يجب إنشاء مستخدم Auth يدويًا (Email/Password) للأدمن الأول،
--    ثم UPDATE users SET role = 'super_admin' WHERE id = <uuid>;
-- 3. كل العمليات على المحفظة والألعاب يجب أن تتم عبر Edge Functions
--    (تنادي دوال record_wallet_transaction) — لا يدخّل المستخدم مباشرة
-- 4. أسعار صرف USDT/الشام كاش تُدار لكل وكيل على حدة (agents.exchange_rate_*)
--    أو العام (admin_settings.usdt_to_gold_rate)
-- 5. كل تعديل من الأدمن يُسجّل في admin_audit_log — ملف SQL أساسي للتوثيق
-- ============================================================================
