-- The operator sets the lot order before the auction; the projection plays it as a spinning-arrow draw.

create or replace function public.set_lot_order(p_order text[])
returns public.auction_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.auction_state;
begin
  perform public.assert_operator();

  if p_order is null
     or array_length(p_order, 1) <> 3
     or (select count(distinct l) from unnest(p_order) as t(l)) <> 3
     or not (p_order <@ array['Batter', 'Bowler', 'All-rounder']) then
    raise exception 'Pick each lot (Batsmen, Bowlers, All-rounders) exactly once.';
  end if;

  select * into v_state from public.auction_state where id = 1 for update;
  if v_state.phase <> 'setup' then
    raise exception 'The lot order has already been set.';
  end if;
  if exists (select 1 from public.players where status <> 'available') then
    raise exception 'Some players are already sold or unsold. Reset the auction before setting the lot order.';
  end if;

  update public.auction_state
     set phase = 'ready',
         lot_order = p_order,
         current_lot = null,
         lot_order_drawn_at = now(),
         status = 'idle', current_player_id = null, current_bid = null, current_team_id = null,
         updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

-- Lets the operator go back and change the order before the auction begins.
create or replace function public.clear_lot_order()
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
    raise exception 'The lot order can only be changed before the auction begins.';
  end if;

  update public.auction_state
     set phase = 'setup', lot_order = null, current_lot = null, lot_order_drawn_at = null,
         updated_at = now()
   where id = 1
  returning * into v_state;
  return v_state;
end
$$;

revoke execute on function public.set_lot_order(text[]), public.clear_lot_order() from public, anon;
grant execute on function public.set_lot_order(text[]), public.clear_lot_order() to authenticated;
