-- ============================================================
-- BRIO · Migration 004 · Abilita Supabase Realtime
-- ============================================================
-- Per ricevere gli aggiornamenti push (es. quando la cassa scarica
-- il magazzino e la pagina /magazzino lo deve vedere in tempo reale),
-- bisogna aggiungere le tabelle alla publication "supabase_realtime".
-- ============================================================

alter publication supabase_realtime add table public.ingredients;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.inventory_movements;

-- Fine migration 004
