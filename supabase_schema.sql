-- =============================================================================
-- Cyphronex-Bluevane  |  Supabase schema (run once in: Dashboard > SQL Editor)
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE.
--
-- Contents: profiles, contacts, conversations (direct | group | channel),
-- messages, statuses, storage buckets, RLS policies, helper RPCs, realtime.
-- NOTE: this replaces the earlier schema. The old participants policy queried
-- its own table, which makes Postgres fail with "infinite recursion detected
-- in policy". Membership checks now go through the SECURITY DEFINER function
-- public.is_member() instead.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Profiles (public to signed-in users) + private contact details
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  display_name text,
  cyphron_tag text unique,
  avatar_url text,
  bio text default 'Secured by Cyphronex-Bluevane',
  public_key text,            -- base64 raw ECDH P-256 public key (E2EE for direct chats)
  key_fingerprint text,       -- safety number shown in the app
  theme_preference jsonb default '{"id":"stealth"}'::jsonb,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Email / phone live in a separate owner-only table so they are never exposed
-- through the public profile list. They can only be matched via find_profile().
create table if not exists public.profile_private (
  id uuid references public.profiles(id) on delete cascade primary key,
  email text,
  phone text
);
create unique index if not exists profile_private_email_key on public.profile_private (lower(email)) where email is not null;
create unique index if not exists profile_private_phone_key on public.profile_private (phone) where phone is not null;

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;

drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "private select own" on public.profile_private;
create policy "private select own" on public.profile_private
  for select to authenticated using (auth.uid() = id);
drop policy if exists "private insert own" on public.profile_private;
create policy "private insert own" on public.profile_private
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "private update own" on public.profile_private;
create policy "private update own" on public.profile_private
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- 2. Contacts
-- -----------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  contact_user_id uuid references public.profiles(id) on delete cascade not null,
  status text check (status in ('pending','accepted','blocked')) default 'accepted',
  nickname text,
  safety_number_verified boolean default false,
  created_at timestamptz not null default now(),
  unique (user_id, contact_user_id),
  check (user_id <> contact_user_id)
);
alter table public.contacts enable row level security;

drop policy if exists "contacts select" on public.contacts;
create policy "contacts select" on public.contacts
  for select to authenticated using (auth.uid() = user_id or auth.uid() = contact_user_id);
drop policy if exists "contacts insert" on public.contacts;
create policy "contacts insert" on public.contacts
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "contacts update" on public.contacts;
create policy "contacts update" on public.contacts
  for update to authenticated using (auth.uid() = user_id);
drop policy if exists "contacts delete" on public.contacts;
create policy "contacts delete" on public.contacts
  for delete to authenticated using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. Conversations: direct chats, groups and channels
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid default gen_random_uuid() primary key,
  type text not null check (type in ('direct','group','channel')) default 'direct',
  name text,
  description text,
  avatar_url text,
  is_public boolean not null default false,   -- public channels show up in Discover
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('owner','admin','member')) default 'member',
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists cp_user_idx on public.conversation_participants (user_id);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;

-- Membership helpers (SECURITY DEFINER avoids recursive RLS evaluation)
create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_participants
                 where conversation_id = cid and user_id = auth.uid());
$$;

-- Direct + group: every member may post. Channel: only owner/admin may post.
create or replace function public.can_post(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    where cp.conversation_id = cid and cp.user_id = auth.uid()
      and (c.type <> 'channel' or cp.role in ('owner','admin'))
  );
$$;

drop policy if exists "conversations select" on public.conversations;
create policy "conversations select" on public.conversations
  for select to authenticated
  using (public.is_member(id) or (type = 'channel' and is_public));
drop policy if exists "conversations update" on public.conversations;
create policy "conversations update" on public.conversations
  for update to authenticated
  using (exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = conversations.id and cp.user_id = auth.uid() and cp.role in ('owner','admin')));

drop policy if exists "participants select" on public.conversation_participants;
create policy "participants select" on public.conversation_participants
  for select to authenticated using (public.is_member(conversation_id));
drop policy if exists "participants leave" on public.conversation_participants;
create policy "participants leave" on public.conversation_participants
  for delete to authenticated using (user_id = auth.uid());
-- (inserts happen only through the RPC functions below)

-- -----------------------------------------------------------------------------
-- 4. Messages (direct chats are end-to-end encrypted by the client)
--    encrypted_content/iv = AES-256-GCM ciphertext for direct chats.
--    For groups/channels the app stores plain text with iv = 'plain'
--    (protected by TLS + RLS, not end-to-end encrypted).
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  encrypted_content text not null default '',
  iv text not null default 'plain',
  message_type text check (message_type in ('text','file','image','audio','link','system')) default 'text',
  attachment_meta jsonb default null,  -- {path,name,size,mime,enc,iv}
  reactions jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);
alter table public.messages enable row level security;

drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select to authenticated using (public.is_member(conversation_id));
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post(conversation_id));
drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert after insert on public.messages
  for each row execute procedure public.touch_conversation();

-- -----------------------------------------------------------------------------
-- 5. Statuses (24-hour stories visible to you and your contacts)
-- -----------------------------------------------------------------------------
create table if not exists public.statuses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  kind text not null check (kind in ('text','image')) default 'text',
  content text,
  bg text default '#0284c7',
  media_url text,
  media_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists statuses_user_idx on public.statuses (user_id, created_at desc);
alter table public.statuses enable row level security;

drop policy if exists "statuses select" on public.statuses;
create policy "statuses select" on public.statuses
  for select to authenticated using (
    user_id = auth.uid()
    or (expires_at > now() and exists (
      select 1 from public.contacts c
      where c.status = 'accepted'
        and ((c.user_id = auth.uid() and c.contact_user_id = statuses.user_id)
          or (c.contact_user_id = auth.uid() and c.user_id = statuses.user_id))
    ))
  );
drop policy if exists "statuses insert" on public.statuses;
create policy "statuses insert" on public.statuses
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "statuses delete" on public.statuses;
create policy "statuses delete" on public.statuses
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. RPC functions used by the app
-- -----------------------------------------------------------------------------
-- Find a user by email, phone number, Cyphron tag (CYPH-XXXX-XXXX) or username.
-- Exact match only - it can never be used to list users.
create or replace function public.find_profile(identifier text)
returns table (id uuid, username text, display_name text, cyphron_tag text,
               avatar_url text, bio text, public_key text, key_fingerprint text)
language plpgsql stable security definer set search_path = public as $$
declare v text := btrim(identifier); d text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v is null or v = '' then return; end if;
  if position('@' in v) > 0 then
    return query select p.id, p.username, p.display_name, p.cyphron_tag, p.avatar_url, p.bio, p.public_key, p.key_fingerprint
      from public.profiles p join public.profile_private pp on pp.id = p.id
      where lower(pp.email) = lower(v) limit 1;
  elsif v ~ '^\+?[0-9 ().-]{7,}$' then
    d := regexp_replace(v, '[^0-9+]', '', 'g');
    return query select p.id, p.username, p.display_name, p.cyphron_tag, p.avatar_url, p.bio, p.public_key, p.key_fingerprint
      from public.profiles p join public.profile_private pp on pp.id = p.id
      where pp.phone = d limit 1;
  elsif upper(v) like 'CYPH-%' then
    return query select p.id, p.username, p.display_name, p.cyphron_tag, p.avatar_url, p.bio, p.public_key, p.key_fingerprint
      from public.profiles p where p.cyphron_tag = upper(v) limit 1;
  else
    return query select p.id, p.username, p.display_name, p.cyphron_tag, p.avatar_url, p.bio, p.public_key, p.key_fingerprint
      from public.profiles p where lower(p.username) = lower(v) limit 1;
  end if;
end $$;

-- Open (or reuse) a 1:1 chat with another user.
create or replace function public.start_direct_chat(other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if other = auth.uid() then raise exception 'cannot chat with yourself'; end if;
  select c.id into cid from public.conversations c
    where c.type = 'direct'
      and exists (select 1 from public.conversation_participants a where a.conversation_id = c.id and a.user_id = auth.uid())
      and exists (select 1 from public.conversation_participants b where b.conversation_id = c.id and b.user_id = other)
    limit 1;
  if cid is not null then return cid; end if;
  insert into public.conversations (type, created_by) values ('direct', auth.uid()) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id, role)
    values (cid, auth.uid(), 'member'), (cid, other, 'member');
  return cid;
end $$;

-- Create a group or channel; the caller becomes owner.
create or replace function public.create_conversation(p_type text, p_name text, p_description text,
                                                      p_is_public boolean, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_type not in ('group','channel') then raise exception 'invalid type'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  insert into public.conversations (type, name, description, is_public, created_by)
    values (p_type, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
            (p_type = 'channel' and coalesce(p_is_public,false)), auth.uid())
    returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id, role) values (cid, auth.uid(), 'owner');
  if p_members is not null then
    foreach m in array p_members loop
      if m <> auth.uid() then
        insert into public.conversation_participants (conversation_id, user_id, role)
          values (cid, m, 'member') on conflict do nothing;
      end if;
    end loop;
  end if;
  return cid;
end $$;

create or replace function public.join_channel(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = cid and type = 'channel' and is_public) then
    raise exception 'channel not found or not public';
  end if;
  insert into public.conversation_participants (conversation_id, user_id, role)
    values (cid, auth.uid(), 'member') on conflict do nothing;
end $$;

create or replace function public.add_members(cid uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if not exists (select 1 from public.conversation_participants cp
                 join public.conversations c on c.id = cp.conversation_id
                 where cp.conversation_id = cid and cp.user_id = auth.uid()
                   and cp.role in ('owner','admin') and c.type <> 'direct') then
    raise exception 'not allowed';
  end if;
  foreach m in array p_members loop
    insert into public.conversation_participants (conversation_id, user_id, role)
      values (cid, m, 'member') on conflict do nothing;
  end loop;
end $$;

grant execute on function public.find_profile(text) to authenticated;
grant execute on function public.start_direct_chat(uuid) to authenticated;
grant execute on function public.create_conversation(text,text,text,boolean,uuid[]) to authenticated;
grant execute on function public.join_channel(uuid) to authenticated;
grant execute on function public.add_members(uuid,uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Create a profile automatically on sign-up
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gen_tag text; uname text; ph text;
begin
  gen_tag := 'CYPH-' || upper(substr(md5(random()::text || new.id::text), 1, 4)) || '-' ||
                        upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
  uname := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)), '[^a-zA-Z0-9_]', '', 'g'));
  if uname is null or length(uname) < 3 or exists (select 1 from public.profiles where username = uname) then
    uname := coalesce(nullif(uname,''),'user') || substr(md5(new.id::text), 1, 5);
  end if;
  insert into public.profiles (id, username, display_name, cyphron_tag)
    values (new.id, uname,
            coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
            gen_tag);
  ph := nullif(regexp_replace(coalesce(new.phone, new.raw_user_meta_data->>'phone', ''), '[^0-9+]', '', 'g'), '');
  begin
    insert into public.profile_private (id, email, phone) values (new.id, lower(new.email), ph);
  exception when unique_violation then
    insert into public.profile_private (id, email, phone) values (new.id, lower(new.email), null);
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 8. Storage buckets + policies
--    avatars / statuses : public read, write only inside your own folder
--    attachments        : private; only conversation members, folder = conversation id
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('avatars','avatars',true), ('statuses','statuses',true), ('attachments','attachments',false)
on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id in ('avatars','statuses'));

drop policy if exists "avatars own write" on storage.objects;
create policy "avatars own write" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','statuses') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars','statuses') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars','statuses') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "attachments member read" on storage.objects;
create policy "attachments member read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "attachments member write" on storage.objects;
create policy "attachments member write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_post(((storage.foldername(name))[1])::uuid));

-- -----------------------------------------------------------------------------
-- 9. Realtime
-- -----------------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.statuses;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.conversation_participants;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.contacts;
exception when duplicate_object then null; end $$;
