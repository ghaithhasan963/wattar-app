/**
 * Wattar — تحميل الألعاب العامة (M9.4)
 * كل العرض (الاسم، الأيقونة، الحدود، الاحتمالات، العرض الترويجي، حالة
 * الإتاحة الجغرافية/العمرية) يأتي من get_public_games() على الخادم.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GameType, parsePublicGames, PublicGame } from '@/lib/gameConfig';

export function usePublicGames() {
  const [games, setGames] = useState<PublicGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_public_games');
      if (rpcError) throw rpcError;
      setGames(parsePublicGames(data));
    } catch (caught: unknown) {
      setGames([]);
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل الألعاب');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const find = useCallback(
    (type: GameType) => games.find((game) => game.game_type === type) ?? null,
    [games],
  );

  const available = useMemo(() => games.filter((game) => game.available), [games]);

  return { games, available, loading, error, reload, find };
}
