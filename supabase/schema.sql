-- =============================================================
-- 좀비 감옥 탈출 — Supabase 스키마 / RLS / RPC
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run.
-- (Authentication > Sign In / Providers 에서 "Anonymous sign-ins" 활성화 필요)
-- 여러 번 실행해도 안전하도록 작성됨.
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- 테이블 ----------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  status      text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  host_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  winner_id   uuid references auth.users(id) on delete set null,
  end_reason  text check (end_reason in ('escape', 'time', 'zombie', 'disconnect')),
  ending      text check (ending in ('escape', 'last_shift')),
  round       int not null default 0
);

create table if not exists public.room_players (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  nickname  text not null check (char_length(nickname) between 1 and 16),
  role      text check (role in ('prisoner', 'guard')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_players_user_idx on public.room_players(user_id);

-- ---------- RLS ----------
-- 방에 속한 플레이어만 읽기 가능. INSERT/UPDATE/DELETE 정책을 만들지 않으므로
-- 클라이언트는 테이블을 직접 수정할 수 없다(role, winner_id, end_reason, ending 포함).
-- 모든 변경은 아래 security definer 함수(RPC)로만 이뤄진다.
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.room_players where room_id = p_room_id and user_id = auth.uid());
$$;

drop policy if exists rooms_select_members on public.rooms;
create policy rooms_select_members on public.rooms
  for select to authenticated using (public.is_room_member(id));

drop policy if exists room_players_select_members on public.room_players;
create policy room_players_select_members on public.room_players
  for select to authenticated using (public.is_room_member(room_id));

revoke insert, update, delete on public.rooms from anon, authenticated;
revoke insert, update, delete on public.room_players from anon, authenticated;

-- ---------- 내부 헬퍼: 방 상태 JSON ----------
create or replace function public._room_state(p_room_id uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'room', (select row_to_json(r) from public.rooms r where r.id = p_room_id),
    'players', coalesce((select json_agg(row_to_json(p) order by p.joined_at)
                         from public.room_players p where p.room_id = p_room_id), '[]'::json),
    'server_now', now()
  );
$$;
revoke all on function public._room_state(uuid) from public, anon, authenticated;

-- ---------- get_room_state ----------
create or replace function public.get_room_state(p_room_id uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then
    raise exception 'NOT_MEMBER';
  end if;
  return public._room_state(p_room_id);
end;
$$;

-- ---------- create_room ----------
create or replace function public.create_room(p_nickname text)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_room uuid;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;

  insert into public.rooms (code, host_id) values (v_code, v_uid) returning id into v_room;
  insert into public.room_players (room_id, user_id, nickname)
    values (v_room, v_uid, left(coalesce(nullif(trim(p_nickname), ''), '생존자'), 16));
  return public._room_state(v_room);
end;
$$;

-- ---------- assign_roles ----------
-- 두 명이 모이면(또는 '다시 하기') 서버에서 역할을 랜덤 배정하고 게임 시작 시각을 정한다.
-- started_at = 지금 + 6.5초 (역할 공개 3초 + 카운트다운 3초 + 여유)
create or replace function public.assign_roles(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_room public.rooms;
  v_count int;
  v_prisoner uuid;
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  -- 이미 진행 중이면(상대가 먼저 '다시 하기'를 누른 경우) 그대로 반환
  if v_room.status = 'playing' then return public._room_state(p_room_id); end if;

  select count(*) into v_count from public.room_players where room_id = p_room_id;
  if v_count <> 2 then raise exception 'NEED_TWO_PLAYERS'; end if;

  select user_id into v_prisoner from public.room_players
    where room_id = p_room_id order by random() limit 1;

  update public.room_players
     set role = case when user_id = v_prisoner then 'prisoner' else 'guard' end
   where room_id = p_room_id;

  update public.rooms
     set status = 'playing',
         started_at = now() + interval '6.5 seconds',
         winner_id = null, end_reason = null, ending = null,
         round = round + 1
   where id = p_room_id;

  return public._room_state(p_room_id);
end;
$$;

-- ---------- join_room ----------
create or replace function public.join_room(p_code text, p_nickname text)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_count int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_room from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  -- 이미 들어와 있는 플레이어(새로고침 등)
  if exists (select 1 from public.room_players where room_id = v_room.id and user_id = v_uid) then
    return public._room_state(v_room.id);
  end if;

  select count(*) into v_count from public.room_players where room_id = v_room.id;
  if v_count >= 2 then raise exception 'ROOM_FULL'; end if;
  if v_room.status <> 'waiting' then raise exception 'ROOM_CLOSED'; end if;

  insert into public.room_players (room_id, user_id, nickname)
    values (v_room.id, v_uid, left(coalesce(nullif(trim(p_nickname), ''), '생존자'), 16));

  if v_count + 1 = 2 then
    return public.assign_roles(v_room.id);
  end if;
  return public._room_state(v_room.id);
end;
$$;

-- ---------- end_game ----------
-- reason:
--   'escape'     : 죄수가 정문으로 탈출 (죄수만 호출 가능)     → 승자 죄수,  엔딩 escape
--   'time'       : 제한시간 종료 (600초 경과 후에만 유효)        → 승자 교도관, 엔딩 last_shift
--   'zombie'     : 호출한 플레이어가 좀비에게 잡힘               → 승자 상대,   엔딩 = 상대 역할 기준
--   'disconnect' : 상대가 나감 (남은 플레이어가 호출)             → 승자 호출자, 엔딩 없음
-- 이미 끝난 게임이면 아무것도 바꾸지 않고 현재 상태를 반환(멱등).
create or replace function public.end_game(p_room_id uuid, p_reason text)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_players;
  v_other public.room_players;
  v_winner uuid;
  v_ending text;
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status <> 'playing' then return public._room_state(p_room_id); end if;

  select * into v_me from public.room_players where room_id = p_room_id and user_id = v_uid;
  select * into v_other from public.room_players where room_id = p_room_id and user_id <> v_uid;

  if p_reason = 'escape' then
    if v_me.role <> 'prisoner' then raise exception 'ONLY_PRISONER_CAN_ESCAPE'; end if;
    if now() < v_room.started_at then raise exception 'NOT_STARTED'; end if;
    v_winner := v_me.user_id;
    v_ending := 'escape';
  elsif p_reason = 'time' then
    if now() < v_room.started_at + interval '595 seconds' then raise exception 'TIME_NOT_OVER'; end if;
    v_winner := case when v_me.role = 'guard' then v_me.user_id else v_other.user_id end;
    v_ending := 'last_shift';
  elsif p_reason = 'zombie' then
    v_winner := v_other.user_id;
    v_ending := case when v_other.role = 'prisoner' then 'escape' else 'last_shift' end;
  elsif p_reason = 'disconnect' then
    v_winner := v_me.user_id;
    v_ending := null;
  else
    raise exception 'BAD_REASON';
  end if;

  update public.rooms
     set status = 'finished', winner_id = v_winner, end_reason = p_reason, ending = v_ending
   where id = p_room_id;

  return public._room_state(p_room_id);
end;
$$;

-- ---------- 실행 권한 ----------
revoke all on function public.create_room(text) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.assign_roles(uuid) from public, anon;
revoke all on function public.end_game(uuid, text) from public, anon;
revoke all on function public.get_room_state(uuid) from public, anon;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.assign_roles(uuid) to authenticated;
grant execute on function public.end_game(uuid, text) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
