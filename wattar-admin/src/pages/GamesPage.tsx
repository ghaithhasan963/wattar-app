/**
 * Wattar Admin — صفحة إعدادات الألعاب
 * ضبط RTP + حدود نقاط اللعب المجانية + تفعيل/إيقاف
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface GameConfig {
  id: string;
  game_type: string;
  is_enabled: boolean;
  default_rtp: number;
  min_bet_gold: number;
  max_bet_gold: number;
  max_multiplier: number;
}

const gameLabels: Record<string, string> = {
  wheel: 'عجلة الحظ',
  dice: 'نرد',
  aviator: 'طيارة المضاعفات',
  plinko: 'بلانغو',
};

export function GamesPage() {
  const [configs, setConfigs] = useState<GameConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('game_configs').select('*').order('game_type');
    setConfigs(data ?? []);
    setLoading(false);
  };

  const save = async (id: string) => {
    setSaving(id);
    const cfg = configs.find(c => c.id === id);
    if (!cfg) return;
    try {
      const { error } = await supabase
        .from('game_configs')
        .update({
          is_enabled: cfg.is_enabled,
          default_rtp: cfg.default_rtp,
          min_bet_gold: cfg.min_bet_gold,
          max_bet_gold: cfg.max_bet_gold,
          max_multiplier: cfg.max_multiplier,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('تم حفظ الإعدادات');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(null);
    }
  };

  const update = (id: string, field: keyof GameConfig, value: any) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">إعدادات الألعاب</h1>
        <p className="text-gray-400 mt-1">هذه الألعاب تستخدم نقاطًا مجانية منفصلة عن رصيد Coins وDiamonds.</p>
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : (
        <div className="grid gap-4">
          {configs.map(cfg => (
            <div key={cfg.id} className="bg-dark-surface rounded-xl border border-wattar-900 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">{gameLabels[cfg.game_type] ?? cfg.game_type}</h2>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cfg.is_enabled}
                    onChange={(e) => update(cfg.id, 'is_enabled', e.target.checked)}
                    className="w-4 h-4 accent-wattar-600"
                  />
                  <span className="text-gray-300">{cfg.is_enabled ? 'مفعّلة' : 'معطّلة'}</span>
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field
                  label="RTP الافتراضي (%)"
                  value={cfg.default_rtp}
                  onChange={(v) => update(cfg.id, 'default_rtp', v)}
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                />
                <Field
                  label="أقل نقاط للمشاركة"
                  value={cfg.min_bet_gold}
                  onChange={(v) => update(cfg.id, 'min_bet_gold', v)}
                  type="number"
                />
                <Field
                  label="أقصى نقاط للمشاركة"
                  value={cfg.max_bet_gold}
                  onChange={(v) => update(cfg.id, 'max_bet_gold', v)}
                  type="number"
                />
                <Field
                  label="المضاعف الأقصى (x)"
                  value={cfg.max_multiplier}
                  onChange={(v) => update(cfg.id, 'max_multiplier', v)}
                  type="number"
                  step="0.1"
                />
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => save(cfg.id)}
                  disabled={saving === cfg.id}
                  className="flex items-center gap-2 rounded-lg bg-wattar-600 hover:bg-wattar-700 px-4 py-2 text-white text-sm font-medium"
                >
                  {saving === cfg.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  حفظ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: number | string;
  onChange: (v: any) => void;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
}

function Field({ label, value, onChange, type = 'text', step, min, max }: FieldProps) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        step={step}
        min={min}
        max={max}
        className="w-full rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white text-sm"
      />
    </div>
  );
}
