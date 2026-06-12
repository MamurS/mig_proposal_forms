-- ============================================================
-- Cyber rate card v2 — market-aligned pricing
-- ============================================================
-- Requested calibration: a USD 2M limit should price ≈ USD 25–30K
-- (≈1.0–1.5% rate-on-line), matching international market logic instead of
-- the v1 card (~0.15% rate-on-line, e.g. USD ~1–3K for a small account).
--
-- Mechanics unchanged: revenue × segment rate × geo × adjustments × ILF
-- + extensions. Two calibration changes:
--   1. All segment / hazard rates scaled ×25.6 (Internet Services
--      0.075% → 1.92% of revenue), Financial Institutions set to 5% (referral
--      unchanged) — sized so the reference account (revenue USD 700K, IT,
--      CIS geo, 2M limit, extensions on) lands at ≈ USD 27.5K.
--   2. NEW `rol_band`: the final premium is kept within 0.9%–1.6% of the
--      LIMIT (floor/cap, shown as its own breakdown line) — the engine applies
--      it only when the card carries the key, so v1 stays reproducible.
-- v1 is kept (is_active = false) for audit; the rater loads the active card.
update cyber_rate_cards set is_active = false where is_active = true;

insert into cyber_rate_cards (version, label, tables, is_active)
values (
  2,
  'v2 — market-aligned (≈1.0–1.5% rate-on-line; 2M limit → ~USD 25–30K)',
  '{
    "ilf": { "250000": 1.0, "500000": 1.5, "750000": 2.0, "1000000": 2.25, "2000000": 3.15 },
    "segments": {
      "Retail":                       { "rate": 0.0064,  "hazard": "HC2" },
      "Medical":                      { "rate": 0.0256,  "hazard": "HC3" },
      "Education":                    { "rate": 0.0128,  "hazard": "HC2" },
      "Wholesale":                    { "rate": 0.00128, "hazard": "HC1" },
      "Real Estate":                  { "rate": 0.0128,  "hazard": "HC2" },
      "Warehousing":                  { "rate": 0.00128, "hazard": "HC1" },
      "Call Centers":                 { "rate": 0.0192,  "hazard": "HC3" },
      "Construction":                 { "rate": 0.00256, "hazard": "HC1" },
      "Entertainment":                { "rate": 0.0064,  "hazard": "HC2" },
      "Manufacturing":                { "rate": 0.00128, "hazard": "HC1" },
      "Professionals":                { "rate": 0.0128,  "hazard": "HC2" },
      "Telemarketing":                { "rate": 0.0192,  "hazard": "HC3" },
      "Transportation":               { "rate": 0.0064,  "hazard": "HC2" },
      "Internet Services":            { "rate": 0.0192,  "hazard": "HC3" },
      "Telecommunications":           { "rate": 0.0192,  "hazard": "HC3" },
      "Financial Institutions":       { "rate": 0.05,    "hazard": "HC4", "referral": true },
      "Data Processing (Outsourcer)": { "rate": 0.0192,  "hazard": "HC3" }
    },
    "extensions": { "media_content": 0.025, "cyber_extortion": 0.025, "business_interruption": 0.25 },
    "geo_weights": {
      "SE Asia": 0.4, "Far East": 0.4, "Australasia": 1.0, "UK / Europe": 1.0,
      "USA / Canada": 1.5, "Emerging Central": 0.5, "Emerging Latin America": 0.5
    },
    "other_multiplier": 2,
    "other_hazard_rates": { "HC1": 0.00128, "HC2": 0.0064, "HC3": 0.0192 },
    "rol_band": { "min": 0.009, "max": 0.016 },
    "adjustment_bounds": {
      "size":    { "max": 2,  "min": -0.25, "hint": "Revenue 0–10M → up to −25%" },
      "retro":   { "max": 2,  "min": -0.30, "hint": "Max −30% per guide" },
      "claims":  { "max": 10, "min": -0.25, "hint": "Up to −25% discount, unlimited loading" },
      "excess":  { "max": 10, "min": -0.50, "hint": "Per underwriting guide" },
      "quality": { "max": 2,  "min": -0.25, "hint": "Up to −25% discount" }
    }
  }'::jsonb,
  true
);
