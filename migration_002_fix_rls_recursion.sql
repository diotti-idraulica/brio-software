-- ============================================================
-- BRIO · Migration 002 · Fix RLS ricorsivo su members
-- ============================================================
-- Problema:
--   La policy "members_read" usava is_member_of(org_id) che esegue
--   SELECT su public.members → applica RLS → chiama is_member_of → loop.
--   Risultato: error 500 su qualsiasi select da members.
--
-- Soluzione:
--   1) Marcare is_member_of come SECURITY DEFINER → bypassa RLS quando
--      chiamata dentro le policy di ALTRE tabelle.
--   2) Sostituire le policy di members con regole non-ricorsive basate
--      su auth.uid() direttamente.
-- ============================================================

-- 1. Funzione is_member_of SECURITY DEFINER (bypassa RLS internamente)
create or replace function public.is_member_of(p_org uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.active = true
      and (p_roles is null or m.role = any(p_roles))
  )
$$;

-- 2. Drop e ricrea policy di members senza ricorsione
drop policy if exists "members_read" on public.members;
drop policy if exists "members_write_admin" on public.members;

-- Ogni utente vede SEMPRE le proprie righe member (zero ricorsione)
create policy "members_read_self" on public.members
  for select using (user_id = auth.uid());

-- Gli admin di un'org vedono tutti i member di quella org
-- (la funzione is_member_of è SECURITY DEFINER, quindi qui non c'è loop)
create policy "members_read_admin" on public.members
  for select using (public.is_member_of(org_id, array['admin']));

-- Solo admin può inserire/modificare/eliminare member di una org
create policy "members_write_admin" on public.members
  for all
  using (public.is_member_of(org_id, array['admin']))
  with check (public.is_member_of(org_id, array['admin']));

-- 3. Garantisce che authenticated possa eseguire la funzione
grant execute on function public.is_member_of(uuid, text[]) to authenticated, anon;

-- Fine migration 002
