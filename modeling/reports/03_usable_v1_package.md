# Usable v1 modeling package

## Goal

Turn the Douglas/Omaha prototype into a rerunnable package that produces a clean handoff layer for later product wiring **without** integrating anything into the app yet.

## Canonical entrypoint

From repo root:

```bash
python3 modeling/scripts/run_competitor_v1.py
```

What it does:
1. reuses the copied Omaha permit extract by default (or refreshes it with `--refresh-permits`)
2. rebuilds the Douglas joined dataset and 803-row residential re-roof cohort
3. retrains the current prototype models and evaluation artifacts
4. refreshes Sarpy staging plus multicounty join-status artifacts
5. publishes a clean v1 output contract under `modeling/output/v1/`

## Current v1 architecture

### A. Source + staging layer
- Omaha permit copy: `modeling/data/raw/roofing/`
- Douglas matched property subset/profile: `modeling/data/raw/properties/`
- Sarpy staged canonical property copy: `modeling/data/raw/properties/sarpy_county/`

### B. Modeling/evaluation layer
- Douglas joined/cohort tables: `modeling/data/processed/`
- prototype evaluation artifacts: metrics, holdout predictions, feature importance, residual plots

### C. Delivery layer
- `modeling/output/v1/manifest.json`
- `modeling/output/v1/scored_cohort.csv`
- `modeling/output/v1/nearest_comps.csv`
- `modeling/output/v1/company_rollup.csv`
- `modeling/output/v1/README.md`

The delivery layer is the new part that product/app integration can consume later without reading the exploratory intermediate files.

## What is usable today vs still exploratory

### Usable for a first v1 surface
- **Nearest-neighbor competitor band** using the empirical **5th-95th percentile** range
- **Nearest comparable-job list** backing each band
- Douglas-only residential re-roof cohort outputs keyed by permit/job record

Why this is the best current surface:
- best point-model holdout MAE is still about **$6.3k**
- point-model residual intervals under-cover badly
- nearest-comp bands are more faithful to the product question (“what comparable jobs look priced at”) and reached about **85.1% holdout coverage** for the 5th-95th band

### Supporting only, not primary UI truth
- random-forest point estimate

Use it as context or sort order, not as the only product-facing answer.

### Still exploratory
- company/contractor rollups because company strings are not normalized yet
- any cross-county pricing interpretation
- any “production uncertainty” claim based on the model residual interval

## Clean outputs for later integration

### `scored_cohort.csv`
One row per Douglas cohort job with:
- subject/job identity fields (`record_number`, `record_date`, address, ZIP, company)
- current point estimate (`forest_point_estimate`)
- nearest-comp median
- recommended display band (`recommended_band_low`, `recommended_band_high`)
- supporting 10th-90th and 5th-95th comp bands

### `nearest_comps.csv`
One-to-many table from subject job to comparable permits:
- subject record number/date/address
- neighbor rank + distance
- neighbor permit/date/company/address/value

### `company_rollup.csv`
Internal summary only:
- job counts
- observed median values
- median comp medians / recommended bands

### `manifest.json`
Machine-readable package metadata:
- permit window
- cohort size + county coverage
- holdout validation summary
- readiness flags
- explicit Sarpy status
- recommended first product surface

## Sarpy status

Sarpy is now part of the canonical v1 refresh flow, but it is still **staged only** for the live permit window:
- Sarpy canonical property file exists and is refreshed safely inside `modeling/`
- multicounty status artifacts are refreshed each run
- current live permit-window cohort still contributes **0 Sarpy rows**

Bottom line: **the usable v1 package remains Douglas-only today** even though Sarpy prep work is now maintained and ready for future windows.

## Recommended first product surface

Build the first competitor-analysis surface as a **Douglas-only job-level comp-band panel**:
- show the nearest-comp **5th-95th percentile** price band
- show the comp median
- show the 5-12 closest comparable permits behind that band

Do **not** start with:
- a contractor leaderboard
- a multicounty experience
- a pure point-estimate-only UI

Reason: the current data is strongest at the comparable-job level, contractor identity cleanup is unfinished, and Sarpy is staged but not yet live in the cohort.

## Next steps after v1

1. normalize contractor/company identities before any leaderboard or contractor benchmarking
2. add richer scope/complexity parsing from permit text
3. when Sarpy actually enters the permit cohort, retrain from multicounty cohort outputs and add county-aware missingness handling
4. only revisit product-facing model intervals after better label/entity cleanup
