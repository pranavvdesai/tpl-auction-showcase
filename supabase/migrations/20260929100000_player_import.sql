-- Import players from the registration form export (Excel + photos).
-- Contact details are never stored: the importer only sends display fields.

alter table public.players alter column category drop not null;
alter table public.players alter column batch drop not null;
alter table public.players add column if not exists is_wicketkeeper boolean not null default false;
alter table public.players add column if not exists photo_url text;
alter table public.players add column if not exists photo_file text;
alter table public.players add constraint players_roll_no_key unique (roll_no);

-- ---------------------------------------------------------------------------
-- Photo storage: public read (projection screen), operator-only writes.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "operators read player photos" on storage.objects
  for select to authenticated using (bucket_id = 'player-photos' and public.is_operator());
create policy "operators upload player photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'player-photos' and public.is_operator());
create policy "operators update player photos" on storage.objects
  for update to authenticated using (bucket_id = 'player-photos' and public.is_operator());
create policy "operators delete player photos" on storage.objects
  for delete to authenticated using (bucket_id = 'player-photos' and public.is_operator());

-- ---------------------------------------------------------------------------
-- Import functions
-- ---------------------------------------------------------------------------

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
    batting_style, bowling_style, highlight, is_wicketkeeper, photo_url, photo_file
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
    nullif(e.item ->> 'photo_url', ''),
    nullif(e.item ->> 'photo_file', '')
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
    photo_url       = coalesce(excluded.photo_url, public.players.photo_url),
    photo_file      = coalesce(excluded.photo_file, public.players.photo_file);

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.set_player_photos(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.assert_operator();

  update public.players p
     set photo_url = i.item ->> 'photo_url'
    from jsonb_array_elements(p_items) as i(item)
   where p.roll_no = upper(btrim(i.item ->> 'roll_no'));

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.remove_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_operator();

  if exists (select 1 from public.auction_state where id = 1 and current_player_id = p_player_id and status = 'live') then
    raise exception 'This player is on the floor. Take them off the screen first.';
  end if;

  if not exists (select 1 from public.players where id = p_player_id and status <> 'sold') then
    raise exception 'Player not found, or already sold (revert the sale first).';
  end if;

  update public.auction_state
     set status = 'idle', current_player_id = null, current_bid = null,
         current_team_id = null, updated_at = now()
   where id = 1 and current_player_id = p_player_id;

  delete from public.players where id = p_player_id;
end
$$;

revoke execute on function
  public.import_players(jsonb, boolean), public.set_player_photos(jsonb), public.remove_player(uuid)
  from public, anon;
grant execute on function
  public.import_players(jsonb, boolean), public.set_player_photos(jsonb), public.remove_player(uuid)
  to authenticated;
