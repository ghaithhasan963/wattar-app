/**
 * Wattar Admin — صفحة الغرف الصوتية
 * مراقبة الغرف النشطة + إغلاق قسري
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Mic, Users, X, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface Room {
  id: string;
  name: string;
  seat_count: number;
  status: string;
  listeners_count: number;
  speakers_count: number;
  is_private: boolean;
  category: string | null;
  created_at: string;
  owner: { username: string; display_name: string | null } | null;
}

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'live' | 'all' | 'closed'>('live');

  useEffect(() => {
    load();
  }, [filter]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('rooms')
      .select(`
        id, name, seat_count, status, listeners_count, speakers_count,
        is_private, category, created_at,
        owner:users!rooms_owner_id_fkey(username, display_name)
      `)
      .order('listeners_count', { ascending: false })
      .limit(100);

    if (filter !== 'all') query = query.eq('status', filter);

    const { data } = await query;
    setRooms(((data ?? []) as any[]).map(r => ({
      ...r,
      owner: Array.isArray(r.owner) ? r.owner[0] ?? null : r.owner,
    })));
    setLoading(false);
  };

  const closeRoom = async (id: string) => {
    if (!confirm('هل تريد إغلاق هذه الغرفة قسريًا؟')) return;
    const { error } = await supabase
      .from('rooms')
      .update({ status: 'closed', ended_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('تم إغلاق الغرفة');
      load();
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">الغرف الصوتية</h1>
          <p className="text-gray-400 mt-1">مراقبة الغرف النشطة وإدارتها</p>
        </div>
        <div className="flex items-center gap-2 bg-dark-surface rounded-lg p-1 border border-wattar-900">
          {(['live', 'all', 'closed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm ${filter === f ? 'bg-wattar-600 text-white' : 'text-gray-400'}`}
            >
              {f === 'live' ? 'نشطة' : f === 'closed' ? 'مغلقة' : 'الكل'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-gray-400">جاري التحميل...</p>
        ) : rooms.length === 0 ? (
          <p className="text-gray-500">لا توجد غرف</p>
        ) : rooms.map(room => (
          <div key={room.id} className="bg-dark-surface rounded-xl border border-wattar-900 p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-medium text-white">{room.name}</p>
                <p className="text-xs text-gray-500">{room.owner?.display_name ?? room.owner?.username}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${
                room.status === 'live' ? 'bg-green-500/10 text-green-400' :
                room.status === 'waiting' ? 'bg-yellow-500/10 text-yellow-400' :
                'bg-gray-500/10 text-gray-400'
              }`}>
                {room.status === 'live' ? 'مباشر' : room.status === 'waiting' ? 'بانتظار' : 'مغلقة'}
              </span>
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

            {room.status !== 'closed' && (
              <button
                onClick={() => closeRoom(room.id)}
                className="w-full rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 py-2 text-sm text-red-400 flex items-center justify-center gap-1"
              >
                <X size={14} /> إغلاق قسري
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
