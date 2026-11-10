import React, { useCallback, useEffect, useState } from 'react';
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
import { ArrowDownToLine, History, ShieldCheck } from 'lucide-react-native';
import { supabase, callFunction, uploadPrivateMedia } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { CurrencyIcon } from '@/components/CurrencyIcon';

type DepositMethodCode = 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';

interface WalletAccess {
  allowed: boolean;
  agent_id: string | null;
  agent_name: string | null;
  group_id: string | null;
  group_name: string | null;
}

interface WalletOptions {
  diamonds_per_usd: number;
  withdrawals_enabled: boolean;
  min_withdrawal_diamonds: number;
  has_assigned_agent: boolean;
}

interface DepositMethod {
  method: DepositMethodCode;
  name_ar: string;
  instructions: string;
  min_amount_usd: number;
  max_amount_usd: number;
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
  background: '#090611',
  surface: '#171128',
  elevated: '#211638',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  gold: '#F4BD55',
  success: '#43D69A',
  danger: '#FF718E',
} as const;

export default function WalletScreen() {
  const { profile, loadProfile } = useAuthStore();
  const [access, setAccess] = useState<WalletAccess | null>(null);
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [withdrawalVisible, setWithdrawalVisible] = useState(false);
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

  const coinBalance = profile?.balance_gold ?? 0;
  const diamondBalance = profile?.balance_diamond ?? 0;
  const pointBalance = profile?.game_points ?? 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadWallet()} tintColor={palette.gold} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>المحفظة</Text>
          <Text style={styles.subtitle}>أرصدة واضحة ومعاملات موثّقة</Text>
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

            <View style={styles.balances}>
              <View style={[styles.balanceCard, styles.pointCard]}>
                <View style={styles.balanceHeader}>
                  <CurrencyIcon currency="point" size={31} />
                  <Text style={styles.balanceLabel}>Point</Text>
                </View>
                <Text style={styles.pointValue}>{pointBalance.toLocaleString()}</Text>
                <Text style={styles.balanceHint}>للألعاب فقط · مجانية</Text>
              </View>
              <View style={[styles.balanceCard, styles.coinsCard]}>
                <View style={styles.balanceHeader}>
                  <CurrencyIcon currency="coin" size={31} />
                  <Text style={styles.balanceLabel}>Coin</Text>
                </View>
                <Text style={styles.coinValue}>{coinBalance.toLocaleString()}</Text>
                <Text style={styles.balanceHint}>للشحن والهدايا والخدمات</Text>
              </View>
              <View style={[styles.balanceCard, styles.diamondsCard]}>
                <View style={styles.balanceHeader}>
                  <CurrencyIcon currency="diamond" size={31} />
                  <Text style={styles.balanceLabel}>Diamond</Text>
                </View>
                <Text style={styles.diamondValue}>{diamondBalance.toLocaleString()}</Text>
                <Text style={styles.balanceHint}>أرباح الهدايا · السحب حسب الإتاحة</Text>
              </View>
            </View>

            <View style={styles.walletNotice}>
              <Text style={styles.walletNoticeTitle}>ثلاث عملات، لكل واحدة استخدام واضح</Text>
              <Text style={styles.walletNoticeText}>
                Point للألعاب فقط، وCoin للشحن والهدايا والخدمات، وDiamond لأرباح الهدايا. لا يوجد تحويل بين أرصدة الألعاب والمحفظة.
              </Text>
            </View>

            <View style={styles.walletActions}>
              {walletOptions?.withdrawals_enabled && Number(walletOptions.diamonds_per_usd) > 0 ? (
                <TouchableOpacity
                  style={[styles.secondaryAction, diamondBalance < Number(walletOptions.min_withdrawal_diamonds) && styles.disabled]}
                  onPress={() => setWithdrawalVisible(true)}
                  disabled={diamondBalance < Number(walletOptions.min_withdrawal_diamonds)}
                >
                  <ArrowDownToLine size={17} color={palette.success} />
                  <Text style={styles.secondaryActionText}>طلب سحب Diamond</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              style={[styles.depositButton, !methods.length && styles.disabled]}
              onPress={() => setModalVisible(true)}
              disabled={!methods.length}
              accessibilityRole="button"
            >
              <ArrowDownToLine size={19} color="#FFFFFF" />
              <Text style={styles.depositButtonText}>
                {methods.length ? 'طلب شحن يدوي' : 'الشحن غير متاح حاليًا'}
              </Text>
            </TouchableOpacity>

            {!methods.length ? (
              <Text style={styles.emptyMethods}>لم تفعّل الإدارة وسائل شحن حاليًا.</Text>
            ) : null}

            {withdrawals.length ? (
              <View style={styles.historyCard}>
                <View style={styles.historyHeading}>
                  <ArrowDownToLine size={17} color={palette.success} />
                  <Text style={styles.historyTitle}>طلبات السحب</Text>
                </View>
                {withdrawals.map((withdrawal) => (
                  <View key={withdrawal.id} style={styles.transactionRow}>
                    <View style={styles.transactionInfo}>
                      <Text style={styles.transactionType}>{getWithdrawalStatus(withdrawal.status)}</Text>
                      <Text style={styles.transactionDate}>{new Date(withdrawal.created_at).toLocaleString('ar')}</Text>
                    </View>
                    <Text style={styles.transactionAmount}>
                      {Number(withdrawal.amount_diamond).toLocaleString()} Diamond
                    </Text>
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
                    const positive = item.amount > 0;
                    const currency = item.currency === 'diamond' || item.currency === 'promo_dia'
                      ? 'Diamond'
                      : 'Coin';
                    return (
                      <View style={styles.transactionRow}>
                        <View style={styles.transactionInfo}>
                          <Text style={styles.transactionType}>
                            {item.reference_type === 'conversion'
                              ? 'تحويل قديم بين العملات'
                              : item.reference_type === 'diamond_withdrawal' && item.amount > 0
                                ? 'إعادة رصيد Diamond بعد رفض السحب'
                                : item.reference_type === 'diamond_withdrawal'
                                  ? 'حجز Diamond للسحب'
                                : item.type === 'gift_received' && item.currency === 'promo_dia'
                              ? 'Diamond من هدية'
                              : getTransactionLabel(item.type)}
                          </Text>
                          <Text style={styles.transactionDate}>{new Date(item.created_at).toLocaleString('ar')}</Text>
                        </View>
                        <Text style={[styles.transactionAmount, { color: positive ? palette.success : palette.danger }]}>
                          {positive ? '+' : ''}{item.amount.toLocaleString()} {currency}
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
          onClose={() => setModalVisible(false)}
          onSuccess={async () => {
            await loadWallet();
          }}
        />
      ) : null}
      {access && walletOptions?.withdrawals_enabled ? (
        <WithdrawalModal
          visible={withdrawalVisible}
          balance={diamondBalance}
          minimum={Number(walletOptions.min_withdrawal_diamonds)}
          rate={Number(walletOptions.diamonds_per_usd)}
          hasAgent={walletOptions.has_assigned_agent}
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
  onClose,
  onSuccess,
}: {
  visible: boolean;
  methods: DepositMethod[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { profile } = useAuthStore();
  const [methodCode, setMethodCode] = useState<DepositMethodCode | null>(methods[0]?.method ?? null);
  const [amount, setAmount] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);
  const selectedMethod = methods.find((method) => method.method === methodCode) ?? methods[0] ?? null;

  useEffect(() => {
    if (!selectedMethod || !methods.some((method) => method.method === methodCode)) {
      setMethodCode(methods[0]?.method ?? null);
    }
  }, [methodCode, methods, selectedMethod]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  const submit = async () => {
    const numericAmount = Number(amount);
    if (!selectedMethod || !Number.isFinite(numericAmount)
      || numericAmount < Number(selectedMethod.min_amount_usd)
      || numericAmount > Number(selectedMethod.max_amount_usd)
      || !externalRef.trim() || !image) {
      Alert.alert('راجع البيانات', `أدخل مبلغًا بين $${selectedMethod?.min_amount_usd ?? 1} و$${selectedMethod?.max_amount_usd ?? 2000}، ورقم العملية وصورة الإثبات.`);
      return;
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
            <Text style={styles.modalTitle}>طلب شحن Coin</Text>
            <Text style={styles.modalSubtitle}>اختر وسيلة الدفع واتبع تعليمات الوكيل</Text>

            <Text style={styles.fieldLabel}>وسيلة الشحن</Text>
            <View style={styles.methods}>
              {methods.map((method) => (
                <TouchableOpacity
                  key={method.method}
                  style={[styles.methodButton, selectedMethod?.method === method.method && styles.methodButtonActive]}
                  onPress={() => setMethodCode(method.method)}
                  disabled={loading}
                >
                  <Text style={[styles.methodText, selectedMethod?.method === method.method && styles.methodTextActive]}>
                    {method.name_ar}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedMethod?.instructions ? (
              <View style={styles.instructions}>
                <Text style={styles.instructionsTitle}>تعليمات الدفع</Text>
                <Text style={styles.instructionsText}>{selectedMethod.instructions}</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>المبلغ بالدولار</Text>
            <TextInput
              style={styles.inputField}
              value={amount}
              onChangeText={setAmount}
              placeholder={`من ${selectedMethod?.min_amount_usd ?? 1}`}
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              editable={!loading}
            />

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
                {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>إرسال الطلب</Text>}
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
  rate,
  hasAgent,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  balance: number;
  minimum: number;
  rate: number;
  hasAgent: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<DepositMethodCode>(hasAgent ? 'agent' : 'usdt');
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (method === 'agent' && !hasAgent) setMethod('usdt');
  }, [hasAgent, method]);

  const submit = async () => {
    const diamonds = Number(amount);
    if (!Number.isSafeInteger(diamonds) || diamonds < minimum || diamonds > balance) {
      Alert.alert('راجع المبلغ', `أدخل عددًا صحيحًا بين ${minimum.toLocaleString()} و${balance.toLocaleString()} Diamond.`);
      return;
    }
    if (method === 'usdt' && (!address.trim() || !network.trim())) {
      Alert.alert('بيانات ناقصة', 'أدخل عنوان المحفظة وشبكة USDT.');
      return;
    }
    if ((method === 'sham_cash' || method === 'syriatel_cash') && !phone.trim()) {
      Alert.alert('بيانات ناقصة', 'أدخل رقم الهاتف المستلم.');
      return;
    }

    const payoutDetails = method === 'usdt'
      ? { address: address.trim(), network: network.trim() }
      : method === 'agent' ? {} : { phone: phone.trim() };
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

  const methods: DepositMethodCode[] = hasAgent
    ? ['agent', 'usdt', 'sham_cash', 'syriatel_cash']
    : ['usdt', 'sham_cash', 'syriatel_cash'];
  const estimateUsd = Number(amount) > 0 && rate > 0 ? Number(amount) / rate : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>سحب Diamond</Text>
            <Text style={styles.modalSubtitle}>
              الحد الأدنى {minimum.toLocaleString()} · السعر التقديري ${estimateUsd.toFixed(2)} قبل الرسوم
            </Text>
            <Text style={styles.fieldLabel}>عدد Diamond · رصيدك {balance.toLocaleString()}</Text>
            <TextInput
              style={styles.inputField}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder="أدخل المبلغ"
              placeholderTextColor={palette.muted}
              editable={!loading}
            />
            <Text style={styles.fieldLabel}>طريقة الاستلام</Text>
            <View style={styles.methods}>
              {methods.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.methodButton, method === item && styles.methodButtonActive]}
                  onPress={() => setMethod(item)}
                  disabled={loading}
                >
                  <Text style={[styles.methodText, method === item && styles.methodTextActive]}>
                    {item === 'agent' ? 'الوكيل' : item === 'usdt' ? 'USDT' : item === 'sham_cash' ? 'شام كاش' : 'سيريتل كاش'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {method === 'usdt' ? (
              <>
                <Text style={styles.fieldLabel}>عنوان المحفظة</Text>
                <TextInput style={styles.inputField} value={address} onChangeText={setAddress} autoCapitalize="none" editable={!loading} />
                <Text style={styles.fieldLabel}>الشبكة</Text>
                <TextInput style={styles.inputField} value={network} onChangeText={setNetwork} editable={!loading} />
              </>
            ) : method !== 'agent' ? (
              <>
                <Text style={styles.fieldLabel}>رقم الهاتف المستلم</Text>
                <TextInput style={styles.inputField} value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!loading} />
              </>
            ) : (
              <Text style={styles.instructionsText}>سيحوّل الوكيل المعتمد المبلغ إليك خارج التطبيق.</Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, loading && styles.disabled]} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>إرسال الطلب</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function getTransactionLabel(type: string): string {
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
  return labels[type] ?? type;
}

function getWithdrawalStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'طلب سحب قيد المراجعة',
    reviewing: 'طلب السحب قيد المعالجة',
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
  header: { paddingTop: 58, paddingBottom: 20 },
  title: { color: palette.text, fontSize: 25, fontWeight: '800', textAlign: 'right' },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 5, textAlign: 'right' },
  error: { color: palette.danger, fontSize: 12, textAlign: 'center', marginBottom: 12 },
  gateCard: { alignItems: 'center', padding: 22, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginTop: 18 },
  gateIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#302312', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  gateTitle: { color: palette.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  gateText: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  agentNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#143027', borderRadius: 14, marginBottom: 13 },
  agentNoticeText: { color: palette.success, fontSize: 12, fontWeight: '700' },
  balances: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  balanceCard: { width: '31.5%', minHeight: 132, padding: 10, borderRadius: 19, backgroundColor: palette.surface, borderWidth: 1 },
  pointCard: { borderColor: '#6848A2' },
  coinsCard: { borderColor: '#725224' },
  diamondsCard: { borderColor: '#285D56' },
  balanceHeader: { alignItems: 'flex-end', gap: 6 },
  balanceLabel: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  pointValue: { color: '#C4A5FF', fontSize: 17, fontWeight: '800', marginTop: 8, textAlign: 'right' },
  coinValue: { color: palette.gold, fontSize: 17, fontWeight: '800', marginTop: 8, textAlign: 'right' },
  diamondValue: { color: '#72DCCA', fontSize: 17, fontWeight: '800', marginTop: 8, textAlign: 'right' },
  balanceHint: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 6, textAlign: 'right' },
  walletNotice: { padding: 15, marginTop: 12, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  walletNoticeTitle: { color: palette.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  walletNoticeText: { color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 5, textAlign: 'right' },
  walletActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  secondaryAction: { flexGrow: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  secondaryActionText: { color: palette.text, fontSize: 11, fontWeight: '700' },
  depositButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 52, marginTop: 13, borderRadius: 15, backgroundColor: palette.primary },
  depositButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  emptyMethods: { color: palette.muted, fontSize: 11, textAlign: 'center', marginTop: 9 },
  historyCard: { padding: 15, marginTop: 17, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  historyHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  historyTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
  separator: { height: 1, backgroundColor: palette.border },
  transactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  transactionInfo: { flex: 1 },
  transactionType: { color: palette.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  transactionDate: { color: palette.muted, fontSize: 10, marginTop: 4, textAlign: 'right' },
  transactionAmount: { fontSize: 12, fontWeight: '700', textAlign: 'left', marginLeft: 12 },
  emptyHistory: { color: palette.muted, fontSize: 12, textAlign: 'center', paddingVertical: 18 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  modalScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  modalCard: { padding: 22, paddingBottom: 30, backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: palette.border },
  modalTitle: { color: palette.text, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  modalSubtitle: { color: palette.muted, fontSize: 12, marginTop: 5, marginBottom: 15, textAlign: 'right' },
  fieldLabel: { color: palette.text, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 7, textAlign: 'right' },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  methodButtonActive: { backgroundColor: '#402256', borderColor: palette.primary },
  methodText: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  methodTextActive: { color: '#FFFFFF' },
  instructions: { padding: 12, marginTop: 12, borderRadius: 13, backgroundColor: '#302312', borderWidth: 1, borderColor: '#725224' },
  instructionsTitle: { color: palette.gold, fontSize: 11, fontWeight: '800', textAlign: 'right' },
  instructionsText: { color: palette.text, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'right' },
  inputField: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border, color: palette.text, textAlign: 'right', fontSize: 13 },
  proofPicker: { minHeight: 92, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: palette.elevated },
  proofPreview: { width: '100%', height: 145, resizeMode: 'cover' },
  proofText: { color: palette.muted, fontSize: 12 },
  modalActions: { flexDirection: 'row', gap: 9, marginTop: 18 },
  cancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.elevated },
  cancelText: { color: palette.muted, fontSize: 13, fontWeight: '700' },
  confirmButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.primary },
  confirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
