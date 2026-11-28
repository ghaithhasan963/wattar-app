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
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل المحفظة.';
      setError(message);
      if (showLoading) Alert.alert('تعذر تحميل المحفظة', message);
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
    if (isHost) return 'أنت مضيفة موثقة — يمكنك سحب Diamond كدولار أو تحويله إلى Coin.';
    if (isAgent) return 'أنت وكيل معتمد — يمكنك سحب Diamond كدولار أو تحويله إلى Coin.';
    return 'المستخدم العادي يحوّل Diamond إلى Coin للاستخدام داخل التطبيق. السحب النقدي متاح للمضيفات الموثقات والوكلاء فقط.';
  }, [isAgent, isHost, walletOptions]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadWallet()} tintColor={palette.gold} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>المحفظة</Text>
            <Text style={styles.subtitle}>أرصدة واضحة، عمولات ظاهرة، وتحويلات سلسة</Text>
          </View>
          <View style={styles.headerIcon}><Coins size={21} color={palette.gold} /></View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!access ? (
          <View style={styles.gateCard}>
            <View style={styles.gateIcon}><ShieldCheck size={23} color={palette.gold} /></View>
            <Text style={styles.gateTitle}>المحفظة غير متاحة حاليًا</Text>
            <Text style={styles.gateText}>
              يجب أن يكون الحساب نشطًا ومؤكد العمر لاستخدام المحفظة.
            </Text>
          </View>
        ) : (
          <>
            {access.agent_name ? (
              <View style={styles.agentNotice}>
                <ShieldCheck size={17} color={palette.success} />
                <Text style={styles.agentNoticeText}>وكيلك المعتمد: {access.agent_name}</Text>
              </View>
            ) : null}

            <View style={styles.balanceHero}>
              <View style={styles.heroGlow} />
              <View style={styles.heroRow}>
                <View style={styles.heroBalance}>
                  <View style={styles.heroLabelRow}>
                    <CurrencyIcon currency="coin" size={22} />
                    <Text style={styles.heroLabel}>رصيد Coin</Text>
                  </View>
                  <Text style={styles.heroValue}>{coinBalance.toLocaleString()}</Text>
                  <Text style={styles.heroHint}>للشحن والهدايا والألعاب والرسائل المدفوعة</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroBalance}>
                  <View style={styles.heroLabelRow}>
                    <CurrencyIcon currency="diamond" size={22} />
                    <Text style={styles.heroLabel}>رصيد Diamond</Text>
                  </View>
                  <Text style={[styles.heroValue, styles.diamondValue]}>{diamondBalance.toLocaleString()}</Text>
                  <Text style={styles.heroHint}>
                    {coinPerDiamond > 0
                      ? `تعادل ${diamondCoinValue.toLocaleString()} Coin`
                      : 'أرباح الهدايا والمضيفات'}
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
                <Text style={styles.quickLabel}>شحن Coin</Text>
                <Text style={styles.quickCaption}>1$ = {Number(walletOptions?.coins_per_usd ?? 3000).toLocaleString()} Coin</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickAction, !(coinPerDiamond > 0 && diamondBalance > 0) && styles.disabled]}
                onPress={() => setConversionVisible(true)}
                disabled={!(coinPerDiamond > 0 && diamondBalance > 0)}
                accessibilityRole="button"
              >
                <View style={[styles.quickIcon, styles.quickIconTeal]}><ArrowRightLeft size={18} color={palette.teal} /></View>
                <Text style={styles.quickLabel}>تحويل Diamond</Text>
                <Text style={styles.quickCaption}>
                  {coinPerDiamond > 0 ? `1 Diamond = ${coinPerDiamond.toLocaleString()} Coin` : 'غير مفعّل'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickAction, !canWithdraw && styles.disabled]}
                onPress={() => setWithdrawalVisible(true)}
                disabled={!canWithdraw}
                accessibilityRole="button"
              >
                <View style={[styles.quickIcon, styles.quickIconViolet]}><ArrowUpFromLine size={18} color={palette.primary} /></View>
                <Text style={styles.quickLabel}>سحب نقدي</Text>
                <Text style={styles.quickCaption}>
                  {canWithdraw
                    ? `الحد الأدنى $${minWithdrawalUsd.toFixed(0)}`
                    : isHost || isAgent ? 'غير مفعّل حاليًا' : 'للمضيفات والوكلاء'}
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
                  <Text style={styles.sectionTitle}>تحويل Diamond إلى Coin</Text>
                  <View style={styles.ratePill}>
                    <Text style={styles.ratePillText}>
                      1 Diamond = {coinPerDiamond.toLocaleString()} Coin
                    </Text>
                  </View>
                </View>
                <Text style={styles.sectionCopy}>
                  حوّل أرباحك إلى Coin للاستخدام داخل التطبيق: الهدايا، الألعاب، والرسائل المدفوعة.
                </Text>
                <View style={styles.conversionPreview}>
                  <View>
                    <Text style={styles.conversionLabel}>ستحصل على</Text>
                    <Text style={styles.conversionValue}>{diamondCoinValue.toLocaleString()} Coin</Text>
                  </View>
                  <ArrowRightLeft size={22} color={palette.teal} />
                  <View style={styles.conversionFrom}>
                    <Text style={styles.conversionLabel}>من رصيدك</Text>
                    <Text style={styles.conversionSource}>{diamondBalance.toLocaleString()} Diamond</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.conversionButton} onPress={() => setConversionVisible(true)}>
                  <Text style={styles.conversionButtonText}>اختيار مبلغ التحويل</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.walletNotice}>
              <Text style={styles.walletNoticeTitle}>عملتان، لكل واحدة استخدام واضح</Text>
              <View style={styles.noticeRow}>
                <View style={styles.noticeBullet} />
                <Text style={styles.walletNoticeText}>
                  <Text style={styles.noticeStrong}>Coin</Text> يُشترى بالدولار ويُستخدم داخل Wattar فقط، ولا يُسحب نقدًا.
                </Text>
              </View>
              <View style={styles.noticeRow}>
                <View style={styles.noticeBullet} />
                <Text style={styles.walletNoticeText}>
                  <Text style={styles.noticeStrong}>Diamond</Text> يأتي من أرباح الهدايا ويمكن تحويله إلى Coin، أو سحبه كدولار للمضيفات الموثقات والوكلاء.
                </Text>
              </View>
            </View>

            {!methods.length ? (
              <Text style={styles.emptyMethods}>لم تفعّل الإدارة وسائل شحن حاليًا.</Text>
            ) : null}

            {withdrawals.length ? (
              <View style={styles.historyCard}>
                <View style={styles.historyHeading}>
                  <ArrowUpFromLine size={17} color={palette.success} />
                  <Text style={styles.historyTitle}>طلبات السحب</Text>
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
                        صافي ${Number(withdrawal.net_usd).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.historyCard}>
              <View style={styles.historyHeading}>
                <History size={17} color={palette.gold} />
                <Text style={styles.historyTitle}>سجل المعاملات</Text>
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
                <Text style={styles.emptyHistory}>لا توجد معاملات بعد.</Text>
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
      Alert.alert('راجع البيانات', `أدخل مبلغًا بين $${selectedMethod?.min_amount_usd ?? 1} و$${selectedMethod?.max_amount_usd ?? 2000}، ورقم العملية وصورة الإثبات.`);
      return;
    }
    if (selectedMethod.method === 'usdt') {
      const hash = txHash.trim();
      const validHash = network === 'trc20'
        ? /^[0-9a-fA-F]{64}$/.test(hash)
        : /^0x[0-9a-fA-F]{64}$/.test(hash);
      if (!validHash) {
        Alert.alert('رقم العملية غير صالح', network === 'trc20'
          ? 'أدخل رقم عملية TRC20 (64 حرفًا سداسي عشري).'
          : 'أدخل رقم عملية BEP20 (0x متبوعة بـ64 حرفًا سداسي عشري).');
        return;
      }
      if (fromAddress.trim()) {
        const validAddress = network === 'trc20'
          ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(fromAddress.trim())
          : /^0x[0-9a-fA-F]{40}$/.test(fromAddress.trim());
        if (!validAddress) {
          Alert.alert('عنوان المرسل غير صالح', 'تأكد من صحة عنوان محفظتك.');
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
      Alert.alert('تم استلام الطلب', 'سيظهر الرصيد بعد مراجعة إثبات الشحن.');
      await onSuccess();
      onClose();
    } catch (submitError: unknown) {
      Alert.alert('تعذر إرسال الطلب', submitError instanceof Error ? submitError.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>شحن Coin</Text>
            <Text style={styles.modalSubtitle}>اختر وسيلة الدفع، وسنوضّح لك المبلغ والعمولة وما ستحصل عليه بالضبط.</Text>

            <View style={styles.compactBalance}>
              <Coins size={15} color={palette.gold} />
              <Text style={styles.compactBalanceText}>
                رصيدك الحالي: {coinBalance.toLocaleString()} Coin
              </Text>
            </View>

            <Text style={styles.fieldLabel}>وسيلة الشحن</Text>
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
                      ${Number(method.min_amount_usd).toFixed(0)} – ${Number(method.max_amount_usd).toFixed(0)}
                    </Text>
                    {active ? <View style={styles.methodActiveDot} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedMethod?.instructions ? (
              <View style={styles.instructions}>
                <Text style={styles.instructionsTitle}>تعليمات الدفع</Text>
                <Text style={styles.instructionsText}>{selectedMethod.instructions}</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>المبلغ بالدولار</Text>
            <View style={styles.amountInputRow}>
              <TextInput
                style={[styles.inputField, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                placeholder={`من ${selectedMethod?.min_amount_usd ?? 1}`}
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                editable={!loading}
              />
              <View style={styles.amountCurrency}><Text style={styles.amountCurrencyText}>USD</Text></View>
            </View>

            {numericAmount > 0 ? (
              <View style={styles.mathCard}>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>المبلغ المُدخل</Text>
                  <Text style={styles.mathValue}>${numericAmount.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>عمولة الشحن ({feePercent.toFixed(2)}%)</Text>
                  <Text style={styles.mathValue}>−${feeUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>المبلغ الصافي</Text>
                  <Text style={styles.mathValue}>${creditedUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathDivider} />
                <View style={styles.mathRow}>
                  <Text style={styles.mathHighlightLabel}>سوف تحصل على</Text>
                  <Text style={styles.mathHighlightValue}>{coinsToReceive.toLocaleString()} Coin</Text>
                </View>
                <Text style={styles.mathHint}>سعر الصرف: 1$ = {rate.toLocaleString()} Coin</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>رقم العملية / مرجع الحوالة</Text>
            <TextInput
              style={styles.inputField}
              value={externalRef}
              onChangeText={setExternalRef}
              placeholder="أدخل الرقم كما يظهر في إيصال الدفع"
              placeholderTextColor={palette.muted}
              editable={!loading}
              maxLength={200}
            />

            {selectedMethod?.method === 'usdt' ? (
              <>
                <Text style={styles.fieldLabel}>شبكة USDT</Text>
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
                    <Text style={styles.instructionsTitle}>عنوان المحفظة للاستلام</Text>
                    <Text style={styles.instructionsText} selectable>{usdtWallets[network]}</Text>
                  </View>
                ) : null}
                <Text style={styles.fieldLabel}>رقم عملية التحويل (TxID)</Text>
                <TextInput
                  style={styles.inputField}
                  value={txHash}
                  onChangeText={setTxHash}
                  placeholder={network === 'trc20' ? '64 حرفًا سداسي عشري' : '0x + 64 حرفًا سداسي عشري'}
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  maxLength={80}
                />
                <Text style={styles.fieldLabel}>عنوان محفظتك (اختياري)</Text>
                <TextInput
                  style={styles.inputField}
                  value={fromAddress}
                  onChangeText={setFromAddress}
                  placeholder="العنوان الذي أرسلت منه USDT"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  maxLength={60}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>صورة إثبات الدفع</Text>
            <TouchableOpacity style={styles.proofPicker} onPress={pickImage} disabled={loading}>
              {image ? (
                <Image source={{ uri: image }} style={styles.proofPreview} />
              ) : (
                <Text style={styles.proofText}>اضغط لاختيار صورة الإيصال</Text>
              )}
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, loading && styles.disabled]} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>إرسال الطلب</Text>}
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
      Alert.alert('راجع المبلغ', `أدخل عددًا صحيحًا من Diamond بين 1 و${balance.toLocaleString()}.`);
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
      Alert.alert('تم التحويل', `أُضيف ${coins.toLocaleString()} Coin إلى رصيدك.`);
      await onSuccess();
    } catch (error: unknown) {
      Alert.alert('تعذر التحويل', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>تحويل Diamond إلى Coin</Text>
            <Text style={styles.modalSubtitle}>
              التحويل فوري داخل التطبيق. لا يمكن تحويل Coin إلى Diamond مرة أخرى.
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

            <Text style={styles.fieldLabel}>عدد Diamond المراد تحويله · رصيدك {balance.toLocaleString()}</Text>
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
                <Text style={styles.maxButtonText}>الكل</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.mathCard}>
              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>المبلغ المحوّل</Text>
                <Text style={styles.mathValue}>{validAmount ? diamonds.toLocaleString() : 0} Diamond</Text>
              </View>
              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>رسوم التحويل</Text>
                <Text style={styles.mathValue}>مجانًا</Text>
              </View>
              <View style={styles.mathDivider} />
              <View style={styles.mathRow}>
                <Text style={styles.mathHighlightLabel}>سوف تحصل على</Text>
                <Text style={styles.mathHighlightValue}>{coins.toLocaleString()} Coin</Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, (loading || !validAmount) && styles.disabled]}
                onPress={submit}
                disabled={loading || !validAmount}
              >
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>تحويل الآن</Text>}
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
      Alert.alert('راجع المبلغ', `أدخل عددًا صحيحًا بين ${minimum.toLocaleString()} و${balance.toLocaleString()} Diamond.`);
      return;
    }
    if (method === 'usdt') {
      const trimmedAddress = address.trim();
      const validAddress = network === 'trc20'
        ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmedAddress)
        : /^0x[0-9a-fA-F]{40}$/.test(trimmedAddress);
      if (!trimmedAddress || !validAddress) {
        Alert.alert('بيانات ناقصة', network === 'trc20'
          ? 'أدخل عنوان محفظة TRC20 صالحًا (يبدأ بحرف T).'
          : 'أدخل عنوان محفظة BEP20 صالحًا (يبدأ بـ0x).');
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
      Alert.alert('تم استلام الطلب', 'تم حجز Diamond لحين مراجعة الطلب. سيُعاد تلقائيًا إذا رُفض.');
      await onSuccess();
    } catch (error: unknown) {
      Alert.alert('تعذر إرسال الطلب', error instanceof Error ? error.message : 'حاول مرة أخرى.');
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
            <Text style={styles.modalTitle}>سحب Diamond نقدًا</Text>
            <Text style={styles.modalSubtitle}>
              رصيدك {balance.toLocaleString()} Diamond · الحد الأدنى {minimum.toLocaleString()} Diamond (${minimumUsd.toFixed(2)})
            </Text>

            <Text style={styles.fieldLabel}>عدد Diamond المراد سحبه</Text>
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
                <Text style={styles.maxButtonText}>الكل</Text>
              </TouchableOpacity>
            </View>
            {belowMinimum ? (
              <Text style={styles.warningText}>أقل من الحد الأدنى للسحب ({minimum.toLocaleString()} Diamond).</Text>
            ) : null}

            {diamonds > 0 ? (
              <View style={styles.mathCard}>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>قيمة السحب</Text>
                  <Text style={styles.mathValue}>${grossUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathRow}>
                  <Text style={styles.mathLabel}>عمولة السحب ({feePercent.toFixed(2)}%)</Text>
                  <Text style={styles.mathValue}>−${feeUsd.toFixed(2)}</Text>
                </View>
                <View style={styles.mathDivider} />
                <View style={styles.mathRow}>
                  <Text style={styles.mathHighlightLabel}>ستستلم في حسابك</Text>
                  <Text style={styles.mathHighlightValue}>${netUsd.toFixed(2)}</Text>
                </View>
                <Text style={styles.mathHint}>
                  سعر الصرف: {rate.toLocaleString()} Diamond = $1 · الحد اليومي ${maxDailyUsd.toFixed(0)}
                </Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>طريقة الاستلام</Text>
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
                      {item === 'agent' ? 'عبر الوكيل' : 'محفظة USDT'}
                    </Text>
                    <Text style={styles.methodCardCaption}>
                      {item === 'agent' ? 'تحويل خارج التطبيق' : 'TRC20 / BEP20'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {method === 'usdt' ? (
              <>
                <Text style={styles.fieldLabel}>عنوان المحفظة</Text>
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
                <Text style={styles.fieldLabel}>الشبكة</Text>
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
                سيحوّل الوكيل المعتمد المبلغ إليك خارج التطبيق بعد موافقة الإدارة.
              </Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, loading && styles.disabled]} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.confirmText}>إرسال الطلب</Text>}
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
    return item.currency === 'diamond' ? 'تحويل إلى Coin (خصم Diamond)' : 'تحويل من Diamond (إضافة Coin)';
  }
  if (item.reference_type === 'diamond_withdrawal') {
    return item.amount > 0 ? 'إعادة رصيد Diamond بعد رفض السحب' : 'حجز Diamond للسحب';
  }
  if (item.type === 'gift_received' && item.currency === 'promo_dia') return 'Diamond من هدية';
  const labels: Record<string, string> = {
    deposit: 'شحن Coin',
    gift_sent: 'هدية مرسلة',
    gift_received: 'أرباح Diamond',
    withdraw: 'سحب سابق',
    transfer_out: 'تحويل صادر سابق',
    transfer_in: 'تحويل وارد سابق',
    bet: 'لعبة قديمة',
    win: 'ربح لعبة قديم',
    daily_bonus: 'مكافأة',
    referral_bonus: 'مكافأة إحالة',
    signup_bonus: 'مكافأة تسجيل',
    admin_adjustment: 'تسوية إدارية',
  };
  return labels[item.type] ?? item.type;
}

function getWithdrawalStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'طلب سحب قيد المراجعة',
    reviewing: 'طلب السحب قيد المعالجة',
    approved: 'تمت الموافقة على السحب',
    processing: 'جارٍ تنفيذ السحب',
    completed: 'تم تنفيذ السحب',
    rejected: 'رُفض الطلب وأعيد الرصيد',
    cancelled: 'تم إلغاء الطلب',
    failed: 'تعذر تنفيذ الطلب',
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
