-- ============================================================
-- BRIO · Migration 002 · Controllo magazzino
-- ============================================================
-- Aggiunge:
--   1. funzione product_max_qty(product_id) → quanti pezzi sono ancora
--      vendibili dato lo stock attuale (calcolo via ricette)
--   2. funzione product_availability_status(product_id) → 'available' /
--      'limited' / 'out_of_stock' (rispetta override su products.status)
--   3. trigger che BLOCCA il passaggio di un ordine a 'paid' se il
--      magazzino non basta per le righe ordine
--   4. view products_with_stock per le query lato client cassa/kiosk
-- ============================================================

-- ============================================================
-- 1. product_max_qty: ritorna il numero massimo di pezzi vendibili
-- ============================================================
-- Esempio: se la piadina classica usa 60g di prosciutto e in magazzino
-- ne ho 300g → posso vendere ancora 5 piadine (300/60).
-- Se il prodotto NON ha ricetta (nessuna riga in recipes), assumiamo
-- illimitato (ritorna 9999).
create or replace function public.product_max_qty(p_product_id uuid)
returns int
language sql stable
as $$
  with recipe_data as (
    select r.qty as recipe_qty, i.stock_qty
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product_id
      and i.active = true
  )
  select case
    when not exists (select 1 from recipe_data) then 9999
    else greatest(0, coalesce(floor(min(stock_qty / nullif(recipe_qty, 0))), 0))::int
  end
  from recipe_data;
$$;

-- ============================================================
-- 2. product_availability_status: stato di disponibilità
-- ============================================================
-- Considera sia lo stato manuale (products.status) sia il magazzino.
-- Ritorna: 'available' | 'limited' | 'out_of_stock' | 'hidden'
--   - 'hidden'        → status manuale 'hidden' (non mostrare nel kiosk)
--   - 'out_of_stock'  → status manuale 'out_of_stock' oppure max_qty = 0
--   - 'limited'       → max_qty < 5 (soglia "ultimi X")
--   - 'available'     → tutto OK
create or replace function public.product_availability_status(p_product_id uuid)
returns text
language sql stable
as $$
  select case
    when p.status = 'hidden' then 'hidden'
    when p.status = 'out_of_stock' then 'out_of_stock'
    when public.product_max_qty(p.id) <= 0 then 'out_of_stock'
    when public.product_max_qty(p.id) < 5 then 'limited'
    else 'available'
  end
  from public.products p
  where p.id = p_product_id;
$$;

-- ============================================================
-- 3. Trigger: blocca update orders.status → 'paid' se stock insufficiente
-- ============================================================
-- Quando un ordine sta per essere marcato come 'paid' o 'preparing',
-- verifichiamo per ogni order_item che ce ne sia abbastanza. Se non basta,
-- raise exception con messaggio chiaro che la cassa mostra all'operatrice.
--
-- NOTA: il trigger esiste già per scaricare il magazzino (tg_consume_ingredients,
-- AFTER). Questo nuovo trigger è BEFORE e blocca prima che lo scarico avvenga.
create or replace function public.tg_check_stock_before_paid()
returns trigger language plpgsql as $$
declare
  oi record;
  available int;
begin
  -- Solo se stiamo passando a uno stato che consuma magazzino
  if new.status not in ('paid','preparing') then
    return new;
  end if;
  -- Solo se è una transizione (non era già consumante)
  if tg_op = 'UPDATE' and old.status in ('paid','preparing') then
    return new;
  end if;

  for oi in
    select product_id, product_name, sum(qty) as total_qty
    from public.order_items
    where order_id = new.id
    group by product_id, product_name
  loop
    available := public.product_max_qty(oi.product_id);
    if oi.total_qty > available then
      raise exception 'Magazzino insufficiente per "%": disponibili %, richiesti %',
        oi.product_name, available, oi.total_qty
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_orders_check_stock on public.orders;
create trigger trg_orders_check_stock
  before insert or update of status on public.orders
  for each row
  execute function public.tg_check_stock_before_paid();

-- IMPORTANTE: l'ordine dei trigger BEFORE è alfabetico per nome.
-- trg_orders_check_stock < trg_orders_daily_number (entrambi BEFORE INSERT su orders).
-- È OK: prima genera numero giornaliero (no-op se stato pending), poi controlla stock.

-- ============================================================
-- 4. View: products_with_stock
-- ============================================================
-- Espone tutti i campi di products + max_qty + availability_status.
-- Le RLS di products si applicano via security_invoker.
drop view if exists public.products_with_stock;
create view public.products_with_stock
with (security_invoker = true) as
select
  p.*,
  public.product_max_qty(p.id) as max_qty,
  public.product_availability_status(p.id) as availability
from public.products p;

-- Fine migration 002
