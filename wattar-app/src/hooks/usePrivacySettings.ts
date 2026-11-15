/**
 * Wattar — هوك إعدادات الخصوصية (M1.6).
 * يستدعي RPCs المخزنة: get_my_privacy_settings / update_my_privacy_settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PrivacySettings, DEFAULT_PRIVACY_SETTINGS, toPrivacySettings } from '@/lib/privacy';

export function usePrivacySettings() {
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_my_privacy_settings');
      if (rpcError) throw rpcError;
      setSettings(toPrivacySettings((data ?? null) as Record<string, unknown> | null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل إعدادات الخصوصية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(async (patch: Partial<PrivacySettings>) => {
    try {
      const { error: rpcError } = await supabase.rpc('update_my_privacy_settings', {
        p_can_follow: patch.can_follow ?? null,
        p_can_message: patch.can_message ?? null,
        p_can_friend_request: patch.can_friend_request ?? null,
        p_can_view_stories: patch.can_view_stories ?? null,
        p_can_view_info: patch.can_view_info ?? null,
        p_can_enter_rooms: patch.can_enter_rooms ?? null,
      });
      if (rpcError) throw rpcError;
      setSettings((prev) => ({ ...prev, ...patch }));
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الخصوصية');
      return false;
    }
  }, []);

  return { settings, loading, error, update, reload: load };
}