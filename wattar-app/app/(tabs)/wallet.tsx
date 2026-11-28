import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Coins,
  Gem,
  History,
  Info,
  ShieldCheck,
} from 'lucide-react-native';
import { supabase, callFunction, uploadPrivateMedia } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { colors, fonts, radius } from '@/lib/theme';

type DepositMethodCode = 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';

interface WalletAccess {
  allowed: boolean;
  agent_id: string | null;
  agent_name: string | null;
  group_id: string | null;
  group_name: string | null;
}

interface WalletOptions {
  diamond_to_coin_rate: number;
  diamonds_per_usd: number;
  withdrawals_enabled: boolean;
  min_withdrawal_diamonds: number;
  has_assigned_agent: boolean;
  is_verified_host: boolean;
  is_agent: boolean;
  withdrawal_fee_percent: number;
  max_withdrawal_usd_per_day: number;
  coins_per_usd: number;
  deposit_fee_percent: number;
  min_withdrawal_usd: number;
}

interface DepositMethod {
  method: DepositMethodCode;
  name_ar: string;
  instructions: string;
  min_amount_usd: number;
  max_amount_usd: number;
  effective_rate: number | null;
  fee_percent: number | null;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  currency: 'gold' | 'diamond' | string;
  reference_type: string | null;
  created_at: string;
}

interface WithdrawalRecord {
  id: string;
  amount_diamond: number;
  net_usd: number;
  status: string;
  created_at: string;
}

const palette = {
  background: colors.background,
  surface: colors.surface,
  elevated: colors.surfaceElevated,
  border: colors.border,
  text: colors.text,
  muted: colors.textSecondary,
  primary: colors.primary,
  gold: colors.gold,
  teal: colors.teal,
  success: colors.success,
  danger: colors.danger,
} as const;

export default function WalletScreen() {
  const { profile, loadProfile } = useAuthStore();
  const [access, setAccess] = useState<WalletAccess | null>(null);
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [withdrawalVisible, setWithdrawalVisible] = useState(false);
  const [conversionVisible, setConversionVisible] = useState(false);
  const [walletOptions, setWalletOptions] = useState<WalletOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWallet = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { data: accessData, error: accessError } = await supabase.rpc('get_my_wallet_access');
      if (accessError) throw accessError;
      const accessRow = Array.isArray(accessData) ? accessData[0] : accessData;
      const walletAccess = accessRow && typeof accessRow === 'object'
        ? accessRow as WalletAccess
        : null;
      setAccess(walletAccess?.allowed ? walletAccess : null);

      if (!walletAccess?.allowed) {
        setMethods([]);
        setTransactions([]);
        setWithdrawals([]);
        setWalletOptions(null);
        return;
      }

      const [methodsResult, transactionsResult, optionsResult, withdrawalsResult] = await Promise.all([
        supabase.rpc('list_my_deposit_methods'),
        supabase
          .from('wallet_transactions')
          .select('id, type, amount, currency, reference_type, created_at')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.rpc('get_my_wallet_options'),
        supabase
          .from('diamond_withdrawals')
          .select('id, amount_diamond, net_usd, status, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (methodsResult.error) throw methodsResult.error;
      if (transactionsResult.error) throw transactionsResult.error;
      if (optionsResult.error) throw optionsResult.error;
      if (withdrawalsResult.error) throw withdrawalsResult.error;
      setMethods((methodsResult.data ?? []) as DepositMethod[]);
      setTransactions((transactionsResult.data ?? []) as WalletTransaction[]);
      setWithdrawals((withdrawalsResult.data ?? []) as WithdrawalRecord[]);
      const optionsRow = Array.isArray(optionsResult.data) ? optionsResult.data[0] : optionsResult.data;
      setWalletOptions(optionsRow ? optionsRow as WalletOptions : null);
      await loadProfile();
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ط­ظپط¸ط©.';
      setError(message);
      if (showLoading) Alert.alert('طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ط­ظپط¸ط©', message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [loadProfile]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const coinBalance = Number(profile?.balance_gold ?? 0);
  const diamondBalance = Number(profile?.balance_diamond ?? 0);
  const coinPerDiamond = Number(walletOptions?.diamond_to_coin_rate ?? 0);
  const diamondsPerUsd = Number(walletOptions?.diamonds_per_usd ?? 0);
  const withdrawalFeePercent = Number(walletOptions?.withdrawal_fee_percent ?? 0);
  const minWithdrawalDiamonds = Number(walletOptions?.min_withdrawal_diamonds ?? 0);
  const minWithdrawalUsd = Number(walletOptions?.min_withdrawal_usd ?? 0);
  const isHost = walletOptions?.is_verified_host === true;
  const isAgent = walletOptions?.is_agent === true;
  const canWithdraw = Boolean(walletOptions?.withdrawals_enabled) && (isHost || isAgent);
  const diamondCoinValue = Math.floor(diamondBalance * coinPerDiamond);

  const eligibilityHint = useMemo(() => {
    if (!walletOptions) return '';
    if (isHost) return 'ط£ظ†طھ ظ…ط¶ظٹظپط© ظ…ظˆط«ظ‚ط© â€” ظٹظ…ظƒظ†ظƒ ط³ط­ط¨ Diamond ظƒط¯ظˆظ„ط§ط± ط£ظˆ طھط­ظˆظٹظ„ظ‡ ط¥ظ„ظ‰ Coin.';
    if (isAgent) return 'ط£ظ†طھ ظˆظƒظٹظ„ ظ…ط¹طھظ…ط¯ â€” ظٹظ…ظƒظ†ظƒ ط³ط­ط¨ Diamond ظƒط¯ظˆظ„ط§ط± ط£ظˆ طھط­ظˆظٹظ„ظ‡ ط¥ظ„ظ‰ Coin.';
    return 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¹ط§ط¯ظٹ ظٹط­ظˆظ‘ظ„ Diamond ط¥ظ„ظ‰ Coin ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚. ط§ظ„ط³ط­ط¨ ط§ظ„ظ†ظ‚ط¯ظٹ ظ…طھط§ط­ ظ„ظ„ظ…ط¶ظٹظپط§طھ ط§ظ„ظ…ظˆط«ظ‚ط§طھ ظˆط§ظ„ظˆظƒظ„ط§ط، ظپظ‚ط·.';
  }, [isAgent, isHost, walletOptions]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadWallet()} tintColor={palette.gold} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>ط§ظ„ظ…ط­ظپط¸ط©</Text>
            <Text style={styles.subtitle}>ط£ط±طµط¯ط© ظˆط§ط¶ط­ط©طŒ ط¹ظ…ظˆظ„ط§طھ ط¸ط§ظ‡ط±ط©طŒ ظˆطھط­ظˆظٹظ„ط§طھ ط³ظ„ط³ط©</Text>
          </View>
          <View style={styles.headerIcon}><Coins size={21} color={palette.gold} /></View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!access ? (
          <View style={styles.gateCard}>
            <View style={styles.gateIcon}><ShieldCheck size={23} color={palette.gold} /></View>
            <Text style={styles.gateTitle}>ط§ظ„ظ…ط­ظپط¸ط© ط؛ظٹط± ظ…طھط§ط­ط© ط­ط§ظ„ظٹظ‹ط§</Text>
            <Text style={styles.gateText}>
              ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط§ظ„ط­ط³ط§ط¨ ظ†ط´ط·ظ‹ط§ ظˆظ…ط¤ظƒط¯ ط§ظ„ط¹ظ…ط± ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ط­ظپط¸ط©.
            </Text>
          </View>
        ) : (
          <>
            {access.agent_name ? (
              <View style={styles.agentNotice}>
                <ShieldCheck size={17} color={palette.success} />
                <Text style={styles.agentNoticeText}>ظˆظƒظٹظ„ظƒ ط§ظ„ظ…ط¹طھظ…ط¯: {access.agent_name}</Text>
              </View>
            ) : null}

            <View style={styles.balanceHero}>
              <View style={styles.heroGlow} />
              <View style={styles.heroRow}>
                <View style={styles.heroBalance}>
                  <View style={styles.heroLabelRow}>
                    <CurrencyIcon currency="coin" size={22} />
                    <Text style={styles.heroLabel}>ط±طµظٹط¯ Coin</Text>
                  </View>
                  <Text style={styles.heroValue}>{coinBalance.toLocaleString()}</Text>
                  <Text style={styles.heroHint}>ظ„ظ„ط´ط­ظ† ظˆط§ظ„ظ‡ط¯ط§ظٹط§ ظˆط§ظ„ط£ظ„ط¹ط§ط¨ ظˆط§ظ„ط±ط³ط§ط¦ظ„ ط§ظ„ظ…ط¯ظپظˆط¹ط©</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroBalance}>
                  <View style={styles.heroLabelRow}>
                    <CurrencyIcon currency="diamond" size={22} />
                    <Text style={styles.heroLabel}>ط±طµظٹط¯ Diamond</Text>
                  </View>
                  <Text style={[styles.heroValue, styles.diamondValue]}>{diamondBalance.toLocaleString()}</Text>
                  <Text style={styles.heroHint}>
                    {coinPerDiamond > 0
                      ? `طھط¹ط§ط¯ظ„ ${diamondCoinValue.toLocaleString()} Coin`
                      : 'ط£ط±ط¨ط§ط­ ط§ظ„ظ‡ط¯ط§ظٹط§ ظˆط§ظ„ظ…ط¶ظٹظپط§طھ'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.quickActions}>
              <TouchableOpacity
                style={[styles.quickAction, !methods.length && styles.disabled]}
                onPress={() => setModalVisible(true)}
                disabled={!methods.length}
                accessibilityRole="button"
              >
                <View style={[styles.quickIcon, styles.quickIconGold]}><ArrowDownToLine size={18} color={palette.gold} /></View>
                <Text style={styles.quickLabel}>ط´ط­ظ† Coin</Text>
                <Text style={styles.quickCaption}>1$ = {Number(walletOptions?.coins_per_usd ?? 3000).toLocaleString()} Coin</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickAction, !(coinPerDiamond > 0 && diamondBalance > 0) && styles.disabled]}
                onPress={() => setConversionVisible(true)}
                disabled={!(coinPerDiamond > 0 && diamondBalance > 0)}
                accessibilityRole="button"
              >
                <View style={[styles.quickIcon, styles.quickIconTeal]}><ArrowRightLeft size={18} color={palette.teal} /></View>
                <Text style={styles.quickLabel}>طھط­ظˆظٹظ„ Diamond</Text>
                <Text style={styles.quickCaption}>
                  {coinPerDiamond > 0 ? `1 Diamond = ${coinPerDiamond.toLocaleString()} Coin` : 'ط؛ظٹط± ظ…ظپط¹ظ‘ظ„'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickAction, !canWithdraw && styles.disabled]}
                onPress={() => setWithdrawalVisible(true)}
                disabled={!canWithdraw}
                accessibilityRole="button"
              >
                <View style={[styles.quickIcon, styles.quickIconViolet]}><ArrowUpFromLine size={18} color={palette.primary} /></View>
                <Text style={styles.quickLabel}>ط³ط­ط¨ ظ†ظ‚ط¯ظٹ</Text>
                <Text style={styles.quickCaption}>
                  {canWithdraw
                    ? `ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ $${minWithdrawalUsd.toFixed(0)}`
                    : isHost || isAgent ? 'ط؛ظٹط± ظ…ظپط¹ظ‘ظ„ ط­ط§ظ„ظٹظ‹ط§' : 'ظ„ظ„ظ…ط¶ظٹظپط§طھ ظˆط§ظ„ظˆظƒظ„ط§ط،'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.eligibilityCard}>
              <View style={styles.eligibilityIcon}><Info size={16} color={palette.gold} /></View>
              <Text style={styles.eligibilityText}>{eligibilityHint}</Text>
            </View>

            {coinPerDiamond > 0 && diamondBalance > 0 ? (
              <View style={styles.conversionCard}>
                <View style={styles.sectionHeadingRow}>
                  <Text style={styles.sectionTitle}>طھط­ظˆظٹظ„ Diamond ط¥ظ„ظ‰ Coin</Text>
                  <View style={styles.ratePill}>
                    <Text style={styles.ratePillText}>
                      1 Diamond = {coinPerDiamond.toLocaleString()} Coin
                    </Text>
                  </View>
                </View>
                <Text style={styles.sectionCopy}>
                  ط­ظˆظ‘ظ„ ط£ط±ط¨ط§ط­ظƒ ط¥ظ„ظ‰ Coin ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚: ط§ظ„ظ‡ط¯ط§ظٹط§طŒ ط§ظ„ط£ظ„ط¹ط§ط¨طŒ ظˆط§ظ„ط±ط³ط§ط¦ظ„ ط§ظ„ظ…ط¯ظپظˆط¹ط©.
                </Text>
                <View style={styles.conversionPreview}>
                  <View>
                    <Text style={styles.conversionLabel}>ط³طھط­طµظ„ ط¹ظ„ظ‰</Text>
                    <Text style={styles.conversionValue}>{diamondCoinValue.toLocaleString()} Coin</Text>
                  </View>
                  <ArrowRightLeft size={22} color={palette.teal} />
                  <View style={styles.conversionFrom}>
                    <Text style={styles.conversionLabel}>ظ…ظ† ط±طµظٹط¯ظƒ</Text>
                    <Text style={styles.conversionSource}>{diamondBalance.toLocaleString()} Diamond</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.conversionButton} onPress={() => setConversionVisible(true)}>
                  <Text style={styles.conversionButtonText}>ط§ط®طھظٹط§ط± ظ…ط¨ظ„ط؛ ط§ظ„طھط­ظˆظٹظ„</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.walletNotice}>
              <Text style={styles.walletNoticeTitle}>ط¹ظ…ظ„طھط§ظ†طŒ ظ„ظƒظ„ ظˆط§ط­ط¯ط© ط§ط³طھط®ط¯ط§ظ… ظˆط§ط¶ط­</Text>
              <View style={styles.noticeRow}>
                <View style={styles.noticeBullet} />
                <Text style={styles.walletNoticeText}>
                  <Text style={styles.noticeStrong}>Coin</Text> ظٹظڈط´طھط±ظ‰ ط¨ط§ظ„ط¯ظˆظ„ط§ط± ظˆظٹظڈط³طھط®ط¯ظ… ط¯ط§ط®ظ„ Wattar ظپظ‚ط·طŒ ظˆظ„ط§ ظٹظڈط³ط­ط¨ ظ†ظ‚ط¯ظ‹ط§.
                </Text>
              </View>
              <View style={styles.noticeRow}>
                <View style={styles.noticeBullet} />
                <Text style={styles.walletNoticeText}>
                  <Text style={styles.noticeStrong}>Diamond</Text> ظٹط£طھظٹ ظ…ظ† ط£ط±ط¨ط§ط­ ط§ظ„ظ‡ط¯ط§ظٹط§ ظˆظٹظ…ظƒظ† طھط­ظˆظٹظ„ظ‡ ط¥ظ„ظ‰ CoinطŒ ط£ظˆ ط³ط­ط¨ظ‡ ظƒط¯ظˆظ„ط§ط± ظ„ظ„ظ…ط¶ظٹظپط§طھ ط§ظ„ظ…ظˆط«ظ‚ط§طھ ظˆط§ظ„ظˆظƒظ„ط§ط،.
                </Text>
              </View>
            </View>

            {!methods.length ? (
              <Text style={styles.emptyMethods}>ظ„ظ… طھظپط¹ظ‘ظ„ ط§ظ„ط¥ط¯ط§ط±ط© ظˆط³ط§ط¦ظ„ ط´ط­ظ† ط­ط§ظ„ظٹظ‹ط§.</Text>
            ) : null}

            {withdrawals.length ? (
              <View style={styles.historyCard}>
                <View style={styles.historyHeading}>
                  <ArrowUpFromLine size={17} color={palette.success} />
                  <Text style={styles.historyTitle}>ط·ظ„ط¨ط§طھ ط§ظ„ط³ط­ط¨</Text>
                </View>
                {withdrawals.map((withdrawal) => (
                  <View key={withdrawal.id} style={styles.transactionRow}>
                    <View style={styles.transactionInfo}>
                      <Text style={styles.transactionType}>{getWithdrawalStatus(withdrawal.status)}</Text>
                      <Text style={styles.transactionDate}>{new Date(withdrawal.created_at).toLocaleString('ar')}</Text>
                    </View>
                    <View style={styles.transactionAmountCopy}>
                      <Text style={styles.transactionAmount}>
                        {Number(withdrawal.amount_diamond).toLocaleString()} Diamond
                      </Text>
                      <Text style={styles.transactionSubAmount}>
                        طµط§ظپظٹ ${Number(withdrawal.net_usd).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.historyCard}>
              <View style={styles.historyHeading}>
                <History size={17} color={palette.gold} />
                <Text style={styles.historyTitle}>ط³ط¬ظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ</Text>
              </View>
              {transactions.length ? (
                <FlatList
                  data={transactions}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                  renderItem={({ item }) => {
                    const positive = Number(item.amount) > 0;
                    const currency = item.currency === 'diamond' || item.currency === 'promo_dia'
                      ? 'Diamond'
                      : 'Coin';
                    return (
                      <View style={styles.transactionRow}>
                        <View style={styles.transactionInfo}>
                          <Text style={styles.transactionType}>{getTransactionLabel(item)}</Text>
                          <Text style={styles.transactionDate}>{new Date(item.created_at).toLocaleString('ar')}</Text>
                        </View>
                        <Text style={[styles.transactionAmount, { color: positive ? palette.success : palette.danger }]}>
                          {positive ? '+' : ''}{Number(item.amount).toLocaleString()} {currency}
                        </Text>
                      </View>
                    );
                  }}
                />
              ) : (
                <Text style={styles.emptyHistory}>ظ„ط§ طھظˆط¬ط¯ ظ…ط¹ط§ظ…ظ„ط§طھ ط¨ط¹ط¯.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {access ? (
        <DepositModal
          visible={modalVisible}
          methods={methods}
          coinBalance={coinBalance}
          options={walletOptions}
          onClose={() => setModalVisible(false)}
          onSuccess={async () => {
            await loadWallet();
          }}
        />
      ) : null}

      {access && coinPerDiamond > 0 ? (
        <ConversionModal
          visible={conversionVisible}
          balance={diamondBalance}
          rate={coinPerDiamond}
          onClose={() => setConversionVisible(false)}
          onSuccess={async () => {
            setConversionVisible(false);
            await loadWallet();
          }}
        />
      ) : null}

      {access && canWithdraw ? (
        <WithdrawalModal
          visible={withdrawalVisible}
          balance={diamondBalance}
          minimum={minWithdrawalDiamonds}
          minimumUsd={minWithdrawalUsd}
          rate={diamondsPerUsd}
          feePercent={withdrawalFeePercent}
          maxDailyUsd={Number(walletOptions?.max_withdrawal_usd_per_day ?? 0)}
          hasAgent={walletOptions?.has_assigned_agent === true}
          onClose={() => setWithdrawalVisible(false)}
          onSuccess={async () => {
            setWithdrawalVisible(false);
            await loadWallet();
          }}
        />
      ) : null}
    </View>
  );
}

function DepositModal({
  visible,
  methods,
  coinBalance,
  options,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  methods: DepositMethod[];
  coinBalance: number;
  options: WalletOptions | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { profile } = useAuthStore();
  const [methodCode, setMethodCode] = useState<DepositMethodCode | null>(methods[0]?.method ?? null);
  const [amount, setAmount] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [network, setNetwork] = useState<'trc20' | 'bep20'>('trc20');
  const [txHash, setTxHash] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [usdtWallets, setUsdtWallets] = useState<{ trc20?: string; bep20?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);
  const selectedMethod = methods.find((method) => method.method === methodCode) ?? methods[0] ?? null;

  useEffect(() => {
    if (!selectedMethod || !methods.some((method) => method.method === methodCode)) {
      setMethodCode(methods[0]?.method ?? null);
    }
  }, [methodCode, methods, selectedMethod]);

  useEffect(() => {
    if (selectedMethod?.method !== 'usdt' || usdtWallets) return;
    supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'usdt_wallets')
      .maybeSingle()
      .then(({ data }: { data: { value: unknown } | null }) => {
        const value = data?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          setUsdtWallets(value as { trc20?: string; bep20?: string });
        }
      });
  }, [selectedMethod?.method, usdtWallets]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  const numericAmount = Number(amount);
  const feePercent = Number(selectedMethod?.fee_percent ?? options?.deposit_fee_percent ?? 0);
  const rate = Number(selectedMethod?.effective_rate ?? options?.coins_per_usd ?? 0);
  const feeUsd = Number.isFinite(numericAmount) && numericAmount > 0
    ? Math.round(numericAmount * feePercent) / 100
    : 0;
  const creditedUsd = Math.max(0, Math.round((numericAmount - feeUsd) * 100) / 100);
  const coinsToReceive = Math.floor(creditedUsd * rate);

  const submit = async () => {
    if (!selectedMethod || !Number.isFinite(numericAmount)
      || numericAmount < Number(selectedMethod.min_amount_usd)
      || numericAmount > Number(selectedMethod.max_amount_usd)
      || !externalRef.trim() || !image) {
      Alert.alert('ط±ط§ط¬ط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ', `ط£ط¯ط®ظ„ ظ…ط¨ظ„ط؛ظ‹ط§ ط¨ظٹظ† $${selectedMethod?.min_amount_usd ?? 1} ظˆ$${selectedMethod?.max_amount_usd ?? 2000}طŒ ظˆط±ظ‚ظ… ط§ظ„ط¹ظ…ظ„ظٹط© ظˆطµظˆط±ط© ط§ظ„ط¥ط«ط¨ط§طھ.`);
      return;
    }
    if (selectedMethod.method === 'usdt') {
      const hash = txHash.trim();
      const validHash = network === 'trc20'
        ? /^[0-9a-fA-F]{64}$/.test(hash)
        : /^0x[0-9a-fA-F]{64}$/.test(hash);
      if (!validHash) {
        Alert.alert('ط±ظ‚ظ… ط§ظ„ط¹ظ…ظ„ظٹط© ط؛ظٹط± طµط§ظ„ط­', network === 'trc20'
          ? 'ط£ط¯ط®ظ„ ط±ظ‚ظ… ط¹ظ…ظ„ظٹط© TRC20 (64 ط­ط±ظپظ‹ط§ ط³ط¯ط§ط³ظٹ ط¹ط´ط±ظٹ).'
          : 'ط£ط¯ط®ظ„ ط±ظ‚ظ… ط¹ظ…ظ„ظٹط© BEP20 (0x ظ…طھط¨ظˆط¹ط© ط¨ظ€64 ط­ط±ظپظ‹ط§ ط³ط¯ط§ط³ظٹ ط¹ط´ط±ظٹ).');
        return;
      }
      if (fromAddress.trim()) {
        const validAddress = network === 'trc20'
          ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(fromAddress.trim())
          : /^0x[0-9a-fA-F]{40}$/.test(fromAddress.trim());
        if (!validAddress) {
          Alert.alert('ط¹ظ†ظˆط§ظ† ط§ظ„ظ…ط±ط³ظ„ ط؛ظٹط± طµط§ظ„ط­', 'طھط£ظƒط¯ ظ…ظ† طµط­ط© ط¹ظ†ظˆط§ظ† ظ…ط­ظپط¸طھظƒ.');
          return;
        }
      }
    }

    const fingerprint = `${selectedMethod.method}:${numericAmount}:${externalRef.trim()}`;
    const idempotencyKey = attempt?.fingerprint === fingerprint
      ? attempt.key
      : `deposit-${profile?.id ?? 'user'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setAttempt({ fingerprint, key: idempotencyKey });
    setLoading(true);
    try {
      const extension = image.split('?')[0].split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
      const proofUrl = await uploadPrivateMedia(
        image,
        'deposit-proofs',
        `dep_${profile?.id ?? 'user'}_${Date.now()}.${extension}`,
        extension === 'png' ? 'image/png' : 'image/jpeg',
        5 * 1024 * 1024,
      );
      await callFunction('deposit-request', {
        method: selectedMethod.method,
        amount_usd: numericAmount,
        external_ref: externalRef.trim(),
        proof_url: proofUrl,
        ...(selectedMethod.method === 'usdt' ? {
          usdt_network: network,
          usdt_tx_hash: txHash.trim(),
          usdt_from_address: fromAddress.trim() || undefined,
        } : {}),
      }, idempotencyKey);
      setAttempt(null);
      Alert.alert('طھظ… ط§ط³طھظ„ط§ظ… ط§ظ„ط·ظ„ط¨', 'ط³ظٹط¸ظ‡ط± ط§ظ„ط±طµظٹط¯ ط¨ط¹ط¯ ظ…ط±ط§ط¬ط¹ط© ط¥ط«ط¨ط§طھ ط§ظ„ط´ط­ظ†.');
      await onSuccess();
      onClose();
    } catch (submitError: unknown) {
      Alert.alert('طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨', submitError instanceof Error ? submitError.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ط´ط­ظ† Coin</Text>
            <Text style={styles.modalSubtitle}>ط§ط®طھط± ظˆط³ظٹظ„ط© ط§ظ„ط¯ظپط¹طŒ ظˆط³ظ†ظˆط¶ظ‘ط­ ظ„ظƒ ط§ظ„ظ…ط¨ظ„ط؛ ظˆط§ظ„ط¹ظ…ظˆظ„ط© ظˆظ…ط§ ط³طھط­طµظ„ ط¹ظ„ظٹظ‡ ط¨ط§ظ„ط¶ط¨ط·.</Text>

            <View style={styles.compactBalance}>
              <Coins size={15} color={palette.gold} />
              <Text style={styles.compactBalanceText}>
                ط±طµظٹط¯ظƒ ط§ظ„ط­ط§ظ„ظٹ: {coinBalance.toLocaleString()} Coin
              </Text>
            </View>

            <Text style={styles.fieldLabel}>ظˆط³ظٹظ„ط© ط§ظ„ط´ط­ظ†</Text>
            <View style={styles.methodCards}>
              {methods.map((method) => {
                const active = selectedMethod?.method === method.method;
                return (
                  <TouchableOpacity
                    key={method.method}
                    style={[styles.methodCard, active && styles.methodCardActive]}
                    onPress={() => setMethodCode(method.method)}
                    disabled={loading}
                  >
                    <Text style={[styles.methodCardTitle, active && styles.methodCardTitleActive]}>
                      {method.name_ar}
                    </Text>
                    <Text style={styles.methodCardCaption}>
                      ${Number(method.min_amount_usd).toFixed(0)} â€“ ${Number(method.max_amount_usd).toFixed(0)}
                    </Text>
                    {active ? <View style={styles.methodActiveDot} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedMethod?.instructions ? (
              <View style={styles.instructions}>
                <Text style={styles.instructionsTitle}>طھط¹ظ„ظٹظ…ط§طھ ط§ظ„ط¯ظپط¹</Text>
                <Text style={styles.instructionsText}>{selectedMethod.instructions}</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>ط§ظ„ظ…ط¨ظ„ط؛ ط¨ط§ظ„ط¯ظˆظ„ط§ط±</Text>
            <View style={styles.amountInputRow}>
              <TextInput
                style={[styles.inputField, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                placeholder={`ظ…ظ† ${selectedMethod?.min_amount_usd ?? 1}`}
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                editable={!loading}
              />
              <View style={styles.amountCurrency}><Text style={styles.amountCurrencyText}>USD</Text></View>
            </View>

            {numericAmount > 0 ? (
              <View style={styles.mathCard}>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ظڈط¯ط®ظ„</Text>
                  <Text style={styles.mathValue}>${numericAmount.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>ط¹ظ…ظˆظ„ط© ط§ظ„ط´ط­ظ† ({feePercent.toFixed(2)}%)</Text>
                  <Text style={styles.mathValue}>âˆ’${feeUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„طµط§ظپظٹ</Text>
                  <Text style={styles.mathValue}>${creditedUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathDivider} />
                <View style={styles.mathRow}>
                  <Text style={styles.mathHighlightLabel}>ط³ظˆظپ طھط­طµظ„ ط¹ظ„ظ‰</Text>
                  <Text style={styles.mathHighlightValue}>{coinsToReceive.toLocaleString()} Coin</Text>
                </View>
                <Text style={styles.mathHint}>ط³ط¹ط± ط§ظ„طµط±ظپ: 1$ = {rate.toLocaleString()} Coin</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>ط±ظ‚ظ… ط§ظ„ط¹ظ…ظ„ظٹط© / ظ…ط±ط¬ط¹ ط§ظ„ط­ظˆط§ظ„ط©</Text>
            <TextInput
              style={styles.inputField}
              value={externalRef}
              onChangeText={setExternalRef}
              placeholder="ط£ط¯ط®ظ„ ط§ظ„ط±ظ‚ظ… ظƒظ…ط§ ظٹط¸ظ‡ط± ظپظٹ ط¥ظٹطµط§ظ„ ط§ظ„ط¯ظپط¹"
              placeholderTextColor={palette.muted}
              editable={!loading}
              maxLength={200}
            />

            {selectedMethod?.method === 'usdt' ? (
              <>
                <Text style={styles.fieldLabel}>ط´ط¨ظƒط© USDT</Text>
                <View style={styles.segmented}>
                  {(['trc20', 'bep20'] as const).map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[styles.segment, network === item && styles.segmentActive]}
                      onPress={() => setNetwork(item)}
                      disabled={loading}
                    >
                      <Text style={[styles.segmentText, network === item && styles.segmentTextActive]}>
                        {item === 'trc20' ? 'TRC20' : 'BEP20'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {usdtWallets?.[network] ? (
                  <View style={styles.instructions}>
                    <Text style={styles.instructionsTitle}>ط¹ظ†ظˆط§ظ† ط§ظ„ظ…ط­ظپط¸ط© ظ„ظ„ط§ط³طھظ„ط§ظ…</Text>
                    <Text style={styles.instructionsText} selectable>{usdtWallets[network]}</Text>
                  </View>
                ) : null}
                <Text style={styles.fieldLabel}>ط±ظ‚ظ… ط¹ظ…ظ„ظٹط© ط§ظ„طھط­ظˆظٹظ„ (TxID)</Text>
                <TextInput
                  style={styles.inputField}
                  value={txHash}
                  onChangeText={setTxHash}
                  placeholder={network === 'trc20' ? '64 ط­ط±ظپظ‹ط§ ط³ط¯ط§ط³ظٹ ط¹ط´ط±ظٹ' : '0x + 64 ط­ط±ظپظ‹ط§ ط³ط¯ط§ط³ظٹ ط¹ط´ط±ظٹ'}
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  maxLength={80}
                />
                <Text style={styles.fieldLabel}>ط¹ظ†ظˆط§ظ† ظ…ط­ظپط¸طھظƒ (ط§ط®طھظٹط§ط±ظٹ)</Text>
                <TextInput
                  style={styles.inputField}
                  value={fromAddress}
                  onChangeText={setFromAddress}
                  placeholder="ط§ظ„ط¹ظ†ظˆط§ظ† ط§ظ„ط°ظٹ ط£ط±ط³ظ„طھ ظ…ظ†ظ‡ USDT"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  maxLength={60}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>طµظˆط±ط© ط¥ط«ط¨ط§طھ ط§ظ„ط¯ظپط¹</Text>
            <TouchableOpacity style={styles.proofPicker} onPress={pickImage} disabled={loading}>
              {image ? (
                <Image source={{ uri: image }} style={styles.proofPreview} />
              ) : (
                <Text style={styles.proofText}>ط§ط¶ط؛ط· ظ„ط§ط®طھظٹط§ط± طµظˆط±ط© ط§ظ„ط¥ظٹطµط§ظ„</Text>
              )}
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>ط¥ظ„ط؛ط§ط،</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, loading && styles.disabled]} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ConversionModal({
  visible,
  balance,
  rate,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  balance: number;
  rate: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  const diamonds = Number(amount);
  const validAmount = Number.isSafeInteger(diamonds) && diamonds > 0 && diamonds <= balance;
  const coins = validAmount ? Math.floor(diamonds * rate) : 0;

  const submit = async () => {
    if (!validAmount) {
      Alert.alert('ط±ط§ط¬ط¹ ط§ظ„ظ…ط¨ظ„ط؛', `ط£ط¯ط®ظ„ ط¹ط¯ط¯ظ‹ط§ طµط­ظٹط­ظ‹ط§ ظ…ظ† Diamond ط¨ظٹظ† 1 ظˆ${balance.toLocaleString()}.`);
      return;
    }
    const fingerprint = String(diamonds);
    const key = attempt?.fingerprint === fingerprint
      ? attempt.key
      : `convert-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    setAttempt({ fingerprint, key });
    setLoading(true);
    try {
      await supabase.rpc('convert_my_diamonds_to_coins', {
        p_amount_diamond: diamonds,
        p_idempotency_key: key,
      });
      setAttempt(null);
      setAmount('');
      Alert.alert('طھظ… ط§ظ„طھط­ظˆظٹظ„', `ط£ظڈط¶ظٹظپ ${coins.toLocaleString()} Coin ط¥ظ„ظ‰ ط±طµظٹط¯ظƒ.`);
      await onSuccess();
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± ط§ظ„طھط­ظˆظٹظ„', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>طھط­ظˆظٹظ„ Diamond ط¥ظ„ظ‰ Coin</Text>
            <Text style={styles.modalSubtitle}>
              ط§ظ„طھط­ظˆظٹظ„ ظپظˆط±ظٹ ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚. ظ„ط§ ظٹظ…ظƒظ† طھط­ظˆظٹظ„ Coin ط¥ظ„ظ‰ Diamond ظ…ط±ط© ط£ط®ط±ظ‰.
            </Text>

            <View style={styles.conversionRateCard}>
              <View style={styles.conversionRateSide}>
                <Gem size={20} color={palette.teal} />
                <Text style={styles.conversionRateLabel}>Diamond</Text>
              </View>
              <ArrowRightLeft size={18} color={palette.muted} />
              <View style={styles.conversionRateSide}>
                <Coins size={20} color={palette.gold} />
                <Text style={styles.conversionRateLabel}>Coin</Text>
              </View>
              <Text style={styles.conversionRateValue}>1 = {rate.toLocaleString()}</Text>
            </View>

            <Text style={styles.fieldLabel}>ط¹ط¯ط¯ Diamond ط§ظ„ظ…ط±ط§ط¯ طھط­ظˆظٹظ„ظ‡ آ· ط±طµظٹط¯ظƒ {balance.toLocaleString()}</Text>
            <View style={styles.amountInputRow}>
              <TextInput
                style={[styles.inputField, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={palette.muted}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.maxButton}
                onPress={() => setAmount(String(balance))}
                disabled={loading}
              >
                <Text style={styles.maxButtonText}>ط§ظ„ظƒظ„</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.mathCard}>
              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط­ظˆظ‘ظ„</Text>
                <Text style={styles.mathValue}>{validAmount ? diamonds.toLocaleString() : 0} Diamond</Text>
              </View>
              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>ط±ط³ظˆظ… ط§ظ„طھط­ظˆظٹظ„</Text>
                <Text style={styles.mathValue}>ظ…ط¬ط§ظ†ظ‹ط§</Text>
              </View>
              <View style={styles.mathDivider} />
              <View style={styles.mathRow}>
                <Text style={styles.mathHighlightLabel}>ط³ظˆظپ طھط­طµظ„ ط¹ظ„ظ‰</Text>
                <Text style={styles.mathHighlightValue}>{coins.toLocaleString()} Coin</Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>ط¥ظ„ط؛ط§ط،</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, (loading || !validAmount) && styles.disabled]}
                onPress={submit}
                disabled={loading || !validAmount}
              >
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>طھط­ظˆظٹظ„ ط§ظ„ط¢ظ†</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function WithdrawalModal({
  visible,
  balance,
  minimum,
  minimumUsd,
  rate,
  feePercent,
  maxDailyUsd,
  hasAgent,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  balance: number;
  minimum: number;
  minimumUsd: number;
  rate: number;
  feePercent: number;
  maxDailyUsd: number;
  hasAgent: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<DepositMethodCode>(hasAgent ? 'agent' : 'usdt');
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState<'trc20' | 'bep20'>('trc20');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (method === 'agent' && !hasAgent) setMethod('usdt');
  }, [hasAgent, method]);

  const diamonds = Number(amount);
  const grossUsd = diamonds > 0 && rate > 0 ? diamonds / rate : 0;
  const feeUsd = grossUsd * feePercent / 100;
  const netUsd = Math.max(0, grossUsd - feeUsd);
  const belowMinimum = diamonds > 0 && diamonds < minimum;

  const submit = async () => {
    if (!Number.isSafeInteger(diamonds) || diamonds < minimum || diamonds > balance) {
      Alert.alert('ط±ط§ط¬ط¹ ط§ظ„ظ…ط¨ظ„ط؛', `ط£ط¯ط®ظ„ ط¹ط¯ط¯ظ‹ط§ طµط­ظٹط­ظ‹ط§ ط¨ظٹظ† ${minimum.toLocaleString()} ظˆ${balance.toLocaleString()} Diamond.`);
      return;
    }
    if (method === 'usdt') {
      const trimmedAddress = address.trim();
      const validAddress = network === 'trc20'
        ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmedAddress)
        : /^0x[0-9a-fA-F]{40}$/.test(trimmedAddress);
      if (!trimmedAddress || !validAddress) {
        Alert.alert('ط¨ظٹط§ظ†ط§طھ ظ†ط§ظ‚طµط©', network === 'trc20'
          ? 'ط£ط¯ط®ظ„ ط¹ظ†ظˆط§ظ† ظ…ط­ظپط¸ط© TRC20 طµط§ظ„ط­ظ‹ط§ (ظٹط¨ط¯ط£ ط¨ط­ط±ظپ T).'
          : 'ط£ط¯ط®ظ„ ط¹ظ†ظˆط§ظ† ظ…ط­ظپط¸ط© BEP20 طµط§ظ„ط­ظ‹ط§ (ظٹط¨ط¯ط£ ط¨ظ€0x).');
        return;
      }
    }

    const payoutDetails = method === 'usdt'
      ? { address: address.trim(), network }
      : {};
    const fingerprint = `${diamonds}:${method}:${JSON.stringify(payoutDetails)}`;
    const key = attempt?.fingerprint === fingerprint
      ? attempt.key
      : `withdraw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setAttempt({ fingerprint, key });
    setLoading(true);
    try {
      await callFunction('withdrawal-request', {
        amount_diamond: diamonds,
        method,
        payout_details: payoutDetails,
      }, key);
      setAttempt(null);
      setAmount('');
      Alert.alert('طھظ… ط§ط³طھظ„ط§ظ… ط§ظ„ط·ظ„ط¨', 'طھظ… ط­ط¬ط² Diamond ظ„ط­ظٹظ† ظ…ط±ط§ط¬ط¹ط© ط§ظ„ط·ظ„ط¨. ط³ظٹظڈط¹ط§ط¯ طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط¥ط°ط§ ط±ظڈظپط¶.');
      await onSuccess();
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  };

  const methods: DepositMethodCode[] = hasAgent ? ['agent', 'usdt'] : ['usdt'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ط³ط­ط¨ Diamond ظ†ظ‚ط¯ظ‹ط§</Text>
            <Text style={styles.modalSubtitle}>
              ط±طµظٹط¯ظƒ {balance.toLocaleString()} Diamond آ· ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ {minimum.toLocaleString()} Diamond (${minimumUsd.toFixed(2)})
            </Text>

            <Text style={styles.fieldLabel}>ط¹ط¯ط¯ Diamond ط§ظ„ظ…ط±ط§ط¯ ط³ط­ط¨ظ‡</Text>
            <View style={styles.amountInputRow}>
              <TextInput
                style={[styles.inputField, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={palette.muted}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.maxButton}
                onPress={() => setAmount(String(balance))}
                disabled={loading}
              >
                <Text style={styles.maxButtonText}>ط§ظ„ظƒظ„</Text>
              </TouchableOpacity>
            </View>
            {belowMinimum ? (
              <Text style={styles.warningText}>ط£ظ‚ظ„ ظ…ظ† ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ ظ„ظ„ط³ط­ط¨ ({minimum.toLocaleString()} Diamond).</Text>
            ) : null}

            {diamonds > 0 ? (
              <View style={styles.mathCard}>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>ظ‚ظٹظ…ط© ط§ظ„ط³ط­ط¨</Text>
                  <Text style={styles.mathValue}>${grossUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>ط¹ظ…ظˆظ„ط© ط§ظ„ط³ط­ط¨ ({feePercent.toFixed(2)}%)</Text>
                  <Text style={styles.mathValue}>âˆ’${feeUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathDivider} />
                <View style={styles.mathRow}>
                  <Text style={styles.mathHighlightLabel}>ط³طھط³طھظ„ظ… ظپظٹ ط­ط³ط§ط¨ظƒ</Text>
                  <Text style={styles.mathHighlightValue}>${netUsd.toFixed(2)}</Text>
                </View>
                <Text style={styles.mathHint}>
                  ط³ط¹ط± ط§ظ„طµط±ظپ: {rate.toLocaleString()} Diamond = $1 آ· ط§ظ„ط­ط¯ ط§ظ„ظٹظˆظ…ظٹ ${maxDailyUsd.toFixed(0)}
                </Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>ط·ط±ظٹظ‚ط© ط§ظ„ط§ط³طھظ„ط§ظ…</Text>
            <View style={styles.methodCards}>
              {methods.map((item) => {
                const active = method === item;
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.methodCard, active && styles.methodCardActive]}
                    onPress={() => setMethod(item)}
                    disabled={loading}
                  >
                    <Text style={[styles.methodCardTitle, active && styles.methodCardTitleActive]}>
                      {item === 'agent' ? 'ط¹ط¨ط± ط§ظ„ظˆظƒظٹظ„' : 'ظ…ط­ظپط¸ط© USDT'}
                    </Text>
                    <Text style={styles.methodCardCaption}>
                      {item === 'agent' ? 'طھط­ظˆظٹظ„ ط®ط§ط±ط¬ ط§ظ„طھط·ط¨ظٹظ‚' : 'TRC20 / BEP20'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {method === 'usdt' ? (
              <>
                <Text style={styles.fieldLabel}>ط¹ظ†ظˆط§ظ† ط§ظ„ظ…ط­ظپط¸ط©</Text>
                <TextInput
                  style={styles.inputField}
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  placeholder={network === 'trc20' ? 'T...' : '0x...'}
                  placeholderTextColor={palette.muted}
                />
                <Text style={styles.fieldLabel}>ط§ظ„ط´ط¨ظƒط©</Text>
                <View style={styles.segmented}>
                  {(['trc20', 'bep20'] as const).map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[styles.segment, network === item && styles.segmentActive]}
                      onPress={() => setNetwork(item)}
                      disabled={loading}
                    >
                      <Text style={[styles.segmentText, network === item && styles.segmentTextActive]}>
                        {item === 'trc20' ? 'TRC20' : 'BEP20'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.instructionsText}>
                ط³ظٹط­ظˆظ‘ظ„ ط§ظ„ظˆظƒظٹظ„ ط§ظ„ظ…ط¹طھظ…ط¯ ط§ظ„ظ…ط¨ظ„ط؛ ط¥ظ„ظٹظƒ ط®ط§ط±ط¬ ط§ظ„طھط·ط¨ظٹظ‚ ط¨ط¹ط¯ ظ…ظˆط§ظپظ‚ط© ط§ظ„ط¥ط¯ط§ط±ط©.
              </Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>ط¥ظ„ط؛ط§ط،</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, loading && styles.disabled]} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function getTransactionLabel(item: WalletTransaction): string {
  if (item.reference_type === 'conversion') {
    return item.currency === 'diamond' ? 'طھط­ظˆظٹظ„ ط¥ظ„ظ‰ Coin (ط®طµظ… Diamond)' : 'طھط­ظˆظٹظ„ ظ…ظ† Diamond (ط¥ط¶ط§ظپط© Coin)';
  }
  if (item.reference_type === 'diamond_withdrawal') {
    return item.amount > 0 ? 'ط¥ط¹ط§ط¯ط© ط±طµظٹط¯ Diamond ط¨ط¹ط¯ ط±ظپط¶ ط§ظ„ط³ط­ط¨' : 'ط­ط¬ط² Diamond ظ„ظ„ط³ط­ط¨';
  }
  if (item.type === 'gift_received' && item.currency === 'promo_dia') return 'Diamond ظ…ظ† ظ‡ط¯ظٹط©';
  const labels: Record<string, string> = {
    deposit: 'ط´ط­ظ† Coin',
    gift_sent: 'ظ‡ط¯ظٹط© ظ…ط±ط³ظ„ط©',
    gift_received: 'ط£ط±ط¨ط§ط­ Diamond',
    withdraw: 'ط³ط­ط¨ ط³ط§ط¨ظ‚',
    transfer_out: 'طھط­ظˆظٹظ„ طµط§ط¯ط± ط³ط§ط¨ظ‚',
    transfer_in: 'طھط­ظˆظٹظ„ ظˆط§ط±ط¯ ط³ط§ط¨ظ‚',
    bet: 'ظ„ط¹ط¨ط© ظ‚ط¯ظٹظ…ط©',
    win: 'ط±ط¨ط­ ظ„ط¹ط¨ط© ظ‚ط¯ظٹظ…',
    daily_bonus: 'ظ…ظƒط§ظپط£ط©',
    referral_bonus: 'ظ…ظƒط§ظپط£ط© ط¥ط­ط§ظ„ط©',
    signup_bonus: 'ظ…ظƒط§ظپط£ط© طھط³ط¬ظٹظ„',
    admin_adjustment: 'طھط³ظˆظٹط© ط¥ط¯ط§ط±ظٹط©',
  };
  return labels[item.type] ?? item.type;
}

function getWithdrawalStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'ط·ظ„ط¨ ط³ط­ط¨ ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
    reviewing: 'ط·ظ„ط¨ ط§ظ„ط³ط­ط¨ ظ‚ظٹط¯ ط§ظ„ظ…ط¹ط§ظ„ط¬ط©',
    approved: 'طھظ…طھ ط§ظ„ظ…ظˆط§ظپظ‚ط© ط¹ظ„ظ‰ ط§ظ„ط³ط­ط¨',
    processing: 'ط¬ط§ط±ظچ طھظ†ظپظٹط° ط§ظ„ط³ط­ط¨',
    completed: 'طھظ… طھظ†ظپظٹط° ط§ظ„ط³ط­ط¨',
    rejected: 'ط±ظڈظپط¶ ط§ظ„ط·ظ„ط¨ ظˆط£ط¹ظٹط¯ ط§ظ„ط±طµظٹط¯',
    cancelled: 'طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط·ظ„ط¨',
    failed: 'طھط¹ط°ط± طھظ†ظپظٹط° ط§ظ„ط·ظ„ط¨',
  };
  return labels[status] ?? status;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { paddingHorizontal: 16, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 58, paddingBottom: 18 },
  title: { color: palette.text, fontSize: 25, fontFamily: fonts.bold, textAlign: 'right' },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 5, textAlign: 'right' },
  headerIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.goldLine },
  error: { color: palette.danger, fontSize: 12, textAlign: 'center', marginBottom: 12 },
  gateCard: { alignItems: 'center', padding: 22, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginTop: 18 },
  gateIcon: { width: 58, height: 58, borderRadius: radius.lg, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  gateTitle: { color: palette.text, fontSize: 17, fontFamily: fonts.bold, textAlign: 'center' },
  gateText: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  agentNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: colors.successSoft, borderRadius: radius.md, marginBottom: 13 },
  agentNoticeText: { color: palette.success, fontSize: 12, fontFamily: fonts.semibold },
  balanceHero: { overflow: 'hidden', padding: 17, borderRadius: radius.xl, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.borderStrong },
  heroGlow: { position: 'absolute', top: -70, right: -30, width: 180, height: 140, borderRadius: 90, backgroundColor: colors.primaryHaze, opacity: 0.9 },
  heroRow: { flexDirection: 'row', alignItems: 'stretch' },
  heroBalance: { flex: 1 },
  heroDivider: { width: 1, backgroundColor: palette.border, marginHorizontal: 12 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLabel: { color: palette.muted, fontSize: 11, fontFamily: fonts.semibold },
  heroValue: { color: palette.gold, fontSize: 25, fontFamily: fonts.black, marginTop: 9, textAlign: 'left' },
  diamondValue: { color: palette.teal },
  heroHint: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 6 },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quickAction: { flex: 1, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 6, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  quickIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickIconGold: { backgroundColor: colors.goldSoft },
  quickIconTeal: { backgroundColor: colors.tealSoft },
  quickIconViolet: { backgroundColor: colors.primarySoft },
  quickLabel: { color: palette.text, fontSize: 11, fontFamily: fonts.bold, textAlign: 'center' },
  quickCaption: { color: palette.muted, fontSize: 8.5, marginTop: 4, textAlign: 'center', lineHeight: 12 },
  eligibilityCard: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 13, marginTop: 12, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: palette.border },
  eligibilityIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  eligibilityText: { flex: 1, color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  conversionCard: { padding: 15, marginTop: 13, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.tealEdge },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: palette.text, fontSize: 14, fontFamily: fonts.bold, flexShrink: 1 },
  ratePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.tealSoft },
  ratePillText: { color: palette.teal, fontSize: 9, fontFamily: fonts.black },
  sectionCopy: { color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 8, textAlign: 'right' },
  conversionPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, padding: 12, borderRadius: 14, backgroundColor: palette.elevated },
  conversionLabel: { color: palette.muted, fontSize: 9 },
  conversionValue: { color: palette.gold, fontSize: 16, fontFamily: fonts.black, marginTop: 4 },
  conversionFrom: { alignItems: 'flex-end' },
  conversionSource: { color: palette.teal, fontSize: 13, fontFamily: fonts.bold, marginTop: 4 },
  conversionButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 11, borderRadius: 13, backgroundColor: colors.tealDeep },
  conversionButtonText: { color: colors.text, fontSize: 12, fontFamily: fonts.bold },
  walletNotice: { padding: 15, marginTop: 12, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  walletNoticeTitle: { color: palette.text, fontSize: 13, fontFamily: fonts.semibold, textAlign: 'right', marginBottom: 7 },
  noticeRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', marginTop: 5 },
  noticeBullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.gold, marginTop: 6 },
  walletNoticeText: { flex: 1, color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  noticeStrong: { color: palette.text, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },
  emptyMethods: { color: palette.muted, fontSize: 11, textAlign: 'center', marginTop: 12 },
  historyCard: { padding: 15, marginTop: 17, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  historyHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  historyTitle: { color: palette.text, fontSize: 14, fontFamily: fonts.semibold },
  separator: { height: 1, backgroundColor: palette.border },
  transactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  transactionInfo: { flex: 1 },
  transactionType: { color: palette.text, fontSize: 13, fontFamily: fonts.semibold, textAlign: 'right' },
  transactionDate: { color: palette.muted, fontSize: 10, marginTop: 4, textAlign: 'right' },
  transactionAmountCopy: { alignItems: 'flex-end', marginLeft: 10 },
  transactionAmount: { fontSize: 12, fontFamily: fonts.semibold, textAlign: 'left' },
  transactionSubAmount: { color: palette.muted, fontSize: 9, marginTop: 3 },
  emptyHistory: { color: palette.muted, fontSize: 12, textAlign: 'center', paddingVertical: 18 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  modalScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  modalCard: { padding: 20, paddingBottom: 30, backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: palette.border },
  modalTitle: { color: palette.text, fontSize: 20, fontFamily: fonts.bold, textAlign: 'right' },
  modalSubtitle: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 13, textAlign: 'right' },
  compactBalance: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.goldSoft },
  compactBalanceText: { color: palette.gold, fontSize: 10, fontFamily: fonts.semibold },
  fieldLabel: { color: palette.text, fontSize: 12, fontFamily: fonts.semibold, marginTop: 13, marginBottom: 7, textAlign: 'right' },
  methodCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodCard: { flexGrow: 1, minWidth: '30%', padding: 11, borderRadius: 14, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  methodCardActive: { backgroundColor: colors.primarySoft, borderColor: palette.primary },
  methodCardTitle: { color: palette.muted, fontSize: 12, fontFamily: fonts.bold, textAlign: 'right' },
  methodCardTitleActive: { color: colors.text },
  methodCardCaption: { color: palette.muted, fontSize: 9, marginTop: 4, textAlign: 'right' },
  methodActiveDot: { position: 'absolute', top: 9, left: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: palette.gold },
  instructions: { padding: 12, marginTop: 12, borderRadius: 13, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.goldLine },
  instructionsTitle: { color: palette.gold, fontSize: 11, fontFamily: fonts.bold, textAlign: 'right' },
  instructionsText: { color: palette.text, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'right' },
  amountInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputField: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border, color: palette.text, textAlign: 'right', fontSize: 13 },
  amountInput: { flex: 1, fontSize: 16, fontFamily: fonts.semibold },
  amountCurrency: { minHeight: 48, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.goldSoft },
  amountCurrencyText: { color: palette.gold, fontSize: 11, fontFamily: fonts.bold },
  maxButton: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: palette.primary },
  maxButtonText: { color: palette.text, fontSize: 12, fontFamily: fonts.bold },
  mathCard: { marginTop: 13, padding: 13, borderRadius: 15, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  mathRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  mathLabel: { color: palette.muted, fontSize: 11 },
  mathValue: { color: palette.text, fontSize: 12, fontFamily: fonts.semibold },
  mathDivider: { height: 1, backgroundColor: palette.border, marginVertical: 6 },
  mathHighlightLabel: { color: palette.text, fontSize: 12, fontFamily: fonts.bold },
  mathHighlightValue: { color: palette.success, fontSize: 16, fontFamily: fonts.black },
  mathHint: { color: palette.muted, fontSize: 9, marginTop: 7, textAlign: 'right' },
  warningText: { color: palette.gold, fontSize: 10, marginTop: 7, textAlign: 'right' },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  segmentActive: { backgroundColor: colors.primarySoft, borderColor: palette.primary },
  segmentText: { color: palette.muted, fontSize: 11, fontFamily: fonts.bold },
  segmentTextActive: { color: colors.text },
  proofPicker: { minHeight: 92, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: palette.elevated },
  proofPreview: { width: '100%', height: 145, resizeMode: 'cover' },
  proofText: { color: palette.muted, fontSize: 12 },
  modalActions: { flexDirection: 'row', gap: 9, marginTop: 18 },
  cancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.elevated },
  cancelText: { color: palette.muted, fontSize: 13, fontFamily: fonts.semibold },
  confirmButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.primary },
  confirmText: { color: colors.text, fontSize: 13, fontFamily: fonts.bold },
  conversionRateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 13, borderRadius: 15, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  conversionRateSide: { alignItems: 'center', gap: 5 },
  conversionRateLabel: { color: palette.text, fontSize: 10, fontFamily: fonts.semibold },
  conversionRateValue: { color: palette.muted, fontSize: 10 },
});
