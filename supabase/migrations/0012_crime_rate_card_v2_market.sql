-- ============================================================
-- Crime rate card v2 — market rate-on-line guardrails
-- ============================================================
-- The crime card's base bands are already market-derived (Chartis lineage,
-- absolute USD premiums), so unlike cyber (migration 0011) the rates stay as
-- they are. v2 only adds the market `rol_band`: a 0.5%-of-limit FLOOR lifts
-- small accounts to market minimums (e.g. a small account at a USD 2M limit
-- prices at least USD 10,000 instead of ~8.6K), and a generous 2.5% cap acts
-- as a sanity bound. The engine shows any floor/cap as its own breakdown line.
-- v1 is kept (is_active = false) for audit.
update crime_rate_cards set is_active = false where is_active = true;

insert into crime_rate_cards (version, label, tables, is_active)
select 2,
       'v2 — market rate-on-line band (0.5% floor / 2.5% cap of limit)',
       tables::jsonb || '{"rol_band": {"min": 0.005, "max": 0.025}}'::jsonb,
       true
from crime_rate_cards
where version = 1
order by created_at desc
limit 1;
