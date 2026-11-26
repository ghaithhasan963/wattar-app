import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Headset, Loader2, RefreshCw, Send, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';
import { StaffRole, useAuthStore } from '@/store/auth';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'normal' | 'high';

interface SupportTicket {
  ticket_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  subject: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  assigned_name: string | null;
  created_at: string;
  updated_at: string;
  last_message: string;
}

interface TicketMessage {
  message_id: string;
  sender_id: string | null;
  sender_role: string;
  sender_name: string;
  body: string;
  created_at: string;
}

const statuses: Array<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'open', label: 'مفتوحة' },
  { value: 'in_progress', label: 'قيد المتابعة' },
  { value: 'resolved', label: 'تم الحل' },
  { value: 'closed', label: 'مغلقة' },
];

const categories: Record<string, string> = {
  account: 'الحساب',
  deposit: 'الشحن',
  withdrawal: 'السحب',
  technical: 'مشكلة تقنية',
  report: 'بلاغ',
  other: 'أخرى',
};

const statusNames: Record<TicketStatus, string> = {
  open: 'مفتوح',
  in_progress: 'قيد المتابعة',
  resolved: 'تم الحل',
  closed: 'مغلق',
};

const staffRoles: StaffRole[] = ['admin', 'super_admin', 'support'];

export function SupportPage() {
  const profile = useAuthStore((state) => state.profile);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [filter, setFilter] = useState<TicketStatus | 'all'>('open');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateStaff, setShowCreateStaff] = useState(false);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.ticket_id === selectedId) ?? null,
    [tickets, selectedId],
  );

  const loadQueue = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('list_support_queue', {
        p_status: filter === 'all' ? null : filter,
        p_limit: 100,
        p_offset: 0,
      });
      if (queryError) throw queryError;
      const rows = (data ?? []) as SupportTicket[];
      setTickets(rows);
      if (selectedId && !rows.some((ticket) => ticket.ticket_id === selectedId)) {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل طلبات الدعم.';
      setError(message);
      if (showLoader) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, selectedId]);

  const loadMessages = useCallback(async (ticketId: string) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('list_support_ticket_messages', {
        p_ticket_id: ticketId,
      });
      if (queryError) throw queryError;
      setMessages((data ?? []) as TicketMessage[]);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل رسائل الطلب.';
      setError(message);
      toast.error(message);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!selectedId || !body || sending) return;
    setSending(true);
    try {
      const { error: sendError } = await supabase.rpc('send_support_ticket_message', {
        p_ticket_id: selectedId,
        p_body: body,
      });
      if (sendError) throw sendError;
      setDraft('');
      await Promise.all([loadMessages(selectedId), loadQueue(false)]);
    } catch (sendError: unknown) {
      toast.error(sendError instanceof Error ? sendError.message : 'تعذر إرسال الرد.');
    } finally {
      setSending(false);
    }
  };

  const updateTicket = async (status: TicketStatus, priority: TicketPriority, assignedTo?: string | null) => {
    if (!selectedTicket || savingTicket) return;
    setSavingTicket(true);
    try {
      // Preserve an existing assignment: changing status/priority must never
      // silently reassign (or clear) a ticket that another agent owns.
      const nextAssignee = assignedTo === undefined
        ? selectedTicket.assigned_to ?? profile?.id ?? null
        : assignedTo;
      const { error: updateError } = await supabase.rpc('update_support_ticket', {
        p_ticket_id: selectedTicket.ticket_id,
        p_status: status,
        p_priority: priority,
        p_assigned_to: nextAssignee,
      });
      if (updateError) throw updateError;
      await loadQueue(false);
      toast.success('حُفظت حالة الطلب وأولويته.');
    } catch (updateError: unknown) {
      toast.error(updateError instanceof Error ? updateError.message : 'تعذر تحديث الطلب.');
    } finally {
      setSavingTicket(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-wattar-600/15 p-3 text-wattar-300"><Headset size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">مركز الدعم</h1>
            <p className="mt-1 text-sm text-gray-400">طلبات خاصة محفوظة مع سجل كامل للمراسلات.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              void loadQueue(false);
              if (selectedId) void loadMessages(selectedId);
            }}
            className="flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            تحديث
          </button>
          {profile?.role === 'admin' || profile?.role === 'super_admin' ? (
            <button
              type="button"
              onClick={() => setShowCreateStaff(true)}
              className="flex items-center gap-2 rounded-lg bg-wattar-600 px-3 py-2 text-sm font-semibold text-white hover:bg-wattar-700"
            >
              <UserPlus size={16} />
              حساب دعم
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {statuses.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
              filter === item.value
                ? 'border-wattar-500 bg-wattar-600/20 text-wattar-200'
                : 'border-wattar-900 text-gray-400 hover:text-gray-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      <div className="grid min-h-[65vh] gap-4 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden rounded-xl border border-wattar-900 bg-dark-surface">
          <div className="flex items-center justify-between border-b border-wattar-900 px-4 py-3">
            <h2 className="font-semibold text-white">قائمة الطلبات</h2>
            <span className="rounded-full bg-dark-elevated px-2 py-1 text-xs text-gray-300">{tickets.length}</span>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center p-8 text-gray-400"><Loader2 className="animate-spin" /></div>
            ) : tickets.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-500">لا توجد طلبات في هذا التصنيف.</p>
            ) : tickets.map((ticket) => (
              <button
                key={ticket.ticket_id}
                type="button"
                onClick={() => setSelectedId(ticket.ticket_id)}
                className={`w-full border-b border-wattar-900/70 p-4 text-right transition hover:bg-white/[0.03] ${
                  selectedId === ticket.ticket_id ? 'bg-wattar-600/10' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                    ticket.priority === 'high' ? 'bg-red-500/15 text-red-300' : 'bg-dark-elevated text-gray-300'
                  }`}>
                    {ticket.priority === 'high' ? 'أولوية عالية' : ticket.priority === 'low' ? 'منخفضة' : 'عادية'}
                  </span>
                  <span className="truncate text-sm font-semibold text-white">{ticket.subject}</span>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {ticket.display_name || ticket.username} · {categories[ticket.category] ?? 'أخرى'} · {statusNames[ticket.status]}
                </p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-500">{ticket.last_message}</p>
                <p className="mt-2 text-[10px] text-gray-600">{new Date(ticket.updated_at).toLocaleString('ar')}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="flex min-h-[65vh] flex-col overflow-hidden rounded-xl border border-wattar-900 bg-dark-surface">
          {selectedTicket ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-wattar-900 p-4">
                <div>
                  <h2 className="font-semibold text-white">{selectedTicket.subject}</h2>
                  <p className="mt-1 text-xs text-gray-400">
                    {selectedTicket.display_name || selectedTicket.username} · {categories[selectedTicket.category] ?? 'أخرى'}
                    {selectedTicket.assigned_name ? ` · مسند إلى ${selectedTicket.assigned_name}` : ' · غير مسند'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedTicket.status}
                    onChange={(event) => void updateTicket(event.target.value as TicketStatus, selectedTicket.priority)}
                    disabled={savingTicket}
                    className="rounded-lg border border-wattar-900 bg-dark-elevated px-2 py-2 text-xs text-white"
                    aria-label="حالة الطلب"
                  >
                    {statuses.filter((item) => item.value !== 'all').map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                  <select
                    value={selectedTicket.priority}
                    onChange={(event) => void updateTicket(selectedTicket.status, event.target.value as TicketPriority)}
                    disabled={savingTicket}
                    className="rounded-lg border border-wattar-900 bg-dark-elevated px-2 py-2 text-xs text-white"
                    aria-label="أولوية الطلب"
                  >
                    <option value="low">أولوية منخفضة</option>
                    <option value="normal">أولوية عادية</option>
                    <option value="high">أولوية عالية</option>
                  </select>
                  {selectedTicket.assigned_to !== profile?.id ? (
                    <button
                      type="button"
                      onClick={() => void updateTicket(selectedTicket.status, selectedTicket.priority, profile?.id ?? null)}
                      disabled={savingTicket || !profile?.id}
                      className="rounded-lg border border-wattar-500/30 bg-wattar-600/10 px-2.5 py-2 text-xs font-medium text-wattar-200 hover:bg-wattar-600/20 disabled:opacity-50"
                    >
                      تعيين لي
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void updateTicket(selectedTicket.status, selectedTicket.priority, null)}
                      disabled={savingTicket}
                      className="rounded-lg border border-wattar-900 px-2.5 py-2 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"
                    >
                      إلغاء التعيين
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {loadingMessages ? (
                  <div className="flex justify-center p-8 text-gray-400"><Loader2 className="animate-spin" /></div>
                ) : messages.map((message) => {
                  const staffMessage = staffRoles.includes(message.sender_role as StaffRole);
                  return (
                    <article
                      key={message.message_id}
                      className={`max-w-[85%] rounded-xl border p-3 ${
                        staffMessage ? 'mr-auto border-wattar-700/50 bg-wattar-900/20' : 'ml-auto border-white/10 bg-dark-elevated'
                      }`}
                    >
                      <div className="flex justify-between gap-4 text-[10px] text-gray-400">
                        <span>{message.sender_name}</span>
                        <time>{new Date(message.created_at).toLocaleString('ar')}</time>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-100">{message.body}</p>
                    </article>
                  );
                })}
              </div>
              <form onSubmit={sendReply} className="border-t border-wattar-900 p-3">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  maxLength={3000}
                  placeholder="اكتب ردًا واضحًا للمستخدم..."
                  className="w-full resize-y rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white placeholder:text-gray-500"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] text-gray-500">يظهر الرد للمستخدم مباشرة داخل التطبيق.</p>
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    إرسال الرد
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <Headset size={28} className="text-wattar-300" />
              <p className="mt-3 font-semibold text-white">اختر طلبًا للمتابعة</p>
              <p className="mt-1 text-xs text-gray-500">ستظهر تفاصيل المحادثة هنا.</p>
            </div>
          )}
        </section>
      </div>

      {showCreateStaff && <CreateSupportStaffModal onClose={() => setShowCreateStaff(false)} />}
    </div>
  );
}

function CreateSupportStaffModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    try {
      await callFunction('admin-create-support', {
        username,
        display_name: displayName || undefined,
        email,
        password,
      });
      toast.success('أُنشئ حساب الدعم بصلاحيات محدودة.');
      onClose();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء حساب الدعم.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-wattar-900 bg-dark-surface" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-wattar-900 p-5">
          <div>
            <h2 className="font-semibold text-white">إنشاء حساب دعم</h2>
            <p className="mt-1 text-xs text-gray-400">يصل إلى صندوق الدعم فقط، دون صلاحيات الإدارة المالية.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={19} className="text-gray-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <StaffInput label="اسم المستخدم" value={username} onChange={setUsername} minLength={3} maxLength={30} required />
          <StaffInput label="الاسم الظاهر" value={displayName} onChange={setDisplayName} maxLength={80} />
          <StaffInput label="البريد الإلكتروني" type="email" value={email} onChange={setEmail} required />
          <StaffInput label="كلمة مرور مؤقتة (12 حرفًا على الأقل)" type="password" value={password} onChange={setPassword} minLength={12} maxLength={128} required />
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-wattar-600 py-2.5 font-semibold text-white disabled:opacity-50">
            {loading && <Loader2 size={16} className="animate-spin" />}
            إنشاء الحساب
          </button>
        </form>
      </div>
    </div>
  );
}

function StaffInput({
  label,
  value,
  onChange,
  type = 'text',
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-gray-300">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-white"
        {...props}
      />
    </label>
  );
}
