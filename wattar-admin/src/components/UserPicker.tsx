/**
 * Wattar Admin — منتقي مستخدم بالبحث (بديل كتابة UUID أو الاسم يدوياً)
 * بحث مؤجَّل في users حسب الاسم/الهاتف، والنتيجة خيارات تُضغط بضغطة واحدة.
 */
import { useEffect, useState } from 'react';
import { Loader2, Search, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface PickedUser {
  id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  role?: string | null;
  status?: string | null;
}

export function UserPicker({
  label,
  description,
  value,
  onChange,
  placeholder = 'اكتب أول حرفين للبحث بالاسم أو الهاتف…',
  activeOnly = true,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  activeOnly?: boolean;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<PickedUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value) {
      setSearch('');
      setOptions([]);
      return;
    }
    const term = search.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        let query = supabase
          .from('users')
          .select('id, username, display_name, phone, role, status')
          .or(`username.ilike.%${term}%,display_name.ilike.%${term}%,phone.ilike.%${term}%`)
          .limit(7);
        if (activeOnly) query = query.eq('status', 'active');
        const { data, error } = await query;
        if (error) throw error;
        setOptions((data ?? []) as PickedUser[]);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, value, activeOnly]);

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-gray-200">{label}</p>
      {description ? <p className="mb-2 text-xs leading-5 text-gray-500">{description}</p> : null}
      {value ? (
        <div className="flex items-center justify-between rounded-xl border border-wattar-500/30 bg-wattar-600/10 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm text-white">
            <UserRound size={15} className="shrink-0 text-wattar-300" />
            <span className="truncate">
              {value.display_name ?? value.username}
              <span className="mr-2 text-xs text-gray-400">@{value.username}{value.phone ? ` · ${value.phone}` : ''}</span>
            </span>
          </span>
          <button type="button" disabled={disabled} onClick={() => onChange(null)} className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="إزالة الاختيار">
            <X size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={disabled}
              placeholder={placeholder}
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none disabled:opacity-50"
            />
            {searching ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500" /> : null}
          </div>
          {options.length > 0 && (
            <div className="mt-2 space-y-1 rounded-xl border border-white/[0.07] bg-[#111424] p-2">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(option)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-sm text-gray-200 hover:bg-white/[0.05] disabled:opacity-50"
                >
                  <span className="truncate">{option.display_name ?? option.username}</span>
                  <span className="shrink-0 text-xs text-gray-500">@{option.username}{option.phone ? ` · ${option.phone}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
