-- No third round. After round 2 (the unsold round), teams still below the minimum squad are
-- given the leftover unsold players at the base price by the operator. Once every team has the
-- minimum squad (or nobody is left to give), the auction is completed.

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
    if public.teams_short() and exists (select 1 from public.players where status = 'unsold') then
      raise exception 'Round 2 is over. Give the unsold players to the teams below the minimum squad, then complete the auction.';
    end if;
    update public.auction_state
       set phase = 'ended', status = 'idle', current_player_id = null, current_bid = null,
           current_team_id = null, updated_at = now()
     where id = 1
    returning * into v_state;
    return v_state;
  end if;

  update public.players
     set draw_no = (select coalesce(max(draw_no), 0) + 1 from public.players)
   where id = v_pick.id and draw_no is null;

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

create or replace function public.allot_player(p_player_id uuid, p_team_id uuid)
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    public.auction_state;
  v_player   public.players;
  v_team     public.team_standings;
  v_settings public.auction_settings;
begin
  perform public.assert_operator();

  select * into v_settings from public.auction_settings where id = 1;
  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.phase not in ('lots', 'unsold') then
    raise exception 'The auction is not running.';
  end if;
  if v_state.status = 'live' then
    raise exception 'Close the current player (sold or unsold) first.';
  end if;
  if exists (select 1 from public.players where status = 'available' or (status = 'unsold' and not reauctioned)) then
    raise exception 'Unsold players can only be given out after round 2 (the unsold round) is over.';
  end if;

  select * into v_player from public.players where id = p_player_id for update;
  if not found or v_player.status <> 'unsold' then
    raise exception 'That player is not on the unsold list.';
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= v_settings.min_squad then
    raise exception '% already has % players. Only teams below % get unsold players.', v_team.name, v_team.squad_count, v_settings.min_squad;
  end if;
  if v_player.base_price > v_team.max_bid then
    raise exception '% cannot afford the base price of % points.', v_team.name, v_player.base_price;
  end if;

  update public.players
     set status = 'sold', team_id = p_team_id, sold_price = v_player.base_price, sold_at = now()
   where id = v_player.id;

  update public.auction_state
     set status = 'sold', current_player_id = v_player.id, current_bid = v_player.base_price,
         current_team_id = p_team_id, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

revoke execute on function public.allot_player(uuid, uuid) from public, anon;
grant execute on function public.allot_player(uuid, uuid) to authenticated;

create or replace function public.end_auction()
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
  v_short text;
begin
  perform public.assert_operator();

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.phase not in ('lots', 'unsold') then
    raise exception 'The auction is not running.';
  end if;
  if v_state.status = 'live' then
    raise exception 'Close the current player (sold or unsold) before ending the auction.';
  end if;

  select string_agg(format('%s (%s/%s)', name, squad_count, s.min_squad), ', ' order by sort_order)
    into v_short
    from public.team_standings, public.auction_settings s
   where s.id = 1 and squad_count < s.min_squad;
  if v_short is not null and exists (select 1 from public.players where status in ('available', 'unsold')) then
    raise exception 'Every team needs at least the minimum squad before the auction can end. Short: %', v_short;
  end if;

  update public.auction_state
     set phase = 'ended', status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
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
         unsold_at = null, reauctioned = false, draw_no = null
   where true;
end
$$;

alter table public.auction_state drop column if exists unsold_round;
