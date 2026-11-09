/**
 * Wattar — الأنواع المشتركة (Shared Types)
 * تُستخدم من قبل: تطبيق المستخدم، لوحة الأدمن، Edge Functions
 *
 * @version 1.0.0
 */

// ============================================================================
// الأدوار والصلاحيات
// ============================================================================
export type UserRole = 'guest' | 'user' | 'agent' | 'admin' | 'super_admin';

export type UserStatus = 'active' | 'suspended' | 'banned' | 'blacklisted';

// ============================================================================
// المحفظة
// ============================================================================
export type WalletTxType =
  | 'deposit'
  | 'withdraw'
  | 'transfer_out'
  | 'transfer_in'
  | 'bet'
  | 'win'
  | 'gift_sent'
  | 'gift_received'
  | 'agent_credit'
  | 'agent_debit'
  | 'admin_adjustment'
  | 'referral_bonus'
  | 'daily_bonus'
  | 'signup_bonus';

export type Currency = 'gold' | 'diamond';

export interface WalletTransaction {
  id: string;
  user_id: string;
  agent_id: string | null;
  type: WalletTxType;
  amount: number;            // موجب = إضافة، سالب = خصم
  balance_before: number;
  balance_after: number;
  currency: Currency;
  idempotency_key: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_by_function: string | null;
  created_at: string;
}

// ============================================================================
// الشحن والسحب
// ============================================================================
export type DepositMethod = 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';

export type TxStatus =
  | 'pending'
  | 'reviewing'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected';

export interface Deposit {
  id: string;
  user_id: string;
  agent_id: string | null;
  method: DepositMethod;
  amount_usd: number;
  amount_gold: number;
  fee_usd: number;
  external_ref: string;            // رقم العملية
  proof_url: string;              // صورة الإثبات
  sender_phone: string | null;
  sender_name: string | null;
  usdt_network: string | null;
  usdt_tx_hash: string | null;
  usdt_from_address: string | null;
  status: TxStatus;
  assigned_to: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  completed_at: string | null;
  rejected_reason: string | null;
  admin_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  agent_id: string | null;
  amount_gold: number;
  amount_usd: number;
  fee_usd: number;
  net_usd: number;
  method: DepositMethod;
  usdt_address: string | null;
  usdt_network: string | null;
  sham_cash_phone: string | null;
  syriatel_phone: string | null;
  external_ref: string | null;
  proof_url: string | null;
  paid_at: string | null;
  status: TxStatus;
  assigned_to: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  admin_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Transfer {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount_gold: number;
  fee_gold: number;
  net_gold: number;
  note: string | null;
  status: TxStatus;
  created_at: string;
}

// ============================================================================
// المستخدم والوكيل
// ============================================================================
export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  frame_url: string | null;
  background_url: string | null;
  role: UserRole;
  status: UserStatus;
  banned_reason: string | null;
  banned_until: string | null;
  balance_gold: number;
  balance_diamond: number;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  total_gifts_sent: number;
  total_gifts_received: number;
  referred_by_agent_id: string | null;
  referred_by_user_id: string | null;
  referral_code: string;
  rtp_override: number | null;
  is_force_win: boolean;
  is_force_lose: boolean;
  force_outcome_count: number;
  bet_limit_override: { min: number; max: number } | null;
  daily_bonus_claimed_at: string | null;
  preferred_language: string;
  platform: 'android' | 'ios' | 'web' | null;
  app_version: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  created_by_admin_id: string;
  wallet_usd: number;
  credit_limit_usd: number;
  commission_rate: number;
  referral_commission_tiers: Array<{ tier: number; rate: number }>;
  can_create_users: boolean;
  can_approve_deposits: boolean;
  can_approve_withdrawals: boolean;
  can_set_user_rtp: boolean;
  can_force_outcome: boolean;
  can_suspend_users: boolean;
  max_users: number;
  daily_deposit_limit_usd: number;
  exchange_rate_usd_to_gold: number;
  exchange_rate_gold_to_usd: number;
  total_users: number;
  total_deposit_usd: number;
  total_withdrawal_usd: number;
  total_commission_usd: number;
  total_credit_received_usd: number;
  status: UserStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// الألعاب
// ============================================================================
export type GameType = 'wheel' | 'dice' | 'aviator' | 'plinko' | 'slots';

export interface GameConfig {
  id: string;
  game_type: GameType;
  is_enabled: boolean;
  default_rtp: number;
  min_bet_gold: number;
  max_bet_gold: number;
  max_multiplier: number;
  settings: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
}

export interface GameRound {
  id: string;
  game_type: GameType;
  room_id: string | null;
  seed: string;
  result: Record<string, unknown>;
  crash_point: number | null;
  total_bets: number;
  total_bet_gold: number;
  total_payout: number;
  rtp_applied: number;
  started_at: string;
  ended_at: string | null;
  metadata: Record<string, unknown>;
}

export interface GameBet {
  id: string;
  round_id: string;
  user_id: string;
  game_type: GameType;
  bet_amount: number;
  bet_data: Record<string, unknown>;
  payout: number;
  multiplier: number;
  is_win: boolean;
  forced_outcome: 'win' | 'lose' | null;
  settled_at: string | null;
  created_at: string;
}

// ============================================================================
// الغرف الصوتية
// ============================================================================
export type RoomStatus = 'waiting' | 'live' | 'closed';
export type SeatStatus = 'empty' | 'locked' | 'occupied' | 'muted';

export interface Room {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_id: string;
  seat_count: 4 | 8 | 16;
  is_private: boolean;
  livekit_room_id: string;
  status: RoomStatus;
  listeners_count: number;
  speakers_count: number;
  category: string | null;
  tags: string[] | null;
  is_recorded: boolean;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomSeat {
  id: string;
  room_id: string;
  seat_index: number;
  user_id: string | null;
  status: SeatStatus;
  is_mic_on: boolean;
  is_owner_seat: boolean;
  joined_at: string | null;
  updated_at: string;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  user_id: string;
  message: string;
  is_system: boolean;
  gift_id: string | null;
  created_at: string;
}

// ============================================================================
// الهدايا
// ============================================================================
export interface Gift {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  animation_url: string | null;
  price_gold: number;
  recipient_diamond_ratio: number;
  is_premium: boolean;
  is_active: boolean;
  category: 'common' | 'rare' | 'epic' | 'legendary';
  sort_order: number;
  created_at: string;
}

export interface GiftTransaction {
  id: string;
  gift_id: string;
  from_user_id: string;
  to_user_id: string;
  room_id: string | null;
  quantity: number;
  total_gold: number;
  received_diamond: number;
  message: string | null;
  created_at: string;
}

// ============================================================================
// الإدارة والتدقيق
// ============================================================================
export type AuditActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'ban'
  | 'unban'
  | 'force_win'
  | 'force_lose'
  | 'adjust_balance'
  | 'set_rtp'
  | 'create_agent'
  | 'credit_agent'
  | 'reset_password';

export interface AdminAuditLog {
  id: string;
  admin_id: string;
  action: AuditActionType;
  target_type: string;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminSetting {
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by: string | null;
}
