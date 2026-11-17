-- =====================================================================
-- Wattar — M4.6b: أسماء المشاركين داخل الغرفة (إصلاح ظهور "مستخدم")
-- Registry: #63
-- السبب: سياسات RLS على public.users تسمح بالقراءة الذاتية فقط، لذا فإن
--        تضمين user:users(...) من التطبيق يعيد null لأي مستخدم آخر.
-- الحل: دالة security definer تُرجع الحقول العامة الآمنة لمشاركي الغرفة فقط.
-- =====================================================================
begin;

create or replace function public.get_room_participant_profiles(p_room_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    u.id as user_id,
    u.username::text,
    u.display_name::text,
    u.avatar_url::text
  from public.users u
  where auth.uid() is not null
    and exists (select 1 from public.rooms r where r.id = p_room_id)
    and u.id in (
      select rs.user_id from public.room_seats rs
      where rs.room_id = p_room_id and rs.user_id is not null
      union
      select rm.user_id from public.room_messages rm
      where rm.room_id = p_room_id
    );
$$;

revoke all on function public.get_room_participant_profiles(uuid) from public, anon;
grant execute on function public.get_room_participant_profiles(uuid) to authenticated, service_role;

select json_build_object('applied', true) as result;

commit;
