-- ============================================================
-- BRIO · Migration 007 · Viste per Dashboard e Chiusura cassa
-- ============================================================
-- Aggiunge viste SQL che pre-aggregano dati per:
--  - dashboard giornaliera (fatturato, ticket medio, food cost %)
--  - chiusura cassa (atteso contanti/carta/buoni vs contato)
--  - top prodotti settimana
--
-- Tutte le viste usano security_invoker=true: RLS di orders/order_items
-- si propaga automaticamente per multi-tenancy.
-- ============================================================

-- ============================================================
-- 1. daily_revenue · ricavi giornalieri per org
-- ============================================================
-- Solo ordini effettivamente conclusi (paid/preparing/ready/delivered).
-- Esclude pending e cancelled.
drop view if exists public.daily_revenue cascade;
create view public.daily_revenue
with (security_invoker = true) as
select
  o.org_id,
  o.daily_date,
  count(*)::int                                        as orders_count,
  coalesce(sum(o.total_cents), 0)::bigint              as revenue_cents,
  coalesce(sum(o.subtotal_cents), 0)::bigint           as subtotal_cents,
  coalesce(sum(o.vat_cents), 0)::bigint                as vat_cents,
  coalesce(sum(o.discount_cents), 0)::bigint           as discount_cents,
  case when count(*) > 0
       then (sum(o.total_cents)/count(*))::bigint
       else 0::bigint end                              as avg_ticket_cents,
  count(distinct o.customer_id) filter (where o.customer_id is not null)::int as fidelity_customers_count
from public.orders o
where o.status in ('paid','preparing','ready','delivered')
group by o.org_id, o.daily_date;

-- ============================================================
-- 2. daily_cogs · costo materie prime giornaliero (Cost of Goods Sold)
-- ============================================================
-- Calcolato dai movimenti magazzino di tipo 'sale' (negativi = scaricamento).
-- La data è la data del movimento (timezone Europe/Rome).
drop view if exists public.daily_cogs cascade;
create view public.daily_cogs
with (security_invoker = true) as
select
  im.org_id,
  ((im.created_at at time zone 'Europe/Rome'))::date as cogs_date,
  coalesce(sum(-im.qty * coalesce(im.unit_cost_cents, 0)), 0)::bigint as cogs_cents
from public.inventory_movements im
where im.type = 'sale'
group by im.org_id, ((im.created_at at time zone 'Europe/Rome'))::date;

-- ============================================================
-- 3. daily_cash_expected · totali attesi per chiusura cassa
-- ============================================================
-- Quanto dovrebbe esserci in cassa di contanti/carta/buoni a fine giornata.
drop view if exists public.daily_cash_expected cascade;
create view public.daily_cash_expected
with (security_invoker = true) as
select
  o.org_id,
  o.daily_date,
  coalesce(sum(o.paid_cash_cents), 0)::bigint     as cash_cents,
  coalesce(sum(o.paid_card_cents), 0)::bigint     as card_cents,
  coalesce(sum(o.paid_voucher_cents), 0)::bigint  as voucher_cents,
  coalesce(sum(o.change_given_cents), 0)::bigint  as change_given_cents,
  coalesce(sum(o.total_cents), 0)::bigint         as total_cents,
  count(*)::int                                   as orders_count
from public.orders o
where o.status in ('paid','preparing','ready','delivered')
  and o.payment_method in ('cash','card','meal_voucher','mixed','points')
group by o.org_id, o.daily_date;

-- ============================================================
-- 4. top_products_window · top prodotti per periodo
-- ============================================================
-- Restituisce i prodotti più venduti negli ultimi N giorni con qty venduta
-- e fatturato. Usato per dashboard "Top 10 settimana".
drop function if exists public.top_products_window(uuid, int, int);
create or replace function public.top_products_window(
  p_org_id uuid,
  p_days int default 7,
  p_limit int default 10
)
returns table (
  product_id uuid,
  product_name text,
  qty_sold bigint,
  revenue_cents bigint
)
language sql stable
as $$
  select
    oi.product_id,
    oi.product_name,
    sum(oi.qty)::bigint as qty_sold,
    sum(oi.total_cents)::bigint as revenue_cents
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.org_id = p_org_id
    and o.status in ('paid','preparing','ready','delivered')
    and o.daily_date >= (current_date - p_days)
  group by oi.product_id, oi.product_name
  order by qty_sold desc
  limit p_limit;
$$;

-- ============================================================
-- 5. hourly_revenue_today · vendite per fascia oraria
-- ============================================================
-- Usato dalla dashboard per heatmap orari oggi.
drop function if exists public.hourly_revenue_today(uuid);
create or replace function public.hourly_revenue_today(p_org_id uuid)
returns table (
  hour int,
  orders_count int,
  revenue_cents bigint
)
language sql stable
as $$
  with hours as (
    select generate_series(0, 23) as h
  ),
  sales as (
    select
      extract(hour from (o.created_at at time zone 'Europe/Rome'))::int as h,
      count(*)::int as cnt,
      sum(o.total_cents)::bigint as rev
    from public.orders o
    where o.org_id = p_org_id
      and o.daily_date = current_date
      and o.status in ('paid','preparing','ready','delivered')
    group by 1
  )
  select hours.h as hour,
         coalesce(sales.cnt, 0) as orders_count,
         coalesce(sales.rev, 0)::bigint as revenue_cents
  from hours
  left join sales on sales.h = hours.h
  order by hours.h;
$$;

-- ============================================================
-- 6. revenue_last_30days · serie fatturato giornaliero
-- ============================================================
-- Restituisce 30 giorni di fatturato per il grafico trend dashboard.
drop function if exists public.revenue_last_30days(uuid);
create or replace function public.revenue_last_30days(p_org_id uuid)
returns table (
  day date,
  revenue_cents bigint,
  orders_count int
)
language sql stable
as $$
  with days as (
    select (current_date - g)::date as d
    from generate_series(0, 29) g
  )
  select days.d as day,
         coalesce(dr.revenue_cents, 0)::bigint as revenue_cents,
         coalesce(dr.orders_count, 0) as orders_count
  from days
  left join public.daily_revenue dr
         on dr.daily_date = days.d
        and dr.org_id = p_org_id
  order by days.d asc;
$$;

-- Fine migration 007
