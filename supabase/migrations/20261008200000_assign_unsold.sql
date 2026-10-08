-- When no team can afford the base price any more, the operator places unsold players
-- into teams that still have room, free of charge (0 points). revert_sale puts them
-- back on the unsold list because they are marked reauctioned.

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.players'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%sold_price%'
  loop
    execute format('alter table public.players drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.players
  add constraint players_sold_price_check check (sold_price is null or sold_price >= 0);

create or replace function public.assign_unsold_player(p_player_id uuid, p_team_id uuid)
returns void
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
  if v_state.phase not in ('lots', 'unsold', 'ended') then
    raise exception 'The auction has not started yet.';
  end if;
  if v_state.status = 'live' then
    raise exception 'Close the current player (sold or unsold) first.';
  end if;

  select * into v_player from public.players where id = p_player_id for update;
  if not found or v_player.status <> 'unsold' then
    raise exception 'That player is not on the unsold list.';
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= v_settings.max_squad then
    raise exception '% already has the maximum of % players.', v_team.name, v_settings.max_squad;
  end if;

  update public.players
     set status = 'sold', team_id = p_team_id, sold_price = 0, sold_at = now(), reauctioned = true
   where id = v_player.id;
end
$$;

revoke execute on function public.assign_unsold_player(uuid, uuid) from public, anon;
grant execute on function public.assign_unsold_player(uuid, uuid) to authenticated;
