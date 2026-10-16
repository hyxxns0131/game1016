-- =============================================================
-- 좀비 감옥 탈출 — Supabase 스키마 / RLS / RPC  (최대 4인: 교도관 1 + 죄수 최대 3)
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
  winner_id   uuid references auth.users(id) on delete set null, -- (1:1 시절 컬럼, 사용 안 함)
  end_reason  text,
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

-- 4인용으로 추가된 컬럼
alter table public.room_players add column if not exists status text not null default 'alive';
alter table public.room_players add column if not exists won boolean;
alter table public.room_players add column if not exists last_seen timestamptz not null default now();

alter table public.room_players drop constraint if exists room_players_status_check;
alter table public.room_players add constraint room_players_status_check
  check (status in ('alive', 'escaped', 'dead', 'left'));

-- end_reason:
--   resolved   : 모든 죄수가 탈출했거나 쓰러짐(또는 나감)
--   time       : 제한시간 종료
--   guard_down : 교도관이 좀비에게 잡힘
--   guard_left : 교도관이 나감
alter table public.rooms drop constraint if exists rooms_end_reason_check;
update public.rooms set end_reason = null
 where end_reason is not null and end_reason not in ('resolved', 'time', 'guard_down', 'guard_left');
alter table public.rooms add constraint rooms_end_reason_check
  check (end_reason in ('resolved', 'time', 'guard_down', 'guard_left'));

create index if not exists room_players_user_idx on public.room_players(user_id);

-- ---------- RLS ----------
-- 방에 속한 플레이어만 읽기 가능. INSERT/UPDATE/DELETE 정책을 만들지 않으므로
-- 클라이언트는 테이블을 직접 수정할 수 없다(role, status, won 포함).
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

-- ---------- 내부 헬퍼 ----------
create or replace function public._room_state(p_room_id uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'room', (select row_to_json(r) from public.rooms r where r.id = p_room_id),
    'players', coalesce((select json_agg(json_build_object(
                           'user_id', p.user_id, 'nickname', p.nickname, 'role', p.role,
                           'status', p.status, 'won', p.won, 'joined_at', p.joined_at) order by p.joined_at)
                         from public.room_players p where p.room_id = p_room_id), '[]'::json),
    'server_now', now()
  );
$$;

-- 게임 종료: 각 플레이어의 승패를 기록한다.
--   죄수: 탈출했으면 승리. 교도관이 쓰러지거나 나갔을 때 살아 있던 죄수도 승리.
--   교도관: 살아 있고, 탈출한 죄수가 과반 미만이면 승리 (죄수 3명 → 1명 이하 탈출).
create or replace function public._finish(p_room_id uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_total int;
  v_escaped int;
  v_guard_won boolean;
begin
  select count(*), count(*) filter (where status = 'escaped')
    into v_total, v_escaped
    from public.room_players where room_id = p_room_id and role = 'prisoner';

  update public.room_players
     set won = case
       when role = 'prisoner' then
         status = 'escaped' or (status = 'alive' and p_reason in ('guard_down', 'guard_left'))
       else
         status = 'alive' and p_reason not in ('guard_down', 'guard_left') and v_escaped * 2 < v_total
     end
   where room_id = p_room_id;

  select coalesce(bool_or(won), false) into v_guard_won
    from public.room_players where room_id = p_room_id and role = 'guard';

  update public.rooms
     set status = 'finished', end_reason = p_reason,
         ending = case when v_guard_won then 'last_shift' else 'escape' end
   where id = p_room_id;
end;
$$;

-- 진행 중인 판이 끝났는지 확인
create or replace function public._check_end(p_room_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_guard_status text;
  v_alive int;
begin
  if (select status from public.rooms where id = p_room_id) <> 'playing' then return; end if;
  select status into v_guard_status from public.room_players where room_id = p_room_id and role = 'guard';
  select count(*) into v_alive from public.room_players
   where room_id = p_room_id and role = 'prisoner' and status = 'alive';

  if v_guard_status is null or v_guard_status = 'left' then
    perform public._finish(p_room_id, 'guard_left');
  elsif v_guard_status = 'dead' then
    perform public._finish(p_room_id, 'guard_down');
  elsif v_alive = 0 then
    perform public._finish(p_room_id, 'resolved');
  end if;
end;
$$;

-- 하트비트가 끊긴 플레이어 정리 + 방장 넘기기
--   대기/결과 화면: 방에서 제거 / 게임 중: 'left' 처리
create or replace function public._sweep(p_room_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_status text;
  v_host uuid;
  v_new_host uuid;
begin
  select status, host_id into v_status, v_host from public.rooms where id = p_room_id;
  if v_status is null then return; end if;

  if v_status = 'playing' then
    update public.room_players set status = 'left'
     where room_id = p_room_id and status = 'alive'
       and last_seen < now() - interval '20 seconds';
    perform public._check_end(p_room_id);
  else
    delete from public.room_players
     where room_id = p_room_id and last_seen < now() - interval '45 seconds';
  end if;

  -- 방장이 없거나 끊겼으면 가장 먼저 들어온 접속자에게 넘긴다
  if not exists (select 1 from public.room_players
                  where room_id = p_room_id and user_id = v_host
                    and last_seen >= now() - interval '20 seconds') then
    select user_id into v_new_host from public.room_players
     where room_id = p_room_id and last_seen >= now() - interval '20 seconds'
     order by joined_at limit 1;
    if v_new_host is not null then
      update public.rooms set host_id = v_new_host where id = p_room_id;
    end if;
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id) then
    delete from public.rooms where id = p_room_id;
  end if;
end;
$$;

revoke all on function public._room_state(uuid) from public, anon, authenticated;
revoke all on function public._finish(uuid, text) from public, anon, authenticated;
revoke all on function public._check_end(uuid) from public, anon, authenticated;
revoke all on function public._sweep(uuid) from public, anon, authenticated;

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

-- ---------- heartbeat ----------
-- 클라이언트가 2초마다 호출. 내 접속 시각을 갱신하고, 끊긴 사람을 정리한 뒤 방 상태를 돌려준다.
create or replace function public.heartbeat(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;
  update public.room_players set last_seen = now() where room_id = p_room_id and user_id = auth.uid();
  perform public._sweep(p_room_id);
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

-- ---------- join_room ----------
-- 최대 4명. 대기 중이거나 판이 끝난 방(결과 화면)에만 들어올 수 있다.
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
    update public.room_players set last_seen = now() where room_id = v_room.id and user_id = v_uid;
    return public._room_state(v_room.id);
  end if;

  perform public._sweep(v_room.id);
  if v_room.status = 'playing' then raise exception 'ROOM_CLOSED'; end if;
  select count(*) into v_count from public.room_players where room_id = v_room.id;
  if v_count >= 4 then raise exception 'ROOM_FULL'; end if;

  insert into public.room_players (room_id, user_id, nickname)
    values (v_room.id, v_uid, left(coalesce(nullif(trim(p_nickname), ''), '생존자'), 16));
  return public._room_state(v_room.id);
end;
$$;

-- ---------- start_game ----------
-- 방장이 '게임 시작'(또는 결과 화면의 '다시 하기')을 누르면 서버가 역할을 랜덤 배정한다.
-- 교도관 1명 + 나머지 전원 죄수(최대 3명).
-- started_at = 지금 + 6.5초 (역할 공개 3초 + 카운트다운 3초 + 여유)
create or replace function public.start_game(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_room public.rooms;
  v_count int;
  v_guard uuid;
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;
  update public.room_players set last_seen = now() where room_id = p_room_id and user_id = auth.uid();
  perform public._sweep(p_room_id);

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status = 'playing' then return public._room_state(p_room_id); end if;
  if v_room.host_id <> auth.uid() then raise exception 'ONLY_HOST'; end if;

  select count(*) into v_count from public.room_players where room_id = p_room_id;
  if v_count < 2 then raise exception 'NEED_TWO_PLAYERS'; end if;

  select user_id into v_guard from public.room_players
    where room_id = p_room_id order by random() limit 1;

  update public.room_players
     set role = case when user_id = v_guard then 'guard' else 'prisoner' end,
         status = 'alive', won = null
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

-- ---------- 게임 중 보고 ----------
-- 탈출: 호출한 죄수만 탈출 처리 (클라이언트가 열쇠 3개 + 정문 도달을 확인한 뒤 호출)
create or replace function public.report_escape(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status <> 'playing' then return public._room_state(p_room_id); end if;
  if now() < v_room.started_at then raise exception 'NOT_STARTED'; end if;

  update public.room_players set status = 'escaped', last_seen = now()
   where room_id = p_room_id and user_id = auth.uid() and role = 'prisoner' and status = 'alive';
  if not found then raise exception 'ONLY_ALIVE_PRISONER_CAN_ESCAPE'; end if;

  perform public._check_end(p_room_id);
  return public._room_state(p_room_id);
end;
$$;

-- 좀비에게 잡힘: 호출한 플레이어만 쓰러짐 처리
create or replace function public.report_death(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if (select status from public.rooms where id = p_room_id) <> 'playing' then
    return public._room_state(p_room_id);
  end if;

  update public.room_players set status = 'dead', last_seen = now()
   where room_id = p_room_id and user_id = auth.uid() and status = 'alive';

  perform public._check_end(p_room_id);
  return public._room_state(p_room_id);
end;
$$;

-- 제한시간 종료 (600초 경과 후에만 유효)
create or replace function public.time_up(p_room_id uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_member(p_room_id) then raise exception 'NOT_MEMBER'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status <> 'playing' then return public._room_state(p_room_id); end if;
  if now() < v_room.started_at + interval '595 seconds' then raise exception 'TIME_NOT_OVER'; end if;
  perform public._finish(p_room_id, 'time');
  return public._room_state(p_room_id);
end;
$$;

-- 방 나가기 (나가기/로비로 버튼)
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then return; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if (select status from public.rooms where id = p_room_id) = 'playing' then
    update public.room_players
       set status = case when status = 'alive' then 'left' else status end,
           last_seen = now() - interval '1 hour'
     where room_id = p_room_id and user_id = auth.uid();
  else
    delete from public.room_players where room_id = p_room_id and user_id = auth.uid();
  end if;
  perform public._sweep(p_room_id);
end;
$$;

-- ---------- 1:1 시절 함수 정리 ----------
drop function if exists public.assign_roles(uuid);
drop function if exists public.end_game(uuid, text);

-- ---------- 실행 권한 ----------
revoke all on function public.create_room(text) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.start_game(uuid) from public, anon;
revoke all on function public.heartbeat(uuid) from public, anon;
revoke all on function public.report_escape(uuid) from public, anon;
revoke all on function public.report_death(uuid) from public, anon;
revoke all on function public.time_up(uuid) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
revoke all on function public.get_room_state(uuid) from public, anon;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.report_escape(uuid) to authenticated;
grant execute on function public.report_death(uuid) to authenticated;
grant execute on function public.time_up(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
