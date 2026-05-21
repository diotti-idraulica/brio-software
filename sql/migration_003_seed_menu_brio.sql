-- ============================================================
-- BRIO · Migration 003 · Seed iniziale menu, fornitori, ricette
-- ============================================================
-- Carica:
--   - 3 categorie (caffetteria, pranzo, aperitivo)
--   - 13 fornitori reali Piacenza (vedi BRIO_CONTEXT.md §6)
--   - 30 ingredienti con costo e soglie
--   - 20 prodotti del menu reale (vedi BRIO_CONTEXT.md §5)
--   - Ricette per ogni prodotto
--
-- Idempotente: usa ON CONFLICT DO NOTHING dove possibile.
-- Tutti i riferimenti all'org via subquery `(select id from organizations where slug='brio')`.
-- Indicizzazione: campo unique aggiunto al volo dove serve (sku, slug, name).
-- ============================================================

-- ============================================================
-- 0. Cleanup eventuale esecuzione precedente fallita + indici unique
-- ============================================================
-- Drop del constraint deferrable se rimasto dalla precedente run (era buggy)
alter table public.products drop constraint if exists products_org_sku_unique;

-- Unique index normali (NON deferrable) — necessari come arbitri ON CONFLICT
create unique index if not exists ux_products_org_sku    on public.products(org_id, sku);
create unique index if not exists ux_ingredients_org_name on public.ingredients(org_id, lower(name));
create unique index if not exists ux_suppliers_org_name   on public.suppliers(org_id, lower(name));

-- ============================================================
-- 1. CATEGORIE
-- ============================================================
insert into public.categories (org_id, name, slug, icon, color, sort_order) values
  ((select id from public.organizations where slug='brio'), 'Caffetteria', 'caffetteria', '☕', '#0A0907', 10),
  ((select id from public.organizations where slug='brio'), 'Pranzo',      'pranzo',      '🥪', '#10B981', 20),
  ((select id from public.organizations where slug='brio'), 'Aperitivo',   'aperitivo',   '🍷', '#1E3A8A', 30)
on conflict (org_id, slug) do nothing;

-- ============================================================
-- 2. FORNITORI (anagrafica Piacenza)
-- ============================================================
insert into public.suppliers (org_id, name, category, email, phone, delivery_days, lead_time_days, auto_send, approval_threshold_cents, notes) values
  ((select id from organizations where slug='brio'), 'Cantina Albasi',       'vini',          'ordini@cantinaalbasi.it',    null, array[2,5], 2, false, 30000, 'DOC Colli Piacentini, ordini in anticipo'),
  ((select id from organizations where slug='brio'), 'Tenuta Segalini',      'vini',          'ordini@tenutasegalini.it',   null, array[2,5], 3, false, 30000, 'DOC Colli Piacentini'),
  ((select id from organizations where slug='brio'), 'Barattieri',           'vini',          'ordini@barattieri.it',       null, array[3],   3, false, 30000, 'DOC Colli Piacentini'),
  ((select id from organizations where slug='brio'), 'Ganaghello',           'birra+vini',    'ordini@ganaghello.it',       null, array[1,4], 1, false, 30000, 'Spillatura birra + impianto + fusti'),
  ((select id from organizations where slug='brio'), 'Salumificio Bignami',  'salumi',        'ordini@salumificiobignami.it', null, array[2,5], 1, false, 50000, 'Coppa, pancetta, salame DOP'),
  ((select id from organizations where slug='brio'), 'Rustiko',              'pane',          'ordini@rustiko.it',          null, array[1,2,3,4,5,6], 0, true, 20000, 'Pane fresco quotidiano consegna mattina'),
  ((select id from organizations where slug='brio'), 'PAT',                  'pasta_fresca',  'ordini@pastapat.it',         null, array[3,6], 1, false, 20000, 'Pasta artigianale piacentina'),
  ((select id from organizations where slug='brio'), 'Kzero',                'carne',         'ordini@kzero.it',            null, array[2,5], 1, false, 40000, 'Carne fresca + insaccati'),
  ((select id from organizations where slug='brio'), 'Perazzi',              'dolci',         'ordini@pasticceriaperazzi.it', null, array[1,3,5], 1, false, 15000, 'Pasticceria + brioche'),
  ((select id from organizations where slug='brio'), 'Dolcezza Urbana',      'gelati',        'ordini@dolcezzaurbana.it',   null, array[2,5], 2, false, 25000, 'Gelato artigianale + torte'),
  ((select id from organizations where slug='brio'), 'Ca Visconti',          'verdura',       'ordini@cavisconti.it',       null, array[1,3,5], 1, true, 15000, 'Verdura, miele, ortaggi km reale'),
  ((select id from organizations where slug='brio'), 'Cartufficio',          'stampa',        'info@cartufficio.it',        null, array[3], 5, false, null, 'Menu, magliette, grembiuli, scontrini'),
  ((select id from organizations where slug='brio'), 'Tinelli Group',        'attrezzature',  'info@tinelligroup.it',       null, array[3], 7, false, null, 'Sconto -15-25%, rapporto consolidato Stefano')
on conflict (org_id, lower(name)) do nothing;

-- ============================================================
-- 3. INGREDIENTI (con costo unitario stimato in centesimi)
-- ============================================================
-- I costi sono stime ragionevoli; aggiustare con prezzi reali fornitori
-- alle prime consegne. Soglie min/critica calibrate per consumo settimanale.
-- ============================================================
insert into public.ingredients (org_id, name, unit, stock_qty, min_stock_qty, critical_stock_qty, cost_per_unit_cents, supplier_id, notes) values
  -- Caffetteria
  ((select id from organizations where slug='brio'), 'Caffè in grani',         'g',     5000, 2000, 500,  3,   null, 'Miscela bar'),
  ((select id from organizations where slug='brio'), 'Latte fresco',           'ml',   20000, 5000, 1000, 1,   null, 'Latte intero, frigo'),
  ((select id from organizations where slug='brio'), 'Cacao in polvere',       'g',     500,  100,  20,   8,   null, null),
  ((select id from organizations where slug='brio'), 'Ginseng polvere',        'g',     200,  50,   10,   30,  null, null),
  ((select id from organizations where slug='brio'), 'Orzo solubile',          'g',     500,  100,  20,   5,   null, null),
  ((select id from organizations where slug='brio'), 'Zucchero bustine',       'pezzo', 500,  150,  30,   2,   null, null),
  -- Pane / pasticceria
  ((select id from organizations where slug='brio'), 'Brioche vuota',          'pezzo', 50,   20,   5,    65,  (select id from suppliers where name='Perazzi' and org_id=(select id from organizations where slug='brio')), 'Da Perazzi, mattina'),
  ((select id from organizations where slug='brio'), 'Brioche crema',          'pezzo', 30,   15,   5,    75,  (select id from suppliers where name='Perazzi' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Brioche cioccolato',     'pezzo', 30,   15,   5,    75,  (select id from suppliers where name='Perazzi' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Piada',                  'pezzo', 60,   30,   10,   45,  (select id from suppliers where name='Rustiko' and org_id=(select id from organizations where slug='brio')), 'Consegna giornaliera'),
  ((select id from organizations where slug='brio'), 'Pane tramezzino',        'pezzo', 40,   20,   5,    35,  (select id from suppliers where name='Rustiko' and org_id=(select id from organizations where slug='brio')), null),
  -- Salumi (Bignami)
  ((select id from organizations where slug='brio'), 'Prosciutto crudo',       'g',     3000, 1000, 200,  4,   (select id from suppliers where name='Salumificio Bignami' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Coppa piacentina DOP',   'g',     2000, 800,  150,  6,   (select id from suppliers where name='Salumificio Bignami' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Pancetta piacentina',    'g',     1500, 500,  100,  5,   (select id from suppliers where name='Salumificio Bignami' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Salame Piacentino DOP',  'g',     2000, 600,  100,  5,   (select id from suppliers where name='Salumificio Bignami' and org_id=(select id from organizations where slug='brio')), null),
  -- Formaggi
  ((select id from organizations where slug='brio'), 'Stracchino',             'g',     1500, 500,  100,  3,   null, 'Frigo, scadenza breve'),
  ((select id from organizations where slug='brio'), 'Squacquerone',           'g',     1500, 500,  100,  4,   null, 'Frigo, scadenza breve'),
  ((select id from organizations where slug='brio'), 'Grana Padano DOP',       'g',     1000, 300,  50,   3,   null, null),
  ((select id from organizations where slug='brio'), 'Mozzarella',             'g',     2000, 600,  100,  2,   null, null),
  -- Verdura (Ca Visconti)
  ((select id from organizations where slug='brio'), 'Insalata mista',         'g',     2000, 500,  100,  1,   (select id from suppliers where name='Ca Visconti' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Pomodoro',               'g',     2000, 500,  100,  1,   (select id from suppliers where name='Ca Visconti' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Rucola',                 'g',     500,  150,  30,   2,   (select id from suppliers where name='Ca Visconti' and org_id=(select id from organizations where slug='brio')), null),
  -- Birra / vini
  ((select id from organizations where slug='brio'), 'Birra Moretti 33cl',     'pezzo', 100,  30,   10,   80,  null, 'Bottiglia'),
  ((select id from organizations where slug='brio'), 'Birra Menabrea fusto',   'ml',   30000, 8000, 2000, 1,   (select id from suppliers where name='Ganaghello' and org_id=(select id from organizations where slug='brio')), 'Spillatura, 1 fusto = 30L'),
  ((select id from organizations where slug='brio'), 'Gutturnio frizzante',    'ml',    9000, 3000, 750,  1,   (select id from suppliers where name='Cantina Albasi' and org_id=(select id from organizations where slug='brio')), 'Bottiglia 750ml'),
  ((select id from organizations where slug='brio'), 'Prosecco DOC',           'ml',    9000, 3000, 750,  1,   null, 'Bottiglia 750ml'),
  -- Consumables / packaging
  ((select id from organizations where slug='brio'), 'Bicchiere carta caffè',  'pezzo', 500,  200,  50,   3,   (select id from suppliers where name='Cartufficio' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Tovagliolo carta',       'pezzo', 1000, 300,  50,   1,   (select id from suppliers where name='Cartufficio' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Piatto carta',           'pezzo', 200,  80,   20,   5,   (select id from suppliers where name='Cartufficio' and org_id=(select id from organizations where slug='brio')), null),
  ((select id from organizations where slug='brio'), 'Posata bio',             'pezzo', 200,  80,   20,   4,   (select id from suppliers where name='Cartufficio' and org_id=(select id from organizations where slug='brio')), null)
on conflict (org_id, lower(name)) do nothing;

-- ============================================================
-- 4. PRODOTTI (menu reale BRIO_CONTEXT.md §5)
-- ============================================================
-- Prezzi in centesimi. IVA: 10% food, 22% alcolici.
-- Shortcut: F1-F6 più frequenti (caffè, cappuccino, brioche, ecc).
-- ============================================================
with org as (select id from organizations where slug='brio'),
     c_caffe as (select id from categories where slug='caffetteria' and org_id=(select id from org)),
     c_pranzo as (select id from categories where slug='pranzo'      and org_id=(select id from org)),
     c_apero  as (select id from categories where slug='aperitivo'   and org_id=(select id from org))
insert into public.products (org_id, category_id, name, description, price_cents, vat_rate, sku, shortcut_key, sort_order, tags) values
  -- Caffetteria
  ((select id from org), (select id from c_caffe), 'Caffè',                'Espresso classico',                       120,  10, 'CAF-001', 'F1', 10, array['caldo']),
  ((select id from org), (select id from c_caffe), 'Cappuccino',           'Espresso + latte montato',                170,  10, 'CAF-002', 'F2', 20, array['caldo']),
  ((select id from org), (select id from c_caffe), 'Marocchino',           'Caffè, cacao, schiuma di latte',          140,  10, 'CAF-003', null, 30, array['caldo']),
  ((select id from org), (select id from c_caffe), 'Caffè ginseng',        'Ginseng e caffè',                         140,  10, 'CAF-004', null, 40, array['caldo']),
  ((select id from org), (select id from c_caffe), 'Caffè d''orzo',        'Orzo solubile',                           140,  10, 'CAF-005', null, 50, array['caldo']),
  ((select id from org), (select id from c_caffe), 'Brioche vuota',        'Brioche al naturale',                     130,  10, 'CAF-010', 'F3', 60, array['dolce']),
  ((select id from org), (select id from c_caffe), 'Brioche crema',        'Brioche ripiena con crema pasticcera',    150,  10, 'CAF-011', null, 70, array['dolce']),
  ((select id from org), (select id from c_caffe), 'Brioche cioccolato',   'Brioche ripiena al cioccolato',           150,  10, 'CAF-012', null, 80, array['dolce']),
  -- Pranzo
  ((select id from org), (select id from c_pranzo), 'Piadina classica',     'Crudo + stracchino + rucola',             700,  10, 'PRA-001', 'F4', 10, array['pranzo','salato']),
  ((select id from org), (select id from c_pranzo), 'Piadina speciale',     'Coppa piacentina + squacquerone',         800,  10, 'PRA-002', null, 20, array['pranzo','salato','piacentino']),
  ((select id from org), (select id from c_pranzo), 'Tramezzino farcito',   'Pane tramezzino con crudo e mozzarella',  450,  10, 'PRA-003', null, 30, array['pranzo']),
  ((select id from org), (select id from c_pranzo), 'Insalatona',           'Insalata mista, pomodoro, mozzarella',    800,  10, 'PRA-004', null, 40, array['pranzo','vegetariano']),
  ((select id from org), (select id from c_pranzo), 'Tagliere singolo',     'Selezione salumi piacentini + grana',    1000, 10, 'PRA-010', null, 50, array['piacentino']),
  ((select id from org), (select id from c_pranzo), 'Tagliere mini',        'Tagliere condiviso aperitivo',            700,  10, 'PRA-011', null, 60, array['aperitivo']),
  -- Aperitivo
  ((select id from org), (select id from c_apero),  'Birra Moretti 33cl',   'Bottiglia birra Moretti',                 400,  22, 'APE-001', null, 10, array['birra']),
  ((select id from org), (select id from c_apero),  'Birra Menabrea piccola','Spina 0,2L',                             350,  22, 'APE-002', null, 20, array['birra','spina']),
  ((select id from org), (select id from c_apero),  'Birra Menabrea media',  'Spina 0,4L',                             500,  22, 'APE-003', 'F5', 30, array['birra','spina']),
  ((select id from org), (select id from c_apero),  'Calice Gutturnio',     'Frizzante, DOC Colli Piacentini',         450,  22, 'APE-010', 'F6', 40, array['vino','rosso','piacentino']),
  ((select id from org), (select id from c_apero),  'Calice Prosecco',      'DOC Veneto',                              450,  22, 'APE-011', null, 50, array['vino','bollicine'])
on conflict (org_id, sku) do nothing;

-- ============================================================
-- 5. RICETTE (legame prodotto → ingredienti)
-- ============================================================
-- Helper inline: ricetta(sku_prodotto, nome_ingrediente, qty)
-- Tutto in un blocco DO per evitare ripetizione.
-- ============================================================
do $$
declare
  v_org uuid := (select id from organizations where slug='brio');
  p uuid;
  i uuid;
  -- helper macro via funzione locale
begin
  -- Caffè
  p := (select id from products where sku='CAF-001' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Caffè in grani' and org_id=v_org), 7),
    (v_org, p, (select id from ingredients where name='Bicchiere carta caffè' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Zucchero bustine' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Cappuccino
  p := (select id from products where sku='CAF-002' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Caffè in grani' and org_id=v_org), 7),
    (v_org, p, (select id from ingredients where name='Latte fresco' and org_id=v_org), 150),
    (v_org, p, (select id from ingredients where name='Bicchiere carta caffè' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Zucchero bustine' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Marocchino
  p := (select id from products where sku='CAF-003' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Caffè in grani' and org_id=v_org), 7),
    (v_org, p, (select id from ingredients where name='Latte fresco' and org_id=v_org), 30),
    (v_org, p, (select id from ingredients where name='Cacao in polvere' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Caffè ginseng
  p := (select id from products where sku='CAF-004' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Ginseng polvere' and org_id=v_org), 5),
    (v_org, p, (select id from ingredients where name='Bicchiere carta caffè' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Caffè d'orzo
  p := (select id from products where sku='CAF-005' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Orzo solubile' and org_id=v_org), 6),
    (v_org, p, (select id from ingredients where name='Bicchiere carta caffè' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Brioche vuota
  p := (select id from products where sku='CAF-010' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Brioche vuota' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Brioche crema
  p := (select id from products where sku='CAF-011' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Brioche crema' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Brioche cioccolato
  p := (select id from products where sku='CAF-012' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Brioche cioccolato' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Piadina classica
  p := (select id from products where sku='PRA-001' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Piada' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Prosciutto crudo' and org_id=v_org), 60),
    (v_org, p, (select id from ingredients where name='Stracchino' and org_id=v_org), 50),
    (v_org, p, (select id from ingredients where name='Rucola' and org_id=v_org), 10),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Piatto carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Piadina speciale
  p := (select id from products where sku='PRA-002' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Piada' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Coppa piacentina DOP' and org_id=v_org), 60),
    (v_org, p, (select id from ingredients where name='Squacquerone' and org_id=v_org), 50),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Piatto carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Tramezzino
  p := (select id from products where sku='PRA-003' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Pane tramezzino' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Prosciutto crudo' and org_id=v_org), 30),
    (v_org, p, (select id from ingredients where name='Mozzarella' and org_id=v_org), 40),
    (v_org, p, (select id from ingredients where name='Tovagliolo carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Insalatona
  p := (select id from products where sku='PRA-004' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Insalata mista' and org_id=v_org), 150),
    (v_org, p, (select id from ingredients where name='Pomodoro' and org_id=v_org), 80),
    (v_org, p, (select id from ingredients where name='Mozzarella' and org_id=v_org), 80),
    (v_org, p, (select id from ingredients where name='Piatto carta' and org_id=v_org), 1),
    (v_org, p, (select id from ingredients where name='Posata bio' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Tagliere singolo
  p := (select id from products where sku='PRA-010' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Coppa piacentina DOP' and org_id=v_org), 40),
    (v_org, p, (select id from ingredients where name='Salame Piacentino DOP' and org_id=v_org), 40),
    (v_org, p, (select id from ingredients where name='Pancetta piacentina' and org_id=v_org), 30),
    (v_org, p, (select id from ingredients where name='Grana Padano DOP' and org_id=v_org), 50),
    (v_org, p, (select id from ingredients where name='Piatto carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Tagliere mini
  p := (select id from products where sku='PRA-011' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Coppa piacentina DOP' and org_id=v_org), 25),
    (v_org, p, (select id from ingredients where name='Salame Piacentino DOP' and org_id=v_org), 25),
    (v_org, p, (select id from ingredients where name='Grana Padano DOP' and org_id=v_org), 30),
    (v_org, p, (select id from ingredients where name='Piatto carta' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Birra Moretti
  p := (select id from products where sku='APE-001' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Birra Moretti 33cl' and org_id=v_org), 1)
  on conflict (product_id, ingredient_id) do nothing;

  -- Birra Menabrea piccola (200ml)
  p := (select id from products where sku='APE-002' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Birra Menabrea fusto' and org_id=v_org), 200)
  on conflict (product_id, ingredient_id) do nothing;

  -- Birra Menabrea media (400ml)
  p := (select id from products where sku='APE-003' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Birra Menabrea fusto' and org_id=v_org), 400)
  on conflict (product_id, ingredient_id) do nothing;

  -- Calice Gutturnio (150ml)
  p := (select id from products where sku='APE-010' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Gutturnio frizzante' and org_id=v_org), 150)
  on conflict (product_id, ingredient_id) do nothing;

  -- Calice Prosecco (150ml)
  p := (select id from products where sku='APE-011' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty) values
    (v_org, p, (select id from ingredients where name='Prosecco DOC' and org_id=v_org), 150)
  on conflict (product_id, ingredient_id) do nothing;
end $$;

-- ============================================================
-- Verifica finale (per debug)
-- ============================================================
-- select count(*) from products where org_id=(select id from organizations where slug='brio');
-- select count(*) from ingredients where org_id=(select id from organizations where slug='brio');
-- select count(*) from suppliers where org_id=(select id from organizations where slug='brio');
-- select count(*) from recipes where org_id=(select id from organizations where slug='brio');

-- Fine migration 003
