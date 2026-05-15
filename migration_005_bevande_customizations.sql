-- ============================================================
-- BRIO · Migration 005 · Bevande + Customizations + Cross-sell tags
-- ============================================================
-- Aggiunge:
--   - Categoria "Bevande" (acqua, soft drink, te freddo)
--   - 8 nuovi prodotti bevande
--   - Ingredienti+ricette base per bevande (bottiglia=1 pezzo)
--   - JSONB customizations su prodotti (caffè decaff, piadina senza X, ecc)
--   - Tags pairing per cross-sell ("with-pranzo", "with-caffe", ecc)
-- ============================================================

-- ============================================================
-- 1. CATEGORIA BEVANDE
-- ============================================================
insert into public.categories (org_id, name, slug, icon, color, sort_order) values
  ((select id from public.organizations where slug='brio'), 'Bevande', 'bevande', '🥤', '#1E3A8A', 25)
on conflict (org_id, slug) do nothing;

-- ============================================================
-- 2. INGREDIENTI per bevande (1 bottiglia = 1 pezzo, scarica intero)
-- ============================================================
insert into public.ingredients (org_id, name, unit, stock_qty, min_stock_qty, critical_stock_qty, cost_per_unit_cents, notes) values
  ((select id from organizations where slug='brio'), 'Acqua naturale 50cl',  'pezzo', 60, 24, 6, 30,  null),
  ((select id from organizations where slug='brio'), 'Acqua frizzante 50cl', 'pezzo', 60, 24, 6, 30,  null),
  ((select id from organizations where slug='brio'), 'Coca Cola 33cl',       'pezzo', 48, 24, 6, 75,  null),
  ((select id from organizations where slug='brio'), 'Coca Cola Zero 33cl',  'pezzo', 36, 12, 6, 75,  null),
  ((select id from organizations where slug='brio'), 'Sprite 33cl',          'pezzo', 24, 12, 6, 75,  null),
  ((select id from organizations where slug='brio'), 'Fanta 33cl',           'pezzo', 24, 12, 6, 75,  null),
  ((select id from organizations where slug='brio'), 'Estathé Pesca',        'pezzo', 24, 12, 6, 60,  null),
  ((select id from organizations where slug='brio'), 'Estathé Limone',       'pezzo', 24, 12, 6, 60,  null),
  ((select id from organizations where slug='brio'), 'Tonica Schweppes',     'pezzo', 24, 12, 6, 80,  'Per aperitivo')
on conflict (org_id, lower(name)) do nothing;

-- ============================================================
-- 3. PRODOTTI bevande
-- ============================================================
with org as (select id from organizations where slug='brio'),
     c_bev as (select id from categories where slug='bevande' and org_id=(select id from org))
insert into public.products (org_id, category_id, name, description, price_cents, vat_rate, sku, sort_order, tags) values
  ((select id from org), (select id from c_bev), 'Acqua naturale 50cl',  'Bottiglia di vetro',         100, 10, 'BEV-001', 10, array['with-pranzo','with-aperitivo']),
  ((select id from org), (select id from c_bev), 'Acqua frizzante 50cl', 'Bottiglia di vetro',         100, 10, 'BEV-002', 20, array['with-pranzo','with-aperitivo']),
  ((select id from org), (select id from c_bev), 'Coca Cola 33cl',       'In bottiglia di vetro',      250, 10, 'BEV-010', 30, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Coca Cola Zero 33cl',  'Senza zucchero, vetro',      250, 10, 'BEV-011', 40, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Sprite 33cl',          'In bottiglia di vetro',      250, 10, 'BEV-012', 50, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Fanta 33cl',           'In bottiglia di vetro',      250, 10, 'BEV-013', 60, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Estathé Pesca',        'Te freddo alla pesca',       200, 10, 'BEV-020', 70, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Estathé Limone',       'Te freddo al limone',        200, 10, 'BEV-021', 80, array['with-pranzo']),
  ((select id from org), (select id from c_bev), 'Tonica Schweppes',     'Per gin tonic o liscia',     300, 22, 'BEV-030', 90, array['with-aperitivo'])
on conflict (org_id, sku) do nothing;

-- ============================================================
-- 4. RICETTE bevande (1 prodotto = 1 ingrediente da scaricare)
-- ============================================================
do $$
declare
  v_org uuid := (select id from organizations where slug='brio');
  p uuid;
begin
  p := (select id from products where sku='BEV-001' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Acqua naturale 50cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-002' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Acqua frizzante 50cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-010' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Coca Cola 33cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-011' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Coca Cola Zero 33cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-012' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Sprite 33cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-013' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Fanta 33cl' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-020' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Estathé Pesca' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-021' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Estathé Limone' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;

  p := (select id from products where sku='BEV-030' and org_id=v_org);
  insert into recipes (org_id, product_id, ingredient_id, qty)
    values (v_org, p, (select id from ingredients where name='Tonica Schweppes' and org_id=v_org), 1)
    on conflict (product_id, ingredient_id) do nothing;
end $$;

-- ============================================================
-- 5. CUSTOMIZATIONS per prodotti esistenti
-- ============================================================
-- Schema customization JSONB:
--   [{"label":"Decaffeinato","type":"variant","price_delta_cents":0},
--    {"label":"Senza schiuma","type":"toggle","price_delta_cents":0},
--    {"label":"Doppia coppa","type":"extra","price_delta_cents":150}]
-- types: variant = mutua esclusione tra opzioni; toggle = on/off; extra = aggiunta con costo
-- ============================================================

-- Caffè
update public.products set customizations = '[
  {"label":"Decaffeinato","type":"toggle","price_delta_cents":0},
  {"label":"Macchiato caldo","type":"toggle","price_delta_cents":0},
  {"label":"Macchiato freddo","type":"toggle","price_delta_cents":0},
  {"label":"Senza zucchero","type":"toggle","price_delta_cents":0},
  {"label":"In tazza grande","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku='CAF-001' and org_id=(select id from organizations where slug='brio');

-- Cappuccino
update public.products set customizations = '[
  {"label":"Decaffeinato","type":"toggle","price_delta_cents":0},
  {"label":"Senza schiuma","type":"toggle","price_delta_cents":0},
  {"label":"Latte di soia","type":"toggle","price_delta_cents":50},
  {"label":"Latte di avena","type":"toggle","price_delta_cents":50}
]'::jsonb
where sku='CAF-002' and org_id=(select id from organizations where slug='brio');

-- Brioche vuota / crema / cioccolato
update public.products set customizations = '[
  {"label":"Riscaldata","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku in ('CAF-010','CAF-011','CAF-012') and org_id=(select id from organizations where slug='brio');

-- Piadina classica
update public.products set customizations = '[
  {"label":"Senza rucola","type":"toggle","price_delta_cents":0},
  {"label":"Senza stracchino","type":"toggle","price_delta_cents":0},
  {"label":"Aggiunta sottaceti","type":"extra","price_delta_cents":50},
  {"label":"Doppia farcitura","type":"extra","price_delta_cents":150},
  {"label":"Da asporto","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku='PRA-001' and org_id=(select id from organizations where slug='brio');

-- Piadina speciale
update public.products set customizations = '[
  {"label":"Senza squacquerone","type":"toggle","price_delta_cents":0},
  {"label":"Doppia coppa","type":"extra","price_delta_cents":150},
  {"label":"Aggiunta rucola","type":"extra","price_delta_cents":30},
  {"label":"Da asporto","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku='PRA-002' and org_id=(select id from organizations where slug='brio');

-- Tramezzino
update public.products set customizations = '[
  {"label":"Tostato","type":"toggle","price_delta_cents":0},
  {"label":"Da asporto","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku='PRA-003' and org_id=(select id from organizations where slug='brio');

-- Insalatona
update public.products set customizations = '[
  {"label":"Senza pomodoro","type":"toggle","price_delta_cents":0},
  {"label":"Senza mozzarella","type":"toggle","price_delta_cents":0},
  {"label":"Aggiunta tonno","type":"extra","price_delta_cents":150},
  {"label":"Aggiunta uovo","type":"extra","price_delta_cents":80},
  {"label":"Aggiunta pollo","type":"extra","price_delta_cents":200}
]'::jsonb
where sku='PRA-004' and org_id=(select id from organizations where slug='brio');

-- Tagliere singolo / mini
update public.products set customizations = '[
  {"label":"Con miele","type":"toggle","price_delta_cents":0},
  {"label":"Con confettura","type":"toggle","price_delta_cents":0},
  {"label":"Senza pancetta","type":"toggle","price_delta_cents":0}
]'::jsonb
where sku in ('PRA-010','PRA-011') and org_id=(select id from organizations where slug='brio');

-- ============================================================
-- 6. TAGS per cross-sell sui prodotti esistenti
-- ============================================================
-- Pranzo → suggerisce bevande + caffè
update public.products set tags = tags || array['suggests-bevande','suggests-caffe']
where sku in ('PRA-001','PRA-002','PRA-003','PRA-004') and org_id=(select id from organizations where slug='brio');

-- Caffetteria (caffè/cappuccino) → suggerisce brioche
update public.products set tags = tags || array['suggests-brioche']
where sku in ('CAF-001','CAF-002','CAF-003','CAF-004','CAF-005') and org_id=(select id from organizations where slug='brio');

-- Aperitivo → suggerisce tagliere
update public.products set tags = tags || array['suggests-tagliere']
where sku in ('APE-001','APE-002','APE-003','APE-010','APE-011') and org_id=(select id from organizations where slug='brio');

-- Fine migration 005
