-- The uploaded file name from Microsoft Forms embeds the respondent's account name and
-- whatever the original file was called, so it must not sit in the publicly readable table.

create or replace function public.import_players(p_players jsonb, p_replace boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next  integer;
  v_count integer;
begin
  perform public.assert_operator();

  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'There are no players to import.';
  end if;

  if p_replace then
    if exists (select 1 from public.players where status = 'sold') then
      raise exception 'Some players are already sold. Reset the auction before replacing the player pool.';
    end if;
    update public.auction_state
       set status = 'idle', current_player_id = null, current_bid = null,
           current_team_id = null, updated_at = now()
     where id = 1;
    delete from public.players where true;
  end if;

  select coalesce(max(lot_no), 0) into v_next from public.players;

  insert into public.players (
    lot_no, name, roll_no, batch, role, category, base_price,
    batting_style, bowling_style, highlight, is_wicketkeeper, photo_url
  )
  select
    v_next + e.ord::integer,
    btrim(e.item ->> 'name'),
    upper(btrim(e.item ->> 'roll_no')),
    nullif(btrim(e.item ->> 'batch'), ''),
    e.item ->> 'role',
    nullif(e.item ->> 'category', ''),
    (e.item ->> 'base_price')::integer,
    nullif(e.item ->> 'batting_style', ''),
    nullif(e.item ->> 'bowling_style', ''),
    nullif(e.item ->> 'highlight', ''),
    coalesce((e.item ->> 'is_wicketkeeper')::boolean, false),
    nullif(e.item ->> 'photo_url', '')
  from jsonb_array_elements(p_players) with ordinality as e(item, ord)
  on conflict (roll_no) do update set
    name            = excluded.name,
    batch           = excluded.batch,
    role            = excluded.role,
    category        = coalesce(excluded.category, public.players.category),
    base_price      = excluded.base_price,
    batting_style   = excluded.batting_style,
    bowling_style   = excluded.bowling_style,
    highlight       = coalesce(excluded.highlight, public.players.highlight),
    is_wicketkeeper = excluded.is_wicketkeeper,
    photo_url       = coalesce(excluded.photo_url, public.players.photo_url);

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

alter table public.players drop column if exists photo_file;
