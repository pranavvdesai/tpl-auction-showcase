-- Rule change: base price is 20 points. The squad reserve (points kept per player still needed
-- to reach the minimum squad) and the "can any team still buy" check follow min_base.

alter table public.auction_settings alter column min_base set default 20;
update public.auction_settings set min_base = 20 where id = 1;
update public.players set base_price = 20 where true;
