-- Contact numbers for the team sheets handed out after the auction. Players are publicly readable
-- (the projection uses the anon key), so phone numbers live in their own table that only
-- operators can read. Keyed by roll number so they survive a "replace" re-import.

create table if not exists public.player_contacts (
  roll_no    text primary key,
  phone      text,
  updated_at timestamptz not null default now()
);

alter table public.player_contacts enable row level security;
revoke all on public.player_contacts from anon, authenticated;
grant select on public.player_contacts to authenticated;

drop policy if exists "operators read contacts" on public.player_contacts;
create policy "operators read contacts" on public.player_contacts
  for select to authenticated using (public.is_operator());

create or replace function public.save_contacts(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.assert_operator();

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Contacts must be a list.';
  end if;

  insert into public.player_contacts (roll_no, phone, updated_at)
  select upper(btrim(e ->> 'roll_no')), nullif(btrim(e ->> 'phone'), ''), now()
    from jsonb_array_elements(p_items) as e
   where nullif(btrim(e ->> 'roll_no'), '') is not null
  on conflict (roll_no) do update
    set phone = coalesce(excluded.phone, public.player_contacts.phone),
        updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.save_contacts(jsonb) from public, anon;
grant execute on function public.save_contacts(jsonb) to authenticated;
