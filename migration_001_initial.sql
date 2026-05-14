-- ============================================================
-- BRIO · Migration 001 · Schema iniziale
-- ============================================================
-- Crea tutte le tabelle necessarie per l'MVP e oltre.
-- Pensato già multi-tenant (organizations) per supportare la V2.0 SaaS.
-- Tutti gli importi in centesimi (bigint), mai float.
-- RLS abilitato ovunque, filtra per org_id via tabella members.
-- ============================================================

-- ============================================================
-- 1. ORGANIZATIONS · una org per bar (Brio sarà la prima)
-- ============================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,                  -- es. "brio" per URL/dominio
  vat_number text,                            -- P.IVA
  tax_code text,                              -- codice fiscale
  address text,
  city text,
  zip text,
  province text,
  phone text,
  email text,
  logo_url text,
  -- Configurazioni operative
  open_hours jsonb default '{}'::jsonb,       -- {"mon":[{"open":"07:00","close":"21:00"}], ...}
  settings jsonb default '{}'::jsonb,         -- preferenze libere
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. MEMBERS · utenti auth.users collegati a una org con ruolo
-- ============================================================
-- Ruoli:
--   admin   = Stefano/Simone (soci, accesso totale)
--   manager = operatrice senior (cassa, magazzino, ordini, turni)
--   staff   = operatrice base (solo cassa, ordini al banco)
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','manager','staff')) default 'staff',
  full_name text,
  pin_code text,                              -- PIN 4 cifre per azioni sensibili (storno, sconto)
  hourly_rate_cents bigint,                   -- paga oraria lorda
  contract_type text,                         -- "full_time", "part_time", "on_call"
  hired_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_members_org on public.members(org_id);
create index if not exists idx_members_user on public.members(user_id);

-- ============================================================
-- 3. CATEGORIES · categorie del menu (caffetteria, pranzo, aperitivo, ecc)
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,                         -- "caffetteria", "pranzo", "aperitivo"
  icon text,                                  -- emoji o nome icona ("☕", "coffee")
  color text,                                 -- hex per UI (#10B981)
  sort_order int not null default 0,
  visible boolean not null default true,
  -- Visibilità per fascia oraria (null = sempre visibile)
  visible_from time,
  visible_to time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create index if not exists idx_categories_org on public.categories(org_id, sort_order);

-- ============================================================
-- 4. INGREDIENTS · materie prime + giacenze (= "inventory" delle specs)
-- ============================================================
create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  unit text not null,                         -- "g", "ml", "pezzo", "kg", "l"
  -- Giacenza corrente (in unit). Aggiornata automaticamente via trigger.
  stock_qty numeric(12,3) not null default 0,
  -- Soglie per allerta e ordini automatici
  min_stock_qty numeric(12,3) not null default 0,    -- sotto soglia → ordine
  critical_stock_qty numeric(12,3) not null default 0, -- sotto soglia critica → blocca prodotti
  -- Costo medio per unità (in centesimi). Aggiornato a ogni nuovo acquisto.
  cost_per_unit_cents bigint not null default 0,
  -- Fornitore preferito
  supplier_id uuid,                           -- FK a suppliers, settato dopo
  -- Scadenza più vicina del lotto corrente
  earliest_expiry_date date,
  -- Note libere ("conservare in frigo", ecc)
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ingredients_org on public.ingredients(org_id, active);
create index if not exists idx_ingredients_low on public.ingredients(org_id) where stock_qty <= min_stock_qty;

-- ============================================================
-- 5. PRODUCTS · voci del menu (caffè, piadina, birra, ecc)
-- ============================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price_cents bigint not null check (price_cents >= 0),
  vat_rate numeric(4,2) not null default 10.00, -- 10% food, 22% alcolici (poi configurabile)
  image_url text,
  sku text,                                   -- codice prodotto, opzionale
  -- Stato di disponibilità manuale (override automatica del magazzino)
  -- "available", "out_of_stock", "limited", "hidden"
  status text not null default 'available' check (status in ('available','out_of_stock','limited','hidden')),
  -- Personalizzazioni accettate (es. "senza cipolla", "decaffeinato")
  customizations jsonb default '[]'::jsonb,
  -- Tags per filtri (vegano, senza glutine, ecc)
  tags text[] default array[]::text[],
  sort_order int not null default 0,
  -- Scorciatoia tastiera in cassa (es. "F1" = caffè)
  shortcut_key text,
  -- Statistiche aggiornate da trigger
  total_sold int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_org_cat on public.products(org_id, category_id, sort_order);
create index if not exists idx_products_org_status on public.products(org_id, status);

-- ============================================================
-- 6. RECIPES · legame prodotto ↔ ingredienti con grammature
-- ============================================================
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  qty numeric(12,3) not null check (qty > 0), -- in unit dell'ingrediente
  created_at timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

create index if not exists idx_recipes_product on public.recipes(product_id);
create index if not exists idx_recipes_ingredient on public.recipes(ingredient_id);

-- ============================================================
-- 7. SUPPLIERS · fornitori (Bignami, Rustiko, Albasi, ecc)
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text,                              -- "vini", "salumi", "pane", ecc
  email text,
  phone text,
  whatsapp text,
  address text,
  vat_number text,
  -- Giorni e fasce orarie di consegna
  delivery_days int[] default array[]::int[], -- 1=lun ... 7=dom
  delivery_window_start time,
  delivery_window_end time,
  lead_time_days int not null default 1,      -- giorni tipici per consegna
  -- Auto-send: se true, l'ordine parte automaticamente senza approvazione
  auto_send boolean not null default false,
  -- Soglia oltre cui richiedere approvazione manuale (in centesimi)
  approval_threshold_cents bigint,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suppliers_org on public.suppliers(org_id, active);

-- Ora che esiste suppliers, aggiungo la FK su ingredients
alter table public.ingredients
  drop constraint if exists ingredients_supplier_fk;
alter table public.ingredients
  add constraint ingredients_supplier_fk
  foreign key (supplier_id) references public.suppliers(id) on delete set null;

-- ============================================================
-- 8. PURCHASE_ORDERS · ordini ai fornitori (testa)
-- ============================================================
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  number_seq int not null,                    -- numero progressivo annuale
  number_year int not null,                   -- anno
  -- Stato: draft (creato), pending (in approvazione), sent, confirmed, received, cancelled
  status text not null default 'draft' check (status in ('draft','pending','sent','confirmed','received','cancelled')),
  -- Origine
  origin text not null default 'auto' check (origin in ('auto','manual')),
  delivery_requested_date date,
  total_cents bigint not null default 0,
  notes text,
  -- Email tracking
  email_sent_at timestamptz,
  email_to text,
  email_message_id text,                      -- ID di Resend per tracking
  -- Approvazione
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  -- Ricezione
  received_at timestamptz,
  received_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number_year, number_seq)
);

create index if not exists idx_po_org_status on public.purchase_orders(org_id, status);
create index if not exists idx_po_supplier on public.purchase_orders(supplier_id);

-- ============================================================
-- 9. PURCHASE_ORDER_ITEMS · righe ordine fornitore
-- ============================================================
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  qty numeric(12,3) not null check (qty > 0),
  unit_price_cents bigint not null default 0,
  qty_received numeric(12,3),                 -- compilato alla ricezione
  unit_price_received_cents bigint,           -- prezzo effettivo, per storico
  notes text
);

create index if not exists idx_poi_po on public.purchase_order_items(purchase_order_id);

-- ============================================================
-- 10. CUSTOMERS · CRM clienti fidelity
-- ============================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Identificativi
  code text not null,                         -- codice univoco per QR/wallet (es. "BR-A1B2C3")
  email text,
  phone text,
  full_name text,
  birth_date date,
  -- Punti fidelity correnti
  points int not null default 0,
  total_spent_cents bigint not null default 0,
  visit_count int not null default 0,
  last_visit_at timestamptz,
  -- Consensi GDPR
  consent_marketing boolean not null default false,
  consent_marketing_at timestamptz,
  consent_profiling boolean not null default false,
  -- Preferenze libere ("sempre cappuccino senza schiuma")
  preferences text,
  notes text,
  -- Soft delete per GDPR
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create index if not exists idx_customers_org on public.customers(org_id) where deleted_at is null;
create index if not exists idx_customers_email on public.customers(org_id, email) where email is not null;
create index if not exists idx_customers_phone on public.customers(org_id, phone) where phone is not null;

-- ============================================================
-- 11. ORDERS · ordini cassa/kiosk/menu cliente
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Numero sequenziale giornaliero visualizzato al cliente (es. #47)
  daily_number int not null,
  daily_date date not null default current_date,
  -- Canale: cassa, kiosk, menu_qr (telefono cliente), ahead (ordine in anticipo)
  channel text not null check (channel in ('cassa','kiosk','menu_qr','ahead')),
  -- Stato: pending (in attesa pagamento), paid, preparing, ready, delivered, cancelled
  status text not null default 'pending' check (status in ('pending','paid','preparing','ready','delivered','cancelled')),
  -- Totale finale (centesimi)
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  total_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  -- Pagamento
  payment_method text check (payment_method in ('cash','card','meal_voucher','mixed','points','pending')),
  paid_cash_cents bigint default 0,
  paid_card_cents bigint default 0,
  paid_voucher_cents bigint default 0,
  paid_points int default 0,
  change_given_cents bigint default 0,        -- resto in contanti
  -- Cliente fidelity (opzionale)
  customer_id uuid references public.customers(id) on delete set null,
  -- Tavolo (per ordini dehor/sala con QR)
  table_number text,
  -- Note libere ("celiaco", "porta via")
  notes text,
  -- Operatrice che ha gestito (per ordini cassa)
  created_by uuid references auth.users(id),
  -- Tempistica
  prep_started_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  -- Scontrino digitale
  receipt_url text,
  receipt_qr_token text,                      -- token univoco per /scontrino/{token}
  -- Personalizzazioni nello scontrino digitale
  receipt_email_sent boolean default false,
  receipt_sms_sent boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, daily_date, daily_number)
);

create index if not exists idx_orders_org_status on public.orders(org_id, status, created_at desc);
create index if not exists idx_orders_org_date on public.orders(org_id, daily_date desc);
create index if not exists idx_orders_customer on public.orders(customer_id) where customer_id is not null;

-- ============================================================
-- 12. ORDER_ITEMS · righe ordine
-- ============================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,                 -- snapshot al momento dell'ordine
  qty int not null check (qty > 0),
  unit_price_cents bigint not null,           -- snapshot
  total_cents bigint not null,
  vat_rate numeric(4,2) not null,
  customizations jsonb default '[]'::jsonb,   -- ["senza cipolla", "decaffeinato"]
  notes text,
  -- Stato singolo item nel KDS
  kds_status text not null default 'queued' check (kds_status in ('queued','preparing','ready','served','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_oi_order on public.order_items(order_id);
create index if not exists idx_oi_product on public.order_items(product_id);
create index if not exists idx_oi_kds on public.order_items(kds_status) where kds_status in ('queued','preparing');

-- ============================================================
-- 13. INVENTORY_MOVEMENTS · storico movimenti magazzino
-- ============================================================
-- Ogni cambio di stock_qty su ingredients lascia traccia qui.
-- Tipo: 'sale' (vendita), 'purchase' (carico), 'waste' (spreco/rottura),
--       'adjustment' (rettifica inventario), 'transfer' (interno).
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  type text not null check (type in ('sale','purchase','waste','adjustment','transfer')),
  qty numeric(12,3) not null,                 -- positivo = carico, negativo = scarico
  unit_cost_cents bigint,                     -- costo unitario al momento del movimento
  -- Riferimenti opzionali
  order_id uuid references public.orders(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  reason text,                                -- motivo (es. "rotto durante pulizia")
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_im_ingredient_date on public.inventory_movements(ingredient_id, created_at desc);
create index if not exists idx_im_org_type on public.inventory_movements(org_id, type, created_at desc);

-- ============================================================
-- 14. TRANSACTIONS · movimenti cassa (incassi, scontrini, rimborsi)
-- ============================================================
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  type text not null check (type in ('sale','refund','correction','cash_in','cash_out')),
  amount_cents bigint not null,               -- positivo entrata, negativo uscita
  method text check (method in ('cash','card','meal_voucher','points','manual')),
  -- Numero scontrino fiscale (se applicabile)
  receipt_number text,
  receipt_date date,
  -- Tracking esterno (es. ID transazione SumUp/Stripe)
  external_id text,
  external_provider text,                     -- "sumup", "stripe", "nexi"
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_tx_org_date on public.transactions(org_id, created_at desc);
create index if not exists idx_tx_order on public.transactions(order_id);

-- ============================================================
-- 15. DAILY_CLOSE · chiusure cassa giornaliere
-- ============================================================
create table if not exists public.daily_close (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  close_date date not null,
  -- Totali calcolati da orders/transactions
  expected_cash_cents bigint not null default 0,
  expected_card_cents bigint not null default 0,
  expected_voucher_cents bigint not null default 0,
  expected_total_cents bigint not null default 0,
  -- Totali contati dall'operatrice
  counted_cash_cents bigint not null default 0,
  counted_card_cents bigint not null default 0,
  counted_voucher_cents bigint not null default 0,
  -- Differenze (counted - expected)
  diff_cash_cents bigint not null default 0,
  diff_card_cents bigint not null default 0,
  -- Statistiche
  orders_count int not null default 0,
  customers_count int not null default 0,
  avg_ticket_cents bigint not null default 0,
  -- Costo materie prime stimato
  cogs_cents bigint not null default 0,
  -- Note operatrice
  notes text,
  -- Chiuso da
  closed_by uuid references auth.users(id),
  closed_at timestamptz not null default now(),
  -- Report generato
  report_url text,
  unique (org_id, close_date)
);

create index if not exists idx_dc_org_date on public.daily_close(org_id, close_date desc);

-- ============================================================
-- 16. STAFF_SHIFTS · turni pianificati
-- ============================================================
create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  shift_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  break_minutes int default 0,
  role_in_shift text,                         -- "cassa", "preparazione", "sala"
  status text not null default 'planned' check (status in ('planned','confirmed','done','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shifts_org_date on public.staff_shifts(org_id, shift_date);
create index if not exists idx_shifts_member on public.staff_shifts(member_id, shift_date);

-- ============================================================
-- 17. STAFF_CLOCKINGS · timbrature
-- ============================================================
create table if not exists public.staff_clockings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  break_started_at timestamptz,
  break_ended_at timestamptz,
  shift_id uuid references public.staff_shifts(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_clockings_member on public.staff_clockings(member_id, clock_in_at desc);

-- ============================================================
-- 18. LOYALTY_TRANSACTIONS · movimenti punti fidelity
-- ============================================================
create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  type text not null check (type in ('earn','redeem','bonus','expire','adjustment')),
  points int not null,                        -- positivo accumulo, negativo riscatto
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_loyalty_customer on public.loyalty_transactions(customer_id, created_at desc);

-- ============================================================
-- TRIGGERS · updated_at automatico
-- ============================================================
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'organizations','members','categories','ingredients','products',
    'suppliers','purchase_orders','customers','orders','daily_close','staff_shifts'
  ])
  loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%s;', t, t);
    execute format('create trigger trg_%s_updated_at before update on public.%s for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================
-- TRIGGER · scaricamento automatico magazzino alla vendita
-- ============================================================
-- Quando un order_item viene inserito e l'order è già 'paid'/'preparing',
-- scarica le materie prime via le ricette.
-- Quando lo stato dell'ordine passa a 'paid' a posteriori, scarichiamo allora.
create or replace function public.tg_consume_ingredients()
returns trigger language plpgsql as $$
declare
  r record;
begin
  -- Solo se stato è uno di quelli che consumano (paid o preparing)
  if new.status not in ('paid','preparing') then
    return new;
  end if;
  -- Solo se è una transizione VERSO uno stato consumante (non già consumato prima)
  if tg_op = 'UPDATE' and old.status in ('paid','preparing') then
    return new;
  end if;

  for r in
    select ri.ingredient_id, ri.qty * oi.qty as total_qty, ing.cost_per_unit_cents
    from public.order_items oi
    join public.recipes ri on ri.product_id = oi.product_id
    join public.ingredients ing on ing.id = ri.ingredient_id
    where oi.order_id = new.id
  loop
    -- Scarica magazzino
    update public.ingredients
      set stock_qty = stock_qty - r.total_qty,
          updated_at = now()
      where id = r.ingredient_id;

    -- Traccia movimento
    insert into public.inventory_movements
      (org_id, ingredient_id, type, qty, unit_cost_cents, order_id)
    values
      (new.org_id, r.ingredient_id, 'sale', -r.total_qty, r.cost_per_unit_cents, new.id);
  end loop;

  return new;
end $$;

drop trigger if exists trg_orders_consume_ingredients on public.orders;
create trigger trg_orders_consume_ingredients
  after insert or update of status on public.orders
  for each row
  execute function public.tg_consume_ingredients();

-- ============================================================
-- TRIGGER · numerazione progressiva ordini fornitore
-- ============================================================
create or replace function public.tg_purchase_order_number()
returns trigger language plpgsql as $$
declare
  next_n int;
begin
  if new.number_seq is not null and new.number_seq > 0 then
    return new;
  end if;
  new.number_year := coalesce(new.number_year, extract(year from now())::int);
  select coalesce(max(number_seq), 0) + 1 into next_n
    from public.purchase_orders
    where org_id = new.org_id and number_year = new.number_year;
  new.number_seq := next_n;
  return new;
end $$;

drop trigger if exists trg_po_number on public.purchase_orders;
create trigger trg_po_number
  before insert on public.purchase_orders
  for each row execute function public.tg_purchase_order_number();

-- ============================================================
-- TRIGGER · numero ordine giornaliero (#1, #2, ...)
-- ============================================================
create or replace function public.tg_order_daily_number()
returns trigger language plpgsql as $$
declare
  next_n int;
begin
  if new.daily_number is not null and new.daily_number > 0 then
    return new;
  end if;
  select coalesce(max(daily_number), 0) + 1 into next_n
    from public.orders
    where org_id = new.org_id and daily_date = new.daily_date;
  new.daily_number := next_n;
  return new;
end $$;

drop trigger if exists trg_orders_daily_number on public.orders;
create trigger trg_orders_daily_number
  before insert on public.orders
  for each row execute function public.tg_order_daily_number();

-- ============================================================
-- HELPER FUNCTION · is_member_of(org_id, [roles])
-- ============================================================
create or replace function public.is_member_of(p_org uuid, p_roles text[] default null)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.active = true
      and (p_roles is null or m.role = any(p_roles))
  )
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.ingredients enable row level security;
alter table public.products enable row level security;
alter table public.recipes enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.transactions enable row level security;
alter table public.daily_close enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.staff_clockings enable row level security;
alter table public.loyalty_transactions enable row level security;

-- organizations: leggibile solo se membro
drop policy if exists "org_read_members" on public.organizations;
create policy "org_read_members" on public.organizations
  for select using (public.is_member_of(id));

drop policy if exists "org_write_admin" on public.organizations;
create policy "org_write_admin" on public.organizations
  for update using (public.is_member_of(id, array['admin']))
  with check (public.is_member_of(id, array['admin']));

-- members: leggibile da membri dell'org, scrivibile da admin
drop policy if exists "members_read" on public.members;
create policy "members_read" on public.members
  for select using (public.is_member_of(org_id));

drop policy if exists "members_write_admin" on public.members;
create policy "members_write_admin" on public.members
  for all using (public.is_member_of(org_id, array['admin']))
  with check (public.is_member_of(org_id, array['admin']));

-- Macro per tabelle org_id: read = membri, write = admin+manager
do $$
declare tbl text;
begin
  for tbl in select unnest(array[
    'categories','ingredients','products','recipes','suppliers',
    'purchase_orders','purchase_order_items','customers',
    'orders','order_items','inventory_movements','transactions',
    'daily_close','staff_shifts','staff_clockings','loyalty_transactions'
  ])
  loop
    execute format('drop policy if exists "%I_read" on public.%I;', tbl, tbl);
    execute format('drop policy if exists "%I_write" on public.%I;', tbl, tbl);
    -- purchase_order_items e order_items non hanno org_id diretto, gestiamo dopo
  end loop;
end $$;

-- categories
create policy "categories_read" on public.categories for select using (public.is_member_of(org_id));
create policy "categories_write" on public.categories for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- ingredients
create policy "ingredients_read" on public.ingredients for select using (public.is_member_of(org_id));
create policy "ingredients_write" on public.ingredients for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- products
create policy "products_read" on public.products for select using (public.is_member_of(org_id));
create policy "products_write" on public.products for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- recipes
create policy "recipes_read" on public.recipes for select using (public.is_member_of(org_id));
create policy "recipes_write" on public.recipes for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- suppliers
create policy "suppliers_read" on public.suppliers for select using (public.is_member_of(org_id));
create policy "suppliers_write" on public.suppliers for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- purchase_orders (read tutti, write admin+manager)
create policy "po_read" on public.purchase_orders for select using (public.is_member_of(org_id));
create policy "po_write" on public.purchase_orders for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- purchase_order_items via parent
create policy "poi_read" on public.purchase_order_items for select using (
  exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and public.is_member_of(po.org_id))
);
create policy "poi_write" on public.purchase_order_items for all using (
  exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and public.is_member_of(po.org_id, array['admin','manager']))
) with check (
  exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and public.is_member_of(po.org_id, array['admin','manager']))
);

-- customers
create policy "customers_read" on public.customers for select using (public.is_member_of(org_id));
create policy "customers_write" on public.customers for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- orders: tutti i membri leggono e scrivono (anche staff per battere cassa)
create policy "orders_read" on public.orders for select using (public.is_member_of(org_id));
create policy "orders_write" on public.orders for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- order_items via parent
create policy "oi_read" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and public.is_member_of(o.org_id))
);
create policy "oi_write" on public.order_items for all using (
  exists (select 1 from public.orders o where o.id = order_id and public.is_member_of(o.org_id))
) with check (
  exists (select 1 from public.orders o where o.id = order_id and public.is_member_of(o.org_id))
);

-- inventory_movements
create policy "im_read" on public.inventory_movements for select using (public.is_member_of(org_id));
create policy "im_write" on public.inventory_movements for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- transactions
create policy "tx_read" on public.transactions for select using (public.is_member_of(org_id));
create policy "tx_write" on public.transactions for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- daily_close
create policy "dc_read" on public.daily_close for select using (public.is_member_of(org_id));
create policy "dc_write" on public.daily_close for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- staff_shifts
create policy "shifts_read" on public.staff_shifts for select using (public.is_member_of(org_id));
create policy "shifts_write" on public.staff_shifts for all using (public.is_member_of(org_id, array['admin','manager'])) with check (public.is_member_of(org_id, array['admin','manager']));

-- staff_clockings (ogni operatrice può timbrare se stessa, admin vede tutti)
create policy "clk_read" on public.staff_clockings for select using (public.is_member_of(org_id));
create policy "clk_write" on public.staff_clockings for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- loyalty
create policy "loy_read" on public.loyalty_transactions for select using (public.is_member_of(org_id));
create policy "loy_write" on public.loyalty_transactions for all using (public.is_member_of(org_id)) with check (public.is_member_of(org_id));

-- ============================================================
-- BOOTSTRAP · prima organization Brio
-- ============================================================
insert into public.organizations (name, slug, vat_number, city, province)
values ('Brio', 'brio', null, 'Piacenza', 'PC')
on conflict (slug) do nothing;

-- Fine migration 001
