-- ヒアリング用プロトタイプの共通パスワード管理。
-- 正式な管理者アカウント・権限管理へ移行するまでの一時実装です。

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.orienteering_admin_settings (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.orienteering_admin_settings enable row level security;
revoke all on public.orienteering_admin_settings from anon, authenticated;

-- 実行前に CHANGE_THIS_PASSWORD_BEFORE_RUN を実際の仮パスワードへ置換してください。
-- パスワードをGitHubへコミットしないため、ここには実値を保存しません。
insert into public.orienteering_admin_settings(id, password_hash)
values (true, extensions.crypt('CHANGE_THIS_PASSWORD_BEFORE_RUN', extensions.gen_salt('bf')))
on conflict (id) do update
set password_hash = excluded.password_hash, updated_at = now();

-- Authへ登録しただけのユーザーを管理者にする旧ポリシーは削除します。
drop policy if exists "authenticated users manage orienteering courses"
  on public.orienteering_courses;
drop policy if exists "authenticated users manage orienteering checkpoints"
  on public.orienteering_checkpoints;

create or replace function public.orienteering_admin_verify(p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.orienteering_admin_settings
    where id = true and password_hash = extensions.crypt(p_password, password_hash)
  );
$$;

create or replace function public.orienteering_admin_update_course(
  p_password text, p_course_id bigint, p_title text, p_duration text, p_distance text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.orienteering_admin_verify(p_password) then
    raise exception 'invalid admin password' using errcode = '42501';
  end if;
  update public.orienteering_courses
  set title = p_title, duration = p_duration, distance = p_distance, updated_at = now()
  where id = p_course_id;
end;
$$;

create or replace function public.orienteering_admin_save_checkpoint(
  p_password text, p_id bigint, p_course_id bigint, p_name text,
  p_lat double precision, p_lng double precision, p_points integer,
  p_distance text, p_category text, p_hint text, p_mission text, p_explain text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare saved_id bigint;
begin
  if not public.orienteering_admin_verify(p_password) then
    raise exception 'invalid admin password' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.orienteering_checkpoints
      (course_id,name,lat,lng,points,distance,category,hint,mission,explain,sort_order)
    values
      (p_course_id,p_name,p_lat,p_lng,p_points,p_distance,p_category,p_hint,p_mission,p_explain,
       (select coalesce(max(sort_order),0)+1 from public.orienteering_checkpoints where course_id=p_course_id))
    returning id into saved_id;
  else
    update public.orienteering_checkpoints
    set name=p_name,lat=p_lat,lng=p_lng,points=p_points,distance=p_distance,
        category=p_category,hint=p_hint,mission=p_mission,explain=p_explain,updated_at=now()
    where id=p_id and course_id=p_course_id
    returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.orienteering_admin_delete_checkpoint(
  p_password text, p_id bigint, p_course_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.orienteering_admin_verify(p_password) then
    raise exception 'invalid admin password' using errcode = '42501';
  end if;
  delete from public.orienteering_checkpoints where id=p_id and course_id=p_course_id;
end;
$$;

revoke all on function public.orienteering_admin_verify(text) from public;
revoke all on function public.orienteering_admin_update_course(text,bigint,text,text,text) from public;
revoke all on function public.orienteering_admin_save_checkpoint(text,bigint,bigint,text,double precision,double precision,integer,text,text,text,text,text) from public;
revoke all on function public.orienteering_admin_delete_checkpoint(text,bigint,bigint) from public;

grant execute on function public.orienteering_admin_verify(text) to anon, authenticated;
grant execute on function public.orienteering_admin_update_course(text,bigint,text,text,text) to anon, authenticated;
grant execute on function public.orienteering_admin_save_checkpoint(text,bigint,bigint,text,double precision,double precision,integer,text,text,text,text,text) to anon, authenticated;
grant execute on function public.orienteering_admin_delete_checkpoint(text,bigint,bigint) to anon, authenticated;
