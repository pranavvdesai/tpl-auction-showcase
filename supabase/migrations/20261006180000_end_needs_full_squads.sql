-- The operator can only close the auction early once every team has at least the minimum squad.
-- (draw_next_player still ends it by itself when the pool runs out or no team can buy.)

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
  if v_short is not null then
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
