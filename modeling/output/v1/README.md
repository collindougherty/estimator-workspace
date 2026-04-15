# v1 output contract

These files are the clean handoff layer for future app integration. The current packaged multi-trade refresh is:

```bash
python3 modeling/scripts/run_competitor_v1.py \
  --permit-csv modeling/data/raw/permits/omaha_multitrade_2025-11-01_2026-04-14.csv \
  --cohort-profile broad_permit_modeling
```

## Files

- `manifest.json`
  - package metadata, permit window, model-selection summary, band-reliability summary, readiness labels, and Sarpy status
- `scored_cohort.csv`
  - one row per modeled permit/job in the packaged cohort
  - primary fields for a first product surface:
    - `packaged_point_estimate`
    - `comp_median`
    - `recommended_band_low`
    - `recommended_band_high`
    - `comp_neighbor_count`
    - `recommended_band_width`
    - `recommended_band_width_ratio`
    - `band_reliability_tier`
    - `band_reliability_note`
  - compatibility fields like `forest_point_estimate` still exist, but they mirror the packaged point estimate now
- `nearest_comps.csv`
  - nearest comparable permits for each subject row
  - intended to back a later “show me the comps behind this band” panel
- `band_diagnostics.csv`
  - permit-type holdout support table for the comparable-job band
  - includes holdout sample size, 90% band coverage, typical band width, dominant pool strategy, and the summarized reliability tier
- `company_rollup.csv`
  - useful internal summary, but still exploratory because contractor names are mostly absent or unnormalized
- `report.html`
  - stakeholder-readable HTML report with pipeline visuals, raw-vs-modeled coverage tables, validation stats, band-reliability tables, readiness flags, and a representative comparable-job view

## Readiness

- Product-facing v1: `scored_cohort.csv`, `nearest_comps.csv`
- Supporting only: `packaged_point_estimate`
- Exploratory only: `company_rollup.csv`

## Current package posture

- Current packaged cohort: Omaha multi-trade permits with declared valuation and usable property enrichment
- Current packaged point model: `permit-type-fallback-forest-log`
- Recommended first client-facing surface: nearest-comp 5th-95th percentile band plus comparable-job list
- New caveat surface: use `band_reliability_tier` and `band_reliability_note` to flag wide or weakly supported bands before any later UI wiring
- Current county reality: Sarpy is staged, but the packaged live cohort still contributes **0 Sarpy rows**
