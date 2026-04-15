# Usable v1 modeling package

## Goal

Turn the copied Omaha permit inventory into a rerunnable package that produces a clean handoff layer for later product wiring **without** integrating anything into the app yet.

## Current packaged run

From repo root:

```bash
python3 modeling/scripts/run_competitor_v1.py \
  --permit-csv modeling/data/raw/permits/omaha_multitrade_2025-11-01_2026-04-14.csv \
  --cohort-profile broad_permit_modeling
```

What it does:
1. reuses the copied and normalized Mac mini permit extract
2. rebuilds the joined Omaha/Douglas dataset and the valuation-ready multi-trade cohort
3. retrains the current prototype models with chronological calibration-based model selection
4. refreshes Sarpy staging plus multicounty join-status artifacts
5. publishes a clean v1 output contract under `modeling/output/v1/`

## Current v1 architecture

### A. Source + staging layer
- raw Mac mini permit copy: `modeling/data/raw/permits/mac-mini-roofing/`
- canonical broad permit CSV: `modeling/data/raw/permits/omaha_multitrade_2025-11-01_2026-04-14.csv`
- Douglas matched property subset/profile: `modeling/data/raw/properties/`
- Sarpy staged canonical property copy: `modeling/data/raw/properties/sarpy_county/`

### B. Modeling / evaluation layer
- joined/cohort tables: `modeling/data/processed/`
- multicounty match-status tables: `modeling/data/processed/multicounty/`
- evaluation artifacts: metrics, holdout predictions, feature importance, and error breakdowns by ZIP / value band / permit type

### C. Delivery layer
- `modeling/output/v1/manifest.json`
- `modeling/output/v1/scored_cohort.csv`
- `modeling/output/v1/nearest_comps.csv`
- `modeling/output/v1/company_rollup.csv`
- `modeling/output/v1/report.html`

## What is usable today vs still exploratory

### Usable for a first v1 surface
- **Nearest-neighbor competitor band** using the empirical **5th-95th percentile** range
- **Nearest comparable-job list** backing each band
- job-level outputs for the valuation-ready multi-trade cohort, keyed by permit/job record

Why this is the best current surface:
- the same-type nearest-comp band reaches about **79.5% holdout coverage** on the 5th-95th range
- the packaged point model is better than the older pooled forest, but still too error-prone to act as solo UI truth
- the product question is still “what do similar jobs look priced at?”, which the comparable-job band answers more honestly than a single number

### Supporting only, not primary UI truth
- packaged point estimate from **`permit-type-fallback-forest-log`**

Use it as context or sort order, not as the only product-facing answer.

### Still exploratory
- company / contractor rollups because the broad permit source mostly lacks reliable company signal
- any Sarpy-driven multicounty interpretation
- trades with high permit volume but no declared valuation, since they cannot support pricing labels yet

## What the package now makes explicit

- the source intake is broader than the modeled cohort
- the report shows copied rows, rows with declared valuation, and final modeled rows by permit type
- high-volume plumbing / electrical / HVAC permits are present in the raw source, but most of them carry **0 usable valuation labels**

## Recommended first product surface

Build the first competitor-analysis surface as a **job-level comp-band panel inside the same permit type and preferably the same property class**:
- show the nearest-comp **5th-95th percentile** price band
- show the comp median
- show the closest comparable permits behind that band

Do **not** start with:
- a contractor leaderboard
- a multicounty experience
- a pure point-estimate-only UI

## Current county status

Sarpy is part of the canonical refresh flow, but the live packaged cohort still contributes **0 Sarpy rows**. The usable package remains Douglas-backed today even though Sarpy staging is maintained.

## Next likely improvements

1. pull richer company/licensed-professional fields for the broad source before attempting leaderboard-style competitor intel
2. keep improving segment-specific models for the biggest valuation-rich permit families
3. revisit multicounty packaging only after Sarpy actually contributes live cohort rows
4. only move anything into the app after explicit signoff on the current output contract and report posture
