-- Bidding happens verbally in the room; the operator records only the final result.
-- Replaces per-bid tracking with a single sell_player(team, amount) call.

drop function if exists public.place_bid(uuid, integer);
drop function if exists public.undo_bid();
drop function if exists public.sell_lot();
drop function if exists public.bid_increment(integer);
drop table if exists public.bids;

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

  update public.auction_state
     set status = 'live', current_player_id = p_player_id,
         current_bid = null, current_team_id = null, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.sell_player(p_team_id uuid, p_amount integer)
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state  public.auction_state;
  v_player public.players;
  v_team   public.team_standings;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.status <> 'live' or v_state.current_player_id is null then
    raise exception 'No player is on the floor. Start a player first.';
  end if;

  select * into v_player from public.players where id = v_state.current_player_id for update;

  if p_amount is null or p_amount < v_player.base_price then
    raise exception 'Final amount must be at least the base price of % points.', v_player.base_price;
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= (select max_squad from public.auction_settings) then
    raise exception '% already has a full squad.', v_team.name;
  end if;
  if p_amount > v_team.max_bid then
    raise exception '% can spend at most % points (purse reserve for minimum squad).', v_team.name, v_team.max_bid;
  end if;

  update public.players
     set status = 'sold', team_id = p_team_id, sold_price = p_amount, sold_at = now()
   where id = v_player.id;

  update public.auction_state
     set status = 'sold', current_bid = p_amount, current_team_id = p_team_id, updated_at = now()
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

  update public.players set status = 'unsold' where id = v_state.current_player_id;

  update public.auction_state set status = 'unsold', updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

create or replace function public.cancel_lot()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  update public.auction_state
     set status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1 and status = 'live';
  if not found then
    raise exception 'No player is on the floor.';
  end if;
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
     set status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1;
  update public.players
     set status = 'available', team_id = null, sold_price = null, sold_at = null
   where true;
end
$$;

revoke execute on function public.sell_player(uuid, integer), public.cancel_lot() from public, anon;
grant execute on function public.sell_player(uuid, integer), public.cancel_lot() to authenticated;
