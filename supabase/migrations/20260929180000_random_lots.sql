-- The auction runs as a random draw the operator cannot steer:
--   setup  -> draw_lot_order() shuffles Batsmen / Bowlers / All-rounders
--   ready  -> begin_auction()
--   lots   -> draw_next_player() picks a random available player from the current lot
--   unsold -> draw_next_player() brings unsold players back in the order they went unsold
--   ended  -> when no team can buy another player, the pool is exhausted, or end_auction()

alter table public.auction_state
  add column if not exists phase text not null default 'setup'
    check (phase in ('setup', 'ready', 'lots', 'unsold', 'ended')),
  add column if not exists lot_order text[],
  add column if not exists current_lot integer,
  add column if not exists lot_order_drawn_at timestamptz;

alter table public.players
  add column if not exists unsold_at timestamptz,
  add column if not exists reauctioned boolean not null default false;

-- Wicketkeepers are auctioned in the Batsmen lot.
create or replace function public.in_lot(p_role text, p_lot text)
returns boolean
language sql
immutable
as $$
  select p_role = p_lot or (p_lot = 'Batter' and p_role = 'Wicketkeeper')
$$;

create or replace function public.teams_can_buy()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.team_standings t
     cross join public.auction_settings s
     where t.squad_count < s.max_squad and t.max_bid >= s.min_base
  )
$$;

create or replace function public.draw_lot_order()
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
  if v_state.phase <> 'setup' then
    raise exception 'The lot order has already been drawn.';
  end if;
  if exists (select 1 from public.players where status <> 'available') then
    raise exception 'Some players are already sold or unsold. Reset the auction before drawing the lot order.';
  end if;

  update public.auction_state
     set phase = 'ready',
         lot_order = array(select l from unnest(array['Batter', 'Bowler', 'All-rounder']) as t(l) order by random()),
         current_lot = null,
         lot_order_drawn_at = now(),
         status = 'idle', current_player_id = null, current_bid = null, current_team_id = null,
         updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.begin_auction()
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
  if v_state.phase <> 'ready' then
    raise exception 'Draw the lot order before beginning the auction.';
  end if;

  update public.auction_state
     set phase = 'lots', current_lot = 1, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.draw_next_player()
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
  v_pick  public.players;
  v_lot   integer;
  v_phase text;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.phase in ('setup', 'ready') then
    raise exception 'Draw the lot order and begin the auction first.';
  end if;
  if v_state.phase = 'ended' then
    raise exception 'The auction has ended.';
  end if;
  if v_state.status = 'live' then
    raise exception 'Close the current player (sold or unsold) before drawing the next one.';
  end if;

  if public.teams_can_buy() then
    -- Earliest lot that still has players; a reverted sale goes back into its own lot.
    for i in 1 .. coalesce(array_length(v_state.lot_order, 1), 0) loop
      select * into v_pick
        from public.players
       where status = 'available' and public.in_lot(role, v_state.lot_order[i])
       order by random()
       limit 1
         for update;
      if found then
        v_lot := i;
        v_phase := 'lots';
        exit;
      end if;
    end loop;

    if v_phase is null then
      select * into v_pick
        from public.players
       where status = 'unsold' and not reauctioned
       order by unsold_at nulls last, lot_no
       limit 1
         for update;
      if found then
        v_phase := 'unsold';
        update public.players set status = 'available', reauctioned = true where id = v_pick.id;
      end if;
    end if;
  end if;

  if v_phase is null then
    update public.auction_state
       set phase = 'ended', status = 'idle', current_player_id = null, current_bid = null,
           current_team_id = null, updated_at = now()
     where id = 1
    returning * into v_state;
    return v_state;
  end if;

  update public.auction_state
     set phase = v_phase,
         current_lot = coalesce(v_lot, current_lot),
         status = 'live', current_player_id = v_pick.id,
         current_bid = null, current_team_id = null, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.end_auction()
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
  if v_state.phase not in ('lots', 'unsold') then
    raise exception 'The auction is not running.';
  end if;
  if v_state.status = 'live' then
    raise exception 'Close the current player (sold or unsold) before ending the auction.';
  end if;

  update public.auction_state
     set phase = 'ended', status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
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
    raise exception 'No player is on the floor.';
  end if;

  update public.players
     set status = 'unsold', unsold_at = coalesce(unsold_at, now())
   where id = v_state.current_player_id;

  update public.auction_state set status = 'unsold', updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

-- A reverted unsold-round sale goes back into the unsold queue at its original place.
create or replace function public.revert_sale(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  update public.players
     set status = case when status = 'sold' and reauctioned then 'unsold' else 'available' end,
         unsold_at = case when status = 'sold' and reauctioned then unsold_at else null end,
         reauctioned = false,
         team_id = null, sold_price = null, sold_at = null
   where id = p_player_id and status in ('sold', 'unsold');
  if not found then
    raise exception 'Only sold or unsold players can be reverted.';
  end if;

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

  update public.auction_state
     set status = 'idle', current_player_id = null, current_bid = null, current_team_id = null,
         phase = 'setup', lot_order = null, current_lot = null, lot_order_drawn_at = null,
         updated_at = now()
   where id = 1;
  update public.players
     set status = 'available', team_id = null, sold_price = null, sold_at = null,
         unsold_at = null, reauctioned = false
   where true;
end
$$;

-- The operator can no longer pick a player or take one off the screen.
drop function if exists public.start_lot(uuid);
drop function if exists public.cancel_lot();

revoke execute on function
  public.draw_lot_order(), public.begin_auction(), public.draw_next_player(), public.end_auction(),
  public.teams_can_buy()
  from public, anon;
grant execute on function
  public.draw_lot_order(), public.begin_auction(), public.draw_next_player(), public.end_auction()
  to authenticated;
