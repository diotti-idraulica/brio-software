-- ============================================================
-- BRIO · Migration 008 · Integrazione cassa fiscale (RT + POS)
-- ============================================================
-- Aggiunge le tabelle di supporto per integrare hardware fiscale:
--  - rt_config: configurazione Registratore Telematico + POS bancario
--  - fiscal_receipts_log: log di ogni scontrino emesso (anche simulato)
--
-- Pattern preso da L'Essenza Estetica (CASSA_FISCALE_HANDOFF.md) e
-- adattato multi-tenant con org_id.
--
-- L'app NON emette scontrini fiscali (vietato D.Lgs. 127/2015):
-- dialoga con un RT certificato Agenzia Entrate via API HTTP/TCP.
-- ============================================================

-- ============================================================
-- 1. rt_config · configurazione hardware per organization
-- ============================================================
create table if not exists public.rt_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  -- Registratore Telematico
  rt_active boolean not null default false,
  rt_ip text,                              -- es. "192.168.1.50"
  rt_port int,                             -- es. 8080
  rt_model text,                           -- 'epson_fp90' | 'rch_printf' | 'custom_q3' | 'olivetti_prt100' | 'altro'
  rt_protocol text not null default 'http' check (rt_protocol in ('http','https','tcp')),
  rt_user text,
  rt_password text,                        -- TODO: encrypted at rest (vault?)
  rt_endpoint_path text,                   -- es. '/cgi-bin/fpmate.cgi' per Epson
  rt_timeout_sec int not null default 10,

  -- POS bancario
  pos_active boolean not null default false,
  pos_ip text,
  pos_port int,
  pos_brand text,                          -- 'ingenico' | 'pax' | 'verifone' | 'nexi' | 'sumup' | 'altro'
  pos_protocol text not null default 'p17' check (pos_protocol in ('p17','rest','altro')),
  pos_terminal_id text,
  pos_timeout_sec int not null default 60,

  -- Globale
  test_mode boolean not null default true, -- TRUE = simula, FALSE = hardware reale
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id)                          -- una config per organization
);

create index if not exists idx_rt_config_org on public.rt_config(org_id);

drop trigger if exists trg_rt_config_updated_at on public.rt_config;
create trigger trg_rt_config_updated_at
  before update on public.rt_config
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- 2. fiscal_receipts_log · log scontrini fiscali (anche simulati)
-- ============================================================
-- Ogni transazione lascia traccia qui: utile per debug, audit
-- Agenzia Entrate, riconciliazione con corrispettivi trasmessi.
create table if not exists public.fiscal_receipts_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,

  -- Identificativi scontrino
  receipt_number text,                     -- numero progressivo emesso dall'RT
  rt_serial text,                          -- matricola RT (es. "99AAA1234567")

  -- Importo + metodo
  amount_cents bigint not null,
  payment_method text,                     -- 'cash' | 'card' | 'mixed' | 'voucher' | 'points'

  -- Stato del flusso
  status text not null default 'in_progress' check (status in (
    'in_progress',  -- in corso
    'pos_ok',       -- POS ha confermato pagamento
    'rt_ok',        -- RT ha emesso scontrino
    'completed',    -- POS + RT entrambi OK
    'pos_error',    -- errore POS
    'rt_error',     -- errore RT
    'cancelled'     -- annullato manualmente
  )),
  error_msg text,

  -- Raw responses (debug)
  pos_response jsonb,
  rt_response jsonb,

  -- Test vs live
  test_mode boolean not null default false,

  -- Tracking utente
  emitted_by uuid references auth.users(id),

  created_at timestamptz not null default now()
);

create index if not exists idx_fr_log_org_date on public.fiscal_receipts_log(org_id, created_at desc);
create index if not exists idx_fr_log_order on public.fiscal_receipts_log(order_id);
create index if not exists idx_fr_log_status on public.fiscal_receipts_log(org_id, status) where status <> 'completed';

-- ============================================================
-- RLS
-- ============================================================
alter table public.rt_config enable row level security;
alter table public.fiscal_receipts_log enable row level security;

-- rt_config: leggibile da tutti i membri, scrivibile solo da admin
drop policy if exists "rt_config_read" on public.rt_config;
create policy "rt_config_read" on public.rt_config
  for select using (public.is_member_of(org_id));

drop policy if exists "rt_config_write_admin" on public.rt_config;
create policy "rt_config_write_admin" on public.rt_config
  for all using (public.is_member_of(org_id, array['admin']))
  with check (public.is_member_of(org_id, array['admin']));

-- fiscal_receipts_log: tutti i membri possono leggere/inserire (la cassa logga)
drop policy if exists "fr_log_read" on public.fiscal_receipts_log;
create policy "fr_log_read" on public.fiscal_receipts_log
  for select using (public.is_member_of(org_id));

drop policy if exists "fr_log_write" on public.fiscal_receipts_log;
create policy "fr_log_write" on public.fiscal_receipts_log
  for insert with check (public.is_member_of(org_id));

drop policy if exists "fr_log_update_admin" on public.fiscal_receipts_log;
create policy "fr_log_update_admin" on public.fiscal_receipts_log
  for update using (public.is_member_of(org_id, array['admin','manager']))
  with check (public.is_member_of(org_id, array['admin','manager']));

-- ============================================================
-- Bootstrap: configurazione vuota per la prima org (Brio)
-- ============================================================
insert into public.rt_config (org_id, test_mode, notes)
select id, true, 'Configurazione iniziale. In modalità test fino a installazione hardware.'
from public.organizations
where slug = 'brio'
on conflict (org_id) do nothing;

-- Fine migration 008
