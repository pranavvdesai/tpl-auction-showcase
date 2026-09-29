-- Rule change: base price is 30 points. The squad reserve and the final unsold draft use the
-- same figure, since no player can be bought for less than the base price.

update public.auction_state
   set status = 'idle', current_player_id = null, current_bid = null,
       current_team_id = null, updated_at = now()
 where id = 1;
update public.players
   set status = 'available', team_id = null, sold_price = null, sold_at = null
 where true;

alter table public.auction_settings alter column min_base set default 30;
update public.auction_settings set min_base = 30 where id = 1;
update public.players set base_price = 30 where true;

create or replace function public.sell_player(p_team_id uuid, p_amount integer)
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
  if v_state.status <> 'live' or v_state.current_player_id is null then
    raise exception 'No player is on the floor. Start a player first.';
  end if;

  select * into v_player from public.players where id = v_state.current_player_id for update;

  if p_amount is null or p_amount < v_player.base_price then
    raise exception 'Final amount must be at least the base price of % points.', v_player.base_price;
  end if;
  if not public.is_valid_bid(p_amount) then
    raise exception '% is not a valid bid. Bids rise in 10s up to 100, then in 20s (120, 140, 160 ...).', p_amount;
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= v_settings.max_squad then
    raise exception '% already has a full squad.', v_team.name;
  end if;
  if p_amount > v_team.max_bid then
    raise exception '% can spend at most % points (keeping % points for each player still needed to reach % players).',
      v_team.name, v_team.max_bid, v_settings.min_base, v_settings.min_squad;
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
