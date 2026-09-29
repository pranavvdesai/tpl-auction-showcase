-- TPL Player Auction Rulebook: 1,200-point purse, optional 200-point playing-owner retention
-- (counts as one squad player), squads of 13-16, base price 10, and final amounts on the
-- bidding ladder: steps of 10 up to 100, then steps of 20 (120, 140, ...).

-- Sales made under the old purse would leave negative balances, so start clean.
update public.auction_state
   set status = 'idle', current_player_id = null, current_bid = null,
       current_team_id = null, updated_at = now()
 where id = 1;
update public.players
   set status = 'available', team_id = null, sold_price = null, sold_at = null
 where true;

alter table public.auction_settings add column if not exists retention_cost integer not null default 200
  check (retention_cost >= 0);
alter table public.auction_settings alter column min_squad set default 13;
alter table public.auction_settings alter column max_squad set default 16;
alter table public.auction_settings alter column min_base set default 10;
update public.auction_settings set min_squad = 13, max_squad = 16, min_base = 10, retention_cost = 200 where id = 1;

alter table public.teams add column if not exists retained_owner text;
alter table public.teams alter column purse_total set default 1200;
update public.teams set purse_total = 1200, captain = null where true;

update public.players set base_price = 10 where true;

-- ---------------------------------------------------------------------------
-- Bidding ladder
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_bid(p_amount integer)
returns boolean
language sql
immutable
as $$
  select p_amount is not null and p_amount >= 10 and case
    when p_amount <= 100 then p_amount % 10 = 0
    else (p_amount - 100) % 20 = 0
  end
$$;

create or replace function public.floor_to_bid(p_amount integer)
returns integer
language sql
immutable
as $$
  select case
    when p_amount < 10 then 0
    when p_amount <= 100 then p_amount / 10 * 10
    else 100 + (p_amount - 100) / 20 * 20
  end
$$;

grant execute on function public.is_valid_bid(integer), public.floor_to_bid(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Team standings with owner retention
-- ---------------------------------------------------------------------------

drop view if exists public.team_standings;

create view public.team_standings
with (security_invoker = true) as
with totals as (
  select
    t.id, t.name, t.short_code, t.color, t.captain, t.retained_owner, t.sort_order, t.purse_total,
    case when t.retained_owner is not null then s.retention_cost else 0 end
      + coalesce(sum(p.sold_price), 0)                                          as spent,
    count(p.id) + case when t.retained_owner is not null then 1 else 0 end    as squad,
    s.min_squad, s.max_squad, s.min_base
  from public.teams t
  cross join public.auction_settings s
  left join public.players p on p.team_id = t.id and p.status = 'sold'
  group by t.id, s.retention_cost, s.min_squad, s.max_squad, s.min_base
)
select
  id, name, short_code, color, captain, retained_owner, sort_order, purse_total,
  spent::integer                                   as spent,
  (purse_total - spent)::integer                   as remaining,
  squad::integer                                   as squad_count,
  case
    when squad >= max_squad then 0
    else public.floor_to_bid(
      greatest(purse_total - spent - greatest(min_squad - squad - 1, 0) * min_base, 0)::integer
    )
  end::integer                                     as max_bid,
  greatest(min_squad - squad, 0)::integer          as needed
from totals;

grant select on public.team_standings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

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
  if not public.is_valid_bid(p_amount) then
    raise exception '% is not a valid bid. Bids rise in 10s up to 100, then in 20s (120, 140, 160 ...).', p_amount;
  end if;

  select * into v_team from public.team_standings where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  if v_team.squad_count >= (select max_squad from public.auction_settings) then
    raise exception '% already has a full squad.', v_team.name;
  end if;
  if p_amount > v_team.max_bid then
    raise exception '% can spend at most % points (keeping 10 points for each player still needed to reach the minimum squad).',
      v_team.name, v_team.max_bid;
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

create or replace function public.set_retained_owner(p_team_id uuid, p_owner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  if exists (select 1 from public.players where status = 'sold') then
    raise exception 'Owner retention must be declared before the auction begins. Reset the auction to change it.';
  end if;

  update public.teams set retained_owner = nullif(btrim(p_owner), '') where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
end
$$;

revoke execute on function public.set_retained_owner(uuid, text) from public, anon;
grant execute on function public.set_retained_owner(uuid, text) to authenticated;
