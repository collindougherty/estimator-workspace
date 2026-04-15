# v1 output contract

These files are the clean handoff layer for future app integration. They are rebuilt by:

```bash
python3 modeling/scripts/run_competitor_v1.py
```

## Files

- `manifest.json`
  - package metadata, permit window, holdout validation summary, readiness labels, and Sarpy status
- `scored_cohort.csv`
  - one row per modeled permit/job in the live cohort
  - primary fields for a first product surface:
    - `forest_point_estimate`
    - `comp_median`
    - `recommended_band_low`
    - `recommended_band_high`
    - `comp_neighbor_count`
- `nearest_comps.csv`
  - nearest comparable permits for each subject row
  - intended to back a “show me the comps behind this band” panel later
- `company_rollup.csv`
  - useful internal summary, but still exploratory because contractor names are not yet normalized

## Readiness

- Product-facing v1: `scored_cohort.csv`, `nearest_comps.csv`
- Supporting only: `forest_point_estimate` columns
- Exploratory only: `company_rollup.csv`

## Current county coverage

Sarpy is staged and refreshed by the pipeline, but the current permit-window cohort still contributes **0 Sarpy rows**. The usable v1 outputs remain **Douglas-only** today.
