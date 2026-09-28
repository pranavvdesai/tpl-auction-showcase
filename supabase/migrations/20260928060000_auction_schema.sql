-- TPL Auction Dashboard: schema, security and auction rules.
-- All writes happen through SECURITY DEFINER functions that require an operator.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.auction_settings (
  id           integer primary key default 1 check (id = 1),
  season_name  text    not null default 'TPL 2026',
  min_squad    integer not null default 8  check (min_squad > 0),
  max_squad    integer not null default 10 check (max_squad > 0),
  min_base     integer not null default 100 check (min_base > 0),
  check (min_squad <= max_squad)
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  short_code  text not null unique,
  color       text not null default '#1d4ed8',
  captain     text,
  purse_total integer not null default 10000 check (purse_total > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  lot_no        integer not null unique,
  name          text not null,
  roll_no       text not null,
  batch         text not null,
  role          text not null check (role in ('Batter', 'Bowler', 'All-rounder', 'Wicketkeeper')),
  category      text not null check (category in ('Marquee', 'A', 'B', 'C')),
  base_price    integer not null check (base_price > 0),
  batting_style text,
  bowling_style text,
  highlight     text,
  status        text not null default 'available' check (status in ('available', 'sold', 'unsold')),
  team_id       uuid references public.teams (id),
  sold_price    integer check (sold_price is null or sold_price > 0),
  sold_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint players_sold_consistency
    check ((status = 'sold') = (team_id is not null and sold_price is not null))
);
create index players_team_idx on public.players (team_id);
create index players_status_idx on public.players (status);

create table public.bids (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.players (id) on delete cascade,
  team_id    uuid not null references public.teams (id),
  amount     integer not null check (amount > 0),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index bids_player_idx on public.bids (player_id, id desc);

create table public.auction_state (
  id                integer primary key default 1 check (id = 1),
  status            text not null default 'idle' check (status in ('idle', 'live', 'sold', 'unsold')),
  current_player_id uuid references public.players (id),
  current_bid       integer,
  current_team_id   uuid references public.teams (id),
  updated_at        timestamptz not null default now()
);

create table public.operators (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

insert into public.auction_settings (id) values (1);
insert into public.auction_state (id) values (1);

-- ---------------------------------------------------------------------------
-- Row level security: everyone may read auction data, nobody may write directly.
-- ---------------------------------------------------------------------------

alter table public.auction_settings enable row level security;
alter table public.teams            enable row level security;
alter table public.players          enable row level security;
alter table public.bids             enable row level security;
alter table public.auction_state    enable row level security;
alter table public.operators        enable row level security;

create policy "public read settings" on public.auction_settings for select to anon, authenticated using (true);
create policy "public read teams"    on public.teams            for select to anon, authenticated using (true);
create policy "public read players"  on public.players          for select to anon, authenticated using (true);
create policy "public read bids"     on public.bids             for select to anon, authenticated using (true);
create policy "public read state"    on public.auction_state    for select to anon, authenticated using (true);
create policy "operator reads self"  on public.operators        for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete, truncate on
  public.auction_settings, public.teams, public.players, public.bids, public.auction_state, public.operators
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Derived team standings
-- ---------------------------------------------------------------------------

create or replace function public.bid_increment(p_amount integer)
returns integer
language sql
immutable
as $$
  select case
    when p_amount < 1000 then 50
    when p_amount < 3000 then 100
    else 200
  end
$$;

create or replace view public.team_standings
with (security_invoker = true) as
select
  t.id,
  t.name,
  t.short_code,
  t.color,
  t.captain,
  t.sort_order,
  t.purse_total,
  coalesce(sum(p.sold_price), 0)::integer                  as spent,
  (t.purse_total - coalesce(sum(p.sold_price), 0))::integer as remaining,
  count(p.id)::integer                                      as squad_count,
  case
    when count(p.id) >= s.max_squad then 0
    else greatest(
      (t.purse_total - coalesce(sum(p.sold_price), 0))
        - greatest(s.min_squad - count(p.id) - 1, 0) * s.min_base,
      0
    )
  end::integer                                              as max_bid
from public.teams t
cross join public.auction_settings s
left join public.players p on p.team_id = t.id and p.status = 'sold'
group by t.id, s.max_squad, s.min_squad, s.min_base;

grant select on public.team_standings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auction operations
-- ---------------------------------------------------------------------------

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.operators where user_id = auth.uid())
$$;

create or replace function public.assert_operator()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_operator() then
    raise exception 'Only a signed-in auction operator can do this.' using errcode = '42501';
  end if;
end
$$;

create or replace function public.start_lot(p_player_id uuid)
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state  public.auction_state;
  v_player public.players;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status = 'live' then
    raise exception 'Close the current lot (sold or unsold) before starting another.';
  end if;

  select * into v_player from public.players where id = p_player_id for update;
  if not found then
    raise exception 'Player not found.';
  end if;
  if v_player.status = 'sold' then
    raise exception '% is already sold.', v_player.name;
  end if;

  update public.players set status = 'available' where id = p_player_id;
  delete from public.bids where player_id = p_player_id;

  update public.auction_state
     set status = 'live', current_player_id = p_player_id,
         current_bid = null, current_team_id = null, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.place_bid(p_team_id uuid, p_amount integer default null)
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    public.auction_state;
  v_player   public.players;
  v_team     public.team_standings;
  v_minimum  integer;
  v_amount   integer;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status <> 'live' or v_state.current_player_id is null then
    raise exception 'No lot is live. Start a player first.';
  end if;

  select * into v_player from public.players where id = v_state.current_player_id;

  v_minimum := case
    when v_state.current_bid is null then v_player.base_price
    else v_state.current_bid + public.bid_increment(v_state.current_bid)
  end;
  v_amount := coalesce(p_amount, v_minimum);

  if v_amount < v_minimum then
    raise exception 'Bid must be at least % points.', v_minimum;
  end if;
  if v_state.current_team_id = p_team_id then
    raise exception 'This team already holds the highest bid.';
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= (select max_squad from public.auction_settings) then
    raise exception '% already has a full squad.', v_team.name;
  end if;
  if v_amount > v_team.max_bid then
    raise exception '% can bid at most % points (purse reserve for minimum squad).', v_team.name, v_team.max_bid;
  end if;

  insert into public.bids (player_id, team_id, amount, created_by)
  values (v_player.id, p_team_id, v_amount, auth.uid());

  update public.auction_state
     set current_bid = v_amount, current_team_id = p_team_id, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.undo_bid()
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
  v_prev  public.bids;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status <> 'live' then
    raise exception 'No lot is live.';
  end if;

  delete from public.bids
   where id = (select id from public.bids where player_id = v_state.current_player_id order by id desc limit 1);
  if not found then
    raise exception 'There is no bid to undo.';
  end if;

  select * into v_prev from public.bids
   where player_id = v_state.current_player_id order by id desc limit 1;

  update public.auction_state
     set current_bid = v_prev.amount, current_team_id = v_prev.team_id, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.sell_lot()
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status <> 'live' then
    raise exception 'No lot is live.';
  end if;
  if v_state.current_team_id is null then
    raise exception 'No bids yet. Mark the player unsold instead.';
  end if;

  update public.players
     set status = 'sold', team_id = v_state.current_team_id,
         sold_price = v_state.current_bid, sold_at = now()
   where id = v_state.current_player_id;

  update public.auction_state set status = 'sold', updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.mark_unsold()
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status <> 'live' then
    raise exception 'No lot is live.';
  end if;
  if v_state.current_team_id is not null then
    raise exception 'This player has bids. Undo them first or sell to the highest bidder.';
  end if;

  update public.players set status = 'unsold' where id = v_state.current_player_id;

  update public.auction_state set status = 'unsold', updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.revert_sale(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  update public.players
     set status = 'available', team_id = null, sold_price = null, sold_at = null
   where id = p_player_id and status in ('sold', 'unsold');
  if not found then
    raise exception 'Only sold or unsold players can be reverted.';
  end if;
  delete from public.bids where player_id = p_player_id;

  update public.auction_state
     set status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1 and current_player_id = p_player_id;
end
$$;

create or replace function public.reset_auction()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  delete from public.bids where true;
  update public.auction_state
     set status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1;
  update public.players
     set status = 'available', team_id = null, sold_price = null, sold_at = null
   where true;
end
$$;

revoke execute on function
  public.assert_operator(), public.start_lot(uuid), public.place_bid(uuid, integer),
  public.undo_bid(), public.sell_lot(), public.mark_unsold(),
  public.revert_sale(uuid), public.reset_auction()
  from public, anon;

grant execute on function
  public.start_lot(uuid), public.place_bid(uuid, integer),
  public.undo_bid(), public.sell_lot(), public.mark_unsold(),
  public.revert_sale(uuid), public.reset_auction(), public.is_operator()
  to authenticated;

grant execute on function public.is_operator(), public.bid_increment(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime for the projection screen
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.auction_state, public.players, public.bids, public.teams;
