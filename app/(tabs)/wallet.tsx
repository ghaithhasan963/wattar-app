/**
 * Wattar App — صفحة المحفظة
 * الرصيد + شحن + سحب + تحويل + سجل المعاملات
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput, ScrollView, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase, callFunction, uploadImage } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, History } from 'lucide-react-native';

export default function WalletScreen() {
  const { profile, loadProfile } = useAuthStore();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [modal, setModal] = useState<'deposit' | 'withdraw' | 'transfer' | null>(null);

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    const { data } = await supabase
      .from('wallet_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setTransactions(data ?? []);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>رصيدك الحالي</Text>
        <Text style={styles.balanceGold}>{profile?.balance_gold?.toLocaleString()}</Text>
        <Text style={styles.balanceUnit}>ذهب</Text>
        <View style={styles.diamondRow}>
          <Text style={styles.diamondValue}>{profile?.balance_diamond} جوهرة</Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <ActionBtn icon={ArrowDownToLine} label="شحن" color="#10B981" onPress={() => setModal('deposit')} />
        <ActionBtn icon={ArrowUpFromLine} label="سحب" color="#EF4444" onPress={() => setModal('withdraw')} />
        <ActionBtn icon={ArrowLeftRight} label="تحويل" color="#7C3AED" onPress={() => setModal('transfer')} />
      </View>

      <View style={styles.historySection}>
        <View style={styles.historyHeader}>
          <History size={16} color={colors.textSecondary} />
          <Text style={styles.historyTitle}>آخر المعاملات</Text>
        </View>

        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#252540' }} />}
          renderItem={({ item }) => (
            <View style={styles.txItem}>
              <View>
                <Text style={styles.txType}>{getTxLabel(item.type)}</Text>
                <Text style={styles.txDate}>{new Date(item.created_at).toLocaleString('ar-EG')}</Text>
              </View>
              <Text style={[
                styles.txAmount,
                { color: item.amount > 0 ? '#10B981' : '#EF4444' }
              ]}>
                {item.amount > 0 ? '+' : ''}{item.amount} {item.currency === 'gold' ? 'ذهب' : 'جوهرة'}
              </Text>
            </View>
          )}
        />
      </View>

      {modal === 'deposit' && (
        <DepositModal onClose={() => setModal(null)} onSuccess={() => { loadProfile(); loadTransactions(); }} />
      )}
      {modal === 'withdraw' && (
        <WithdrawModal onClose={() => setModal(null)} onSuccess={() => { loadProfile(); loadTransactions(); }} />
      )}
      {modal === 'transfer' && (
        <TransferModal onClose={() => setModal(null)} onSuccess={() => { loadProfile(); loadTransactions(); }} />
      )}
    </ScrollView>
  );
}

function ActionBtn({ icon: Icon, label, color, onPress }: any) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress}>
      <View style={[styles.actionIcon, { backgroundColor: color + '20' }]}>
        <Icon size={20} color={color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function DepositModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [method, setMethod] = useState<'usdt' | 'sham_cash' | 'syriatel_cash'>('usdt');
  const [amount, setAmount] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  const handleSubmit = async () => {
    if (!amount || !externalRef || !image) {
      Alert.alert('تنبيه', 'يرجى ملء جميع الحقول ورفع صورة الإثبات');
      return;
    }
    setLoading(true);
    try {
      // رفع الصورة
      const proofUrl = await uploadImage(image, 'deposit-proofs', `dep_${Date.now()}`);

      await callFunction('deposit-request', {
        method,
        amount_usd: Number(amount),
        external_ref: externalRef,
        proof_url: proofUrl,
      });
      Alert.alert('تم', 'تم استلام طلب الشحن، سيتم مراجعته خلال دقائق');
      onSuccess();
      onClose();
    } catch (err: any) {
      Alert.alert('خطأ', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>شحن الرصيد</Text>

          <Text style={styles.modalLabel}>طريقة الشحن</Text>
          <View style={styles.methodRow}>
            {[
              { id: 'usdt', label: 'USDT' },
              { id: 'sham_cash', label: 'شام كاش' },
              { id: 'syriatel_cash', label: 'سيرياتيل' },
            ].map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.methodBtn, method === m.id && styles.methodBtnActive]}
                onPress={() => setMethod(m.id as any)}
              >
                <Text style={[styles.methodText, method === m.id && styles.methodTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.modalLabel}>المبلغ بالدولار ($)</Text>
          <TextInput
            style={styles.modalInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="10"
            keyboardType="numeric"
            placeholderTextColor="#666"
          />

          <Text style={styles.modalLabel}>رقم العملية / الحوالة</Text>
          <TextInput
            style={styles.modalInput}
            value={externalRef}
            onChangeText={setExternalRef}
            placeholder="1234567890"
            placeholderTextColor="#666"
          />

          <Text style={styles.modalLabel}>صورة إثبات التحويل</Text>
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
            {image ? (
              <Image source={{ uri: image }} style={styles.imagePreview} />
            ) : (
              <Text style={styles.imagePickerText}>اضغط لرفع الصورة</Text>
            )}
          </TouchableOpacity>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? 'جاري...' : 'إرسال الطلب'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WithdrawModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'usdt' | 'sham_cash' | 'syriatel_cash'>('usdt');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!amount) return Alert.alert('تنبيه', 'أدخل المبلغ');
    setLoading(true);
    try {
      await callFunction('withdrawal-request', {
        amount_gold: Number(amount),
        method,
        usdt_address: method === 'usdt' ? address : undefined,
        usdt_network: method === 'usdt' ? 'TRC20' : undefined,
        sham_cash_phone: method === 'sham_cash' ? phone : undefined,
        syriatel_phone: method === 'syriatel_cash' ? phone : undefined,
      });
      Alert.alert('تم', 'تم استلام طلب السحب، سيتم معالجته خلال 24 ساعة');
      onSuccess();
      onClose();
    } catch (err: any) {
      Alert.alert('خطأ', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>سحب الرصيد</Text>

          <Text style={styles.modalLabel}>المبلغ بالذهب</Text>
          <TextInput
            style={styles.modalInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="10000"
            keyboardType="numeric"
            placeholderTextColor="#666"
          />

          <Text style={styles.modalLabel}>طريقة الاستلام</Text>
          <View style={styles.methodRow}>
            {[
              { id: 'usdt', label: 'USDT' },
              { id: 'sham_cash', label: 'شام كاش' },
              { id: 'syriatel_cash', label: 'سيرياتيل' },
            ].map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.methodBtn, method === m.id && styles.methodBtnActive]}
                onPress={() => setMethod(m.id as any)}
              >
                <Text style={[styles.methodText, method === m.id && styles.methodTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {method === 'usdt' ? (
            <>
              <Text style={styles.modalLabel}>عنوان USDT (TRC20)</Text>
              <TextInput
                style={styles.modalInput}
                value={address}
                onChangeText={setAddress}
                placeholder="T..."
                placeholderTextColor="#666"
              />
            </>
          ) : (
            <>
              <Text style={styles.modalLabel}>رقم الهاتف</Text>
              <TextInput
                style={styles.modalInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="+9639XXXXXXXX"
                keyboardType="phone-pad"
                placeholderTextColor="#666"
              />
            </>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? 'جاري...' : 'إرسال الطلب'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TransferModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!recipient || !amount) return Alert.alert('تنبيه', 'أدخل المستلم والمبلغ');
    setLoading(true);
    try {
      await callFunction('transfer', {
        to_username: recipient,
        amount_gold: Number(amount),
        note: note || undefined,
      });
      Alert.alert('تم', `تم تحويل ${amount} ذهب بنجاح`);
      onSuccess();
      onClose();
    } catch (err: any) {
      Alert.alert('خطأ', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>تحويل ذهب</Text>

          <Text style={styles.modalLabel}>اسم المستخدم المستلم</Text>
          <TextInput
            style={styles.modalInput}
            value={recipient}
            onChangeText={setRecipient}
            placeholder="username"
            placeholderTextColor="#666"
          />

          <Text style={styles.modalLabel}>الكمية (ذهب)</Text>
          <TextInput
            style={styles.modalInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="100"
            keyboardType="numeric"
            placeholderTextColor="#666"
          />

          <Text style={styles.modalLabel}>ملاحظة (اختياري)</Text>
          <TextInput
            style={styles.modalInput}
            value={note}
            onChangeText={setNote}
            placeholder="هدية..."
            placeholderTextColor="#666"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? 'جاري...' : 'تحويل'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getTxLabel(type: string): string {
  const labels: Record<string, string> = {
    deposit: 'شحن',
    withdraw: 'سحب',
    transfer_out: 'تحويل صادر',
    transfer_in: 'تحويل وارد',
    bet: 'رهان',
    win: 'ربح',
    gift_sent: 'هدية مرسلة',
    gift_received: 'هدية مستلمة',
    daily_bonus: 'مكافأة يومية',
    referral_bonus: 'مكافأة إحالة',
    signup_bonus: 'مكافأة تسجيل',
    admin_adjustment: 'تعديل إداري',
  };
  return labels[type] ?? type;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 104 },
  balanceCard: {
    margin: 16, marginTop: 60,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  balanceLabel: { color: colors.textSecondary, fontSize: 13 },
  balanceGold: { color: colors.gold, fontSize: 48, fontWeight: 'bold', marginTop: 8 },
  balanceUnit: { color: colors.textSecondary, fontSize: 14 },
  diamondRow: { marginTop: 8 },
  diamondValue: { color: colors.teal, fontSize: 14 },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: colors.text, fontSize: 13, marginTop: 8 },
  historySection: { margin: 16, backgroundColor: colors.surface, borderRadius: 14, padding: 16 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  historyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  txItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  txType: { color: colors.text, fontSize: 14 },
  txDate: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  modalLabel: { color: colors.textSecondary, fontSize: 13, marginBottom: 4, marginTop: 12 },
  modalInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  methodRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  methodBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  methodBtnActive: { backgroundColor: colors.primary },
  methodText: { color: colors.textSecondary, fontSize: 13 },
  methodTextActive: { color: '#fff', fontWeight: '600' },
  imagePicker: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  imagePickerText: { color: colors.textSecondary },
  imagePreview: { width: '100%', height: '100%', borderRadius: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 20 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.surfaceMuted, alignItems: 'center' },
  cancelBtnText: { color: colors.textSecondary, fontSize: 15 },
  submitBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
