/**
 * Wattar Admin — صفحة الغرف الصوتية
 * مراقبة الغرف + محرر خيارات المقاعد + إجراءات الإدارة (عبر دالة admin_room_action)
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Mic, Users, X, Eye, Lock, Shield, Volume2, VolumeX, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, SectionCard, Badge } from '@/components/ui';

type RoomStatus = 'waiting' | 'live' | 'closed';

interface Room {
  id: string;
  name: string;
  seat_count: number;
  status: RoomStatus;
  listeners_count: number;
  speakers_count: number;
  is_private: boolean;
  category: string | null;
  has_password: boolean;
  seats_locked: boolean;
  audience_muted: boolean;
  second_admin_id: string | null;
  created_at: string;
  owner: { username: string; display_name: string | null } | null;
}

interface ModRow {
  id: string;
  user_id: string;
  user: { username: string; display_name: string | null } | null;
}

interface BanRow {
  id: string;
  user_id: string;
  user: { username: string; display_name: string | null } | null;
}

interface AuditRow {
  action: string;
  actor_role: string | null;
  created_at: string;
  reason: string | null;
  target_user_id: string | null;
  actor: { username: string; display_name: string | null } | null;
  target: { username: string; display_name: string | null } | null;
}

export function RoomsPage() {
  const profile = useAuthStore((state) => state.profile);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [seatOptions, setSeatOptions] = useState<number[]>([4, 8, 12, 16]);
  const [customOption, setCustomOption] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RoomStatus | 'all'>('all');
  const [managingRoom, setManagingRoom] = useState<Room | null>(null);
  const [managing, setManaging] = useState<string | null>(); // room id being actioned
  const [passwordMode, setPasswordMode] = useState<'set' | 'clear' | null>(null);
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    loadRooms();
    loadSeatOptions();
  }, [filter]);

  const loadRooms = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select(`
        id, name, seat_count, status, listeners_count, speakers_count,
        is_private, category, has_password, seats_locked, audience_muted,
        second_admin_id, created_at,
        owner:users!rooms_owner_id_fkey(username, display_name)
      `)
      .order('listeners_count', { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRooms(
      (((data ?? []) as any[]) as Room[]).map(r => ({
        ...r,
        owner: Array.isArray(r.owner) ? r.owner[0] ?? null : r.owner,
      })),
    );
  };

  const loadSeatOptions = async () => {
    const { data } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'room_seat_options')
      .maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (Array.isArray(value)) {
      const opts = value
        .map(v => (typeof v === 'number' ? v : Number(v)))
        .filter(n => Number.isInteger(n) && n >= 2 && n <= 16);
      if (opts.length > 0) setSeatOptions([...new Set(opts)].sort((a, b) => a - b));
    }
  };

  const saveSeatOptions = async () => {
    let next = [...seatOptions];
    const custom = Number(customOption);
    if (Number.isInteger(custom) && custom >= 2 && custom <= 16 && !next.includes(custom)) {
      next.push(custom);
      setCustomOption('');
    }
    next = [...new Set(next)].sort((a, b) => a - b);
    const { error } = await supabase
      .from('admin_settings')
      .update({ value: JSON.stringify(next) })
      .eq('key', 'room_seat_options');
    if (error) {
      toast.error(error.message);
    } else {
      setSeatOptions(next);
      toast.success('تم تحديث خيارات المقاعد');
    }
  };

  const toggleOption = (n: number) => {
    setSeatOptions(prev => (prev.includes(n) ? prev.filter(o => o !== n) : [...prev, n]));
  };

  const visibleRooms = rooms.filter(r => filter === 'all' || r.status === filter);

  const adminAction = async (
    roomId: string,
    action:
      | 'reopen_room'
      | 'force_close'
      | 'clear_password'
      | 'unban_user'
      | 'lock_seats'
      | 'unlock_seats'
      | 'mute_audience'
      | 'unmute_audience',
    targetUserId?: string,
  ) => {
    if (!profile) return;
    setManaging(roomId);
    try {
      const { error } = await supabase.rpc('admin_room_action', {
        p_admin_id: profile.id,
        p_room_id: roomId,
        p_action: action,
        p_target_user_id: targetUserId ?? null,
      });
      if (error) throw error;
      toast.success('تم تنفيذ الإجراء');
      loadRooms();
      if (managingRoom?.id === roomId) {
        void loadRoomDetail(roomId);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'فشل الإجراء');
    } finally {
      setManaging(null);
    }
  };

  // ------------------------------------------------------------------
  // Room detail modal (moderators / bans / audit / room-level actions)
  // ------------------------------------------------------------------
  const [mods, setMods] = useState<ModRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const loadRoomDetail = async (roomId: string) => {
    const [mRes, bRes, aRes] = await Promise.all([
      supabase.from('room_moderators').select('*, user:users(username, display_name)').eq('room_id', roomId),
      supabase.from('room_bans').select('*, user:users(username, display_name)').eq('room_id', roomId),
      supabase
        .from('room_moderation_audit')
        .select(
          `action, actor_role, created_at, reason, target_user_id,
           actor:users!room_moderation_audit_actor_id_fkey(username, display_name),
           target:users!room_moderation_audit_target_user_id_fkey(username, display_name)`,
        )
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (mRes.error || bRes.error || aRes.error) {
      toast.error((mRes.error ?? bRes.error ?? aRes.error)?.message);
      return;
    }
    setMods((mRes.data ?? []).map(r => ({ ...r, user: Array.isArray(r.user) ? r.user[0] ?? null : r.user })));
    setBans((bRes.data ?? []).map(r => ({ ...r, user: Array.isArray(r.user) ? r.user[0] ?? null : r.user })));
    setAudit(
      (aRes.data ?? []).map((r: any) => ({
        action: r.action,
        actor_role: r.actor_role,
        created_at: r.created_at,
        reason: r.reason,
        target_user_id: r.target_user_id,
        actor: r.actor?.[0] ?? null,
        target: r.target?.[0] ?? null,
      })),
    );
  };

  const openManage = (room: Room) => {
    setManagingRoom(room);
    void loadRoomDetail(room.id);
  };
  const closeManage = () => {
    setManagingRoom(null);
    setMods([]);
    setBans([]);
    setAudit([]);
    setPasswordMode(null);
    setPasswordInput('');
  };

  const setRoomPassword = async () => {
    if (!managingRoom) return;
    setManaging(managingRoom.id);
    try {
      const { error } = await supabase.rpc('admin_room_action', {
        p_admin_id: profile?.id,
        p_room_id: managingRoom.id,
        p_action: 'set_password',
        p_password: passwordInput.trim() || null,
      });
      if (error) throw error;
      setPasswordMode(null);
      setPasswordInput('');
      toast.success(passwordMode === 'clear' ? 'تمت إزالة كلمة المرور' : 'تم تعيين كلمة المرور');
      loadRooms();
      void loadRoomDetail(managingRoom.id);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'فشل تعيين كلمة المرور');
    } finally {
      setManaging(null);
    }
  };

  const unban = async (userId: string) => {
    if (!managingRoom) return;
    setManaging(managingRoom.id);
    try {
      const { error } = await supabase.rpc('admin_room_action', {
        p_admin_id: profile?.id,
        p_room_id: managingRoom.id,
        p_action: 'unban_user',
        p_target_user_id: userId,
      });
      if (error) throw error;
      toast.success('تم رفع الحظر');
      void loadRoomDetail(managingRoom.id);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'فشل رفع الحظر');
    } finally {
      setManaging(null);
    }
  };

  if (loading) return <p className="text-gray-400 dir-rtl">جاري التحميل...</p>;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="الغرف الصوتية" subtitle="مراقبة الغرف وتحرير خيارات المقاعد والإجراءات الإدارية" />

      <SectionCard title="خيارات المقاعد المتاحة" description="تُعرض هذه الخيارات عند إنشاء غرفة جديدة (من 2 إلى 16 مقعداً)">
        <div className="flex flex-wrap gap-2 mb-3">
          {[2, 4, 6, 8, 10, 12, 14, 16].map(n => (
            <button
              key={n}
              onClick={() => toggleOption(n)}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                seatOptions.includes(n)
                  ? 'bg-wattar-600 border-wattar-600 text-white'
                  : 'border-wattar-700 text-gray-400 hover:bg-wattar-900/50'
              }`}
            >
              {n} مقعد
            </button>
          ))}
          <div className="flex items-end gap-2">
            <input
              className="bg-dark-surface border border-wattar-800 rounded-md px-2 py-1.5 text-sm text-white w-16 text-right"
              type="number"
              min="2"
              max="16"
              value={customOption}
              onChange={e => setCustomOption(e.target.value)}
              placeholder="مخصص"
            />
            <button
              onClick={saveSeatOptions}
              className="px-3 py-1.5 rounded-md bg-wattar-600 text-white text-sm font-medium"
            >
              تطبيق
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          القيم الحالية: {seatOptions.join(', ')} مقعد. التغيير يسري على الغرف الجديدة فقط.
        </p>
      </SectionCard>

      <SectionCard title="الغرف" description={`${visibleRooms.length} غرفة`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-2">
            {(['all', 'waiting', 'live', 'closed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-sm transition ${
                  filter === f ? 'bg-wattar-600 text-white' : 'border border-wattar-700 text-gray-400 hover:bg-wattar-900/50'
                }`}
              >
                {f === 'all' ? 'الكل' : f === 'waiting' ? 'بانتظار' : f === 'live' ? 'مباشر' : 'مغلقة'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleRooms.length === 0 ? (
            <p className="col-span-3 text-gray-500 text-center py-8">لا توجد غرف</p>
          ) : (
            visibleRooms.map(room => (
              <div key={room.id} className="bg-dark-surface rounded-xl border border-wattar-900 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-white">{room.name}</p>
                    <p className="text-xs text-gray-500">
                      {room.owner?.display_name ?? room.owner?.username ?? '—'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      room.status === 'live' ? 'bg-green-500/10 text-green-400' :
                      room.status === 'waiting' ? 'bg-yellow-500/10 text-yellow-400' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>
                      {room.status === 'live' ? 'مباشر' : room.status === 'waiting' ? 'بانتظار' : 'مغلقة'}
                    </span>
                    {room.has_password && <Badge tone="danger">كلمة مرور</Badge>}
                    {room.seats_locked && <Badge tone="neutral">مقفل</Badge>}
                    {room.audience_muted && <Badge tone="neutral">جمهور مكتوم</Badge>}
                    {room.second_admin_id && <Badge tone="neutral">مدير ثاني</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                  <span className="flex items-center gap-1">
                    <Mic size={12} /> {room.speakers_count}/{room.seat_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={12} /> {room.listeners_count}
                  </span>
                  <span>{room.category ?? 'عام'}</span>
                </div>

                <div className="space-y-2">
                  {room.status === 'closed' ? (
                    <button
                      onClick={() => adminAction(room.id, 'reopen_room')}
                      disabled={managing === room.id}
                      className="w-full rounded-lg bg-green-600/20 hover:bg-green-600/30 border border-green-600/30 py-2 text-sm text-green-400 flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {managing === room.id ? <Loader2 size={14} className="mr-1.5" /> : <Eye size={14} />}
                      إعادة فتح الغرفة
                    </button>
                  ) : (
                    <button
                      onClick={() => adminAction(room.id, 'force_close')}
                      disabled={managing === room.id}
                      className="w-full rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 py-2 text-sm text-red-400 flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {managing === room.id ? <Loader2 size={14} className="mr-1.5" /> : <X size={14} />} إغلاق قسري
                    </button>
                  )}
                  <button
                    onClick={() => openManage(room)}
                    className="w-full rounded-lg border border-wattar-600 py-2 text-sm text-wattar-400 flex items-center justify-center gap-1"
                  >
                    <Shield size={14} /> إدارة الغرفة
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      {/* إدارة الغرفة */}
      {managingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeManage} />
          <div className="relative bg-dark-surface border border-wattar-800 rounded-xl p-6 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">إدارة الغرفة — {managingRoom.name}</h2>
              <button onClick={closeManage} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    adminAction(managingRoom!.id, managingRoom.seats_locked ? 'unlock_seats' : 'lock_seats')
                  }
                  disabled={managing === managingRoom.id}
                  className={`px-3 py-2 rounded-lg border text-sm transition ${
                    managing === managingRoom.id ? 'opacity-60' : 'border-wattar-600 text-wattar-400 hover:bg-wattar-900/50'
                  }`}
                >
                  {managingRoom.seats_locked ? 'فتح المقاعد' : 'قفل المقاعد'}
                </button>
                <button
                  onClick={() =>
                    adminAction(managingRoom!.id, managingRoom.audience_muted ? 'unmute_audience' : 'mute_audience')
                  }
                  disabled={managing === managingRoom.id}
                  className={`px-3 py-2 rounded-lg border text-sm transition ${
                    managing === managingRoom.id ? 'opacity-60' : 'border-wattar-600 text-wattar-400 hover:bg-wattar-900/50'
                  }`}
                >
                  {managingRoom.audience_muted ? 'إلغاء كتم الجمهور' : 'كتم الجمهور'}
                </button>
              </div>

              <div className="rounded-lg border border-wattar-800 p-3">
                <p className="text-xs text-gray-500 mb-2">كلمة مرور الغرفة</p>
                <div className="flex gap-2">
                  {passwordMode === null ? (
                    <>
                      <button
                        onClick={() => setPasswordMode(managingRoom.has_password ? 'clear' : 'set')}
                        className="flex-1 py-2 rounded-lg border border-wattar-600 text-sm text-wattar-400"
                      >
                        {managingRoom.has_password ? 'إزالة كلمة المرور' : 'تعيين كلمة مرور'}
                      </button>
                      {managingRoom.has_password && (
                        <button
                          onClick={() => setPasswordMode('set')}
                          className="flex-1 py-2 rounded-lg border border-wattar-600 text-sm text-wattar-400"
                        >
                          تغيير كلمة المرور
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        className="flex-1 bg-dark-surface border border-wattar-700 rounded-md px-2 py-2 text-sm text-white"
                        type="password"
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        placeholder={passwordMode === 'set' ? 'كلمة المرور الجديدة' : 'تأكيد الإزالة'}
                      />
                      <button
                        onClick={setRoomPassword}
                        disabled={managing === managingRoom.id || !passwordInput.trim()}
                        className="px-4 py-2 rounded-lg bg-wattar-600 text-white text-sm font-medium disabled:opacity-60"
                      >
                        {passwordMode === 'clear' ? 'تأكيد الإزالة' : 'تأكيد التعيين'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {managingRoom.status === 'closed' && (
                <button
                  onClick={() => adminAction(managingRoom.id, 'reopen_room')}
                  className="w-full py-2 rounded-lg bg-green-600/20 border border-green-600/30 text-sm text-green-400"
                >
                  إعادة فتح الغرفة
                </button>
              )}

              <div className="rounded-lg border border-wattar-800 p-3">
                <p className="text-xs font-semibold text-white mb-3">المشرفون ({mods.length})</p>
                {mods.length === 0 ? (
                  <p className="text-xs text-gray-500">لا يوجد مشرفون</p>
                ) : (
                  mods.map(m => (
                    <div key={m.user_id} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{m.user?.display_name ?? m.user?.username ?? '—'}</span>
                      <span className="bg-wattar-900/50 rounded px-2 py-0.5 text-xs">مشرف</span>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-lg border border-wattar-800 p-3">
                <p className="text-xs font-semibold text-white mb-3">المحظورون ({bans.length})</p>
                {bans.length === 0 ? (
                  <p className="text-xs text-gray-500">لا يوجد محظورون</p>
                ) : (
                  bans.map(b => (
                    <div key={b.user_id} className="flex items-center justify-between text-sm text-gray-300 mb-2 last:mb-0">
                      <span>{b.user?.display_name ?? b.user?.username ?? '—'}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => unban(b.user_id)}
                          disabled={managing === managingRoom.id}
                          className="px-2 py-1 rounded text-xs text-red-400 border border-red-600/30 hover:bg-red-600/20 disabled:opacity-60"
                        >
                          رفع الحظر
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-lg border border-wattar-800 p-3">
                <p className="text-xs font-semibold text-white mb-2">سجل التغييرات (آخر 30)</p>
                {audit.length === 0 ? (
                  <p className="text-xs text-gray-500">سجل فارغ</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    {audit.map(e => (
                      <div key={`${e.created_at}-${e.action}`} className="text-xs text-gray-300 mb-1 last:mb-0">
                        <span className="text-wattar-400">{e.action}</span>{' · '}
                        <span>{e.actor?.display_name ?? e.actor?.username ?? '—'}</span>
                        {e.reason && <span className="text-gray-500"> — {e.reason}</span>}
                        <span className="ml-2 text-gray-600">{new Date(e.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={closeManage} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
                إغلاق
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    );
  }

