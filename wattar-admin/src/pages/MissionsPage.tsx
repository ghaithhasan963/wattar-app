import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Toggle } from '@/components/ui';

type MissionEvent = 'daily_grant' | 'story_post' | 'gift_sent' | 'gift_received' | 'following';

interface DailyMission {
  id: string;
  mission_key: string;
  title: string;
  description: string;
  event_type: MissionEvent;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  is_enabled: boolean;
}

interface NewMission {
  mission_key: string;
  title: string;
  description: string;
  event_type: MissionEvent;
  target_count: string;
  reward_gold: string;
  reward_xp: string;
}

const eventLabels: Record<MissionEvent, string> = {
  daily_grant: 'استلام مكافأة الدخول اليومية',
  story_post: 'نشر قصة',
  gift_sent: 'إرسال هدية بـCoin',
  gift_received: 'استقبال هدية بـCoin',
  following: 'متابعة مستخدمين',
};

const emptyMission: NewMission = {
  mission_key: '',
  title: '',
  description: '',
  event_type: 'story_post',
  target_count: '1',
  reward_gold: '100',
  reward_xp: '10',
};

export function MissionsPage() {
  const [missions, setMissions] = useState<DailyMission[]>([]);
  const [form, setForm] = useState<NewMission>(emptyMission);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('daily_missions')
        .select('id, mission_key, title, description, event_type, target_count, reward_gold, reward_xp, is_enabled')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMissions((data ?? []) as DailyMission[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل المهمات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = (target: number, coins: number, xp: number) => (
    Number.isSafeInteger(target) && target >= 1 && target <= 100
    && Number.isSafeInteger(coins) && coins >= 0 && coins <= 100
    && Number.isSafeInteger(xp) && xp >= 0 && xp <= 1000
    && (coins > 0 || xp > 0)
  );

  const save = async (mission: DailyMission) => {
    if (!mission.title.trim() || !mission.description.trim()
      || !validate(mission.target_count, mission.reward_gold, mission.reward_xp)) {
      toast.error('تحقق من عنوان ووصف المهمة وحدود التقدم والمكافآت');
      return;
    }
    setSavingId(mission.id);
    try {
      const { error } = await supabase
        .from('daily_missions')
        .update({
          title: mission.title.trim(),
          description: mission.description.trim(),
          target_count: mission.target_count,
          reward_gold: mission.reward_gold,
          reward_xp: mission.reward_xp,
          is_enabled: mission.is_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mission.id);
      if (error) throw error;
      toast.success('تم حفظ المهمة وتسجيل التغيير في سجل الإدارة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ المهمة');
    } finally {
      setSavingId(null);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(form.target_count);
    const coins = Number(form.reward_gold);
    const xp = Number(form.reward_xp);
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(form.mission_key.trim())
      || !form.title.trim() || !form.description.trim() || !validate(target, coins, xp)) {
      toast.error('تحقق من المعرّف الإنجليزي والعنوان والوصف وحدود التقدم والمكافآت');
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from('daily_missions').insert({
        ...form,
        mission_key: form.mission_key.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        target_count: target,
        reward_gold: coins,
        reward_xp: xp,
      });
      if (error) throw error;
      setForm(emptyMission);
      await load();
      toast.success('تم إنشاء المهمة وتسجيل التغيير في سجل الإدارة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إنشاء المهمة');
    } finally {
      setCreating(false);
    }
  };

  const updateMission = (id: string, field: keyof DailyMission, value: string | number | boolean) => {
    setMissions((current) => current.map((mission) => mission.id === id
      ? { ...mission, [field]: value }
      : mission));
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">المهمات اليومية</h1>
        <p className="mt-1 text-sm text-gray-400">
          تُتحقق الأهداف من سجلات الخادم، ومكافآتها Coin مجانية (حتى 100 Coin للمهمة) وXP فقط؛ كل تعديل يُسجل إداريًا.
        </p>
      </div>

      <form onSubmit={create} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <h2 className="text-lg font-semibold text-white">إضافة مهمة</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="معرّف إنجليزي فريد" value={form.mission_key} onChange={(v) => setForm({ ...form, mission_key: v })} />
          <Input label="العنوان" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <Input label="الوصف" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <SelectEvent value={form.event_type} onChange={(v) => setForm({ ...form, event_type: v })} />
          <Input label="العدد المطلوب (1–100)" type="number" value={form.target_count} onChange={(v) => setForm({ ...form, target_count: v })} />
          <Input label="مكافأة Coin (0–100)" type="number" value={form.reward_gold} onChange={(v) => setForm({ ...form, reward_gold: v })} />
          <Input label="XP (0–1000)" type="number" value={form.reward_xp} onChange={(v) => setForm({ ...form, reward_xp: v })} />
        </div>
        <button disabled={creating} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          إنشاء المهمة
        </button>
      </form>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p>تعذر تحميل المهمات: {loadError}</p>
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : missions.length === 0 ? (
        <p className="text-gray-400">لا توجد مهمات في النظام.</p>
      ) : (
        <div className="grid gap-4">
          {missions.map((mission) => (
            <section key={mission.id} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">{mission.mission_key}</h2>
                  <p className="mt-1 text-xs text-gray-400">{eventLabels[mission.event_type]}</p>
                </div>
                <div className="w-full max-w-xs">
                  <Toggle
                    label="حالة المهمة"
                    description={mission.is_enabled ? 'مفعّلة وتُحتسب للمستخدمين' : 'معطّلة'}
                    checked={mission.is_enabled}
                    onChange={(checked) => updateMission(mission.id, 'is_enabled', checked)}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="العنوان" value={mission.title} onChange={(v) => updateMission(mission.id, 'title', v)} />
                <Input label="الوصف" value={mission.description} onChange={(v) => updateMission(mission.id, 'description', v)} />
                <Input label="العدد المطلوب" type="number" value={String(mission.target_count)} onChange={(v) => updateMission(mission.id, 'target_count', Number(v))} />
                <Input label="مكافأة Coin" type="number" value={String(mission.reward_gold)} onChange={(v) => updateMission(mission.id, 'reward_gold', Number(v))} />
                <Input label="XP" type="number" value={String(mission.reward_xp)} onChange={(v) => updateMission(mission.id, 'reward_xp', Number(v))} />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => void save(mission)}
                  disabled={savingId === mission.id}
                  className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {savingId === mission.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  حفظ
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-gray-400">
      {label}
      <input
        type={type}
        min={type === 'number' ? '0' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function SelectEvent({
  value,
  onChange,
}: {
  value: MissionEvent;
  onChange: (value: MissionEvent) => void;
}) {
  return (
    <label className="block text-xs text-gray-400">
      نوع الهدف
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as MissionEvent)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
      >
        {(Object.keys(eventLabels) as MissionEvent[]).map((eventType) => (
          <option key={eventType} value={eventType}>{eventLabels[eventType]}</option>
        ))}
      </select>
    </label>
  );
}
