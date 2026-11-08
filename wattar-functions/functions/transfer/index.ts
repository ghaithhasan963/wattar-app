import { jsonResponse } from '../_shared/supabase.ts';

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  return jsonResponse({
    error: 'FEATURE_DISABLED',
    message: 'Coins cannot be transferred between users.',
  }, 410);
});
