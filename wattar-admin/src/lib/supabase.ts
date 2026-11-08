/**
 * Wattar Admin — عميل Supabase المشترك
 * @version 1.0.0
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'wattar-admin-auth',
    },
  },
);

// مساعد استدعاء Edge Function
export async function callFunction<T = unknown>(
  name: string,
  body: unknown,
  options: { method?: 'POST' | 'GET'; idempotencyKey?: string } = {},
): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Edge function failed');
  }

  return data as T;
}
