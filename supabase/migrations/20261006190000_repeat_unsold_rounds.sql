-- Round 1 is the lots; round 2 brings back every unsold player once.
-- If any team is still below the minimum squad after that, the unsold players come back again
-- (round 3, 4, ...) until every team reaches the minimum or nobody is left unsold.
-- From round 3 on the operator may close the auction even with short squads.

alter table public.auction_state add column if not exists unsold_round integer;

create or replace function public.teams_short()
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
     where s.id = 1 and t.squad_count < s.min_squad and t.max_bid >= s.min_base
  )
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
  v_round integer;
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

  v_round := v_state.unsold_round;

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

      if not found and public.teams_short()
         and exists (select 1 from public.players where status = 'unsold') then
        update public.players set reauctioned = false where status = 'unsold';
        v_round := coalesce(v_round, 2) + 1;
        select * into v_pick
          from public.players
         where status = 'unsold'
         order by unsold_at nulls last, lot_no
         limit 1
           for update;
      end if;

      if v_pick.id is not null then
        v_phase := 'unsold';
        v_round := coalesce(v_round, 2);
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

  update public.players
     set draw_no = (select coalesce(max(draw_no), 0) + 1 from public.players)
   where id = v_pick.id and draw_no is null;

  update public.auction_state
     set phase = v_phase,
         current_lot = coalesce(v_lot, current_lot),
         unsold_round = v_round,
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
  if v_short is not null and coalesce(v_state.unsold_round, 0) < 3 then
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
         unsold_round = null, updated_at = now()
   where id = 1;
  update public.players
     set status = 'available', team_id = null, sold_price = null, sold_at = null,
         unsold_at = null, reauctioned = false, draw_no = null
   where true;
end
$$;
