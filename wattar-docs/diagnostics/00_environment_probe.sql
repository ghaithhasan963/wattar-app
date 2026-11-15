-- ============================================================================
-- Wattar — Environment Probe (READ ONLY)
-- Purpose: report what is actually applied on the Supabase project.
-- Safety: SELECT only. No INSERT / UPDATE / DELETE / ALTER / DROP.
-- How to run: Supabase Dashboard -> SQL Editor -> paste all -> Run.
-- Output: one result set, one row per section, JSON payload.
-- ============================================================================

with
tables as (
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
),
rls as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    coalesce((
      select count(*)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    ), 0) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
funcs as (
  select
    p.proname as name,
    pg_get_function_identity_arguments(p.oid) as args,
    case when p.prosecdef then 'security_definer' else 'security_invoker' end as security
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
buckets as (
  select id, name, public
  from storage.buckets
),
policies as (
  select
    schemaname, tablename, policyname, permissive,
    roles::text as roles, cmd, qual, with_check
  from pg_policies
  where schemaname in ('public', 'storage')
),
publications as (
  select pubname, schemaname, tablename
  from pg_publication_tables
),
triggers as (
  select event_object_table as table_name, trigger_name, event_manipulation
  from information_schema.triggers
  where trigger_schema = 'public'
),
extensions as (
  select extname, extversion from pg_extension
),
auth_users as (
  select count(*)::int as users_count from auth.users
),
wallet_columns as (
  select column_name, data_type, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users'
    and (column_name like 'balance%' or column_name like 'game_points%' or column_name like '%coin%')
)
select 'tables' as section,
       jsonb_agg(table_name order by table_name) as payload
from tables
union all
select 'rls',
       jsonb_agg(jsonb_build_object(
         'table', table_name,
         'enabled', rls_enabled,
         'policies', policy_count
       ) order by table_name)
from rls
union all
select 'functions',
       jsonb_agg(jsonb_build_object(
         'name', name,
         'args', args,
         'security', security
       ) order by name)
from funcs
union all
select 'buckets',
       coalesce(jsonb_agg(to_jsonb(buckets) order by name), '[]'::jsonb)
from buckets
union all
select 'policies',
       coalesce(jsonb_agg(to_jsonb(policies) order by tablename, policyname), '[]'::jsonb)
from policies
union all
select 'publications',
       coalesce(jsonb_agg(to_jsonb(publications) order by pubname, tablename), '[]'::jsonb)
from publications
union all
select 'triggers',
       coalesce(jsonb_agg(to_jsonb(triggers) order by table_name, trigger_name), '[]'::jsonb)
from triggers
union all
select 'extensions',
       jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) order by extname)
from extensions
union all
select 'auth_users',
       to_jsonb(auth_users)
from auth_users
union all
select 'wallet_columns',
       coalesce(jsonb_agg(jsonb_build_object(
         'column', column_name,
         'type', data_type,
         'default', column_default
       ) order by column_name), '[]'::jsonb)
from wallet_columns;
