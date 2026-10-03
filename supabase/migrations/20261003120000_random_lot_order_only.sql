-- The lot order is random again (draw_lot_order). Nobody can pick it or redraw it until it comes out a certain way.
drop function if exists public.set_lot_order(text[]);
drop function if exists public.clear_lot_order();
