-- Players are numbered in the order they are drawn: the first player on the floor is Player No. 1.
-- A player keeps his number if he comes back in the unsold round or after a reverted sale.

alter table public.players add column if not exists draw_no integer;

update public.players p
   set draw_no = n.rn
  from (
    select id, row_number() over (order by coalesce(sold_at, unsold_at, now()), lot_no) as rn
      from public.players
     where status <> 'available' or id = (select current_player_id from public.auction_state where id = 1)
  ) n
 where p.id = n.id and p.draw_no is null;

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
