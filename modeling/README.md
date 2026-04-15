# Modeling workspace

## Current packaged multi-trade run

From the repo root, rebuild the current Omaha multi-trade package with:

```bash
python3 modeling/scripts/run_competitor_v1.py \
  --permit-csv modeling/data/raw/permits/omaha_multitrade_2025-11-01_2026-04-14.csv \
  --cohort-profile broad_permit_modeling
```

This is the workflow that currently refreshes the packaged artifacts under `modeling/output/v1/` and the supporting summaries under `modeling/data/processed/`.

## What that run does

1. Reuses the copied Mac mini permit extract already normalized under `modeling/data/raw/permits/`
2. Rebuilds the matched Douglas/Omaha joined dataset and the valuation-ready multi-trade cohort
3. Retrains the prototype models with chronological train/calibration/holdout evaluation
4. Refreshes Sarpy staging plus multicounty join-status artifacts
5. Publishes the app-consumable package under `modeling/output/v1/`
6. Regenerates `modeling/output/v1/report.html`
7. Refreshes permit-type band reliability diagnostics so the package flags where the comparable-job range is strongest vs cautionary

## Current package shape

- `modeling/data/raw/permits/mac-mini-roofing/`
  - copied raw Omaha permit JSON snapshots and scraper references from the Mac mini
- `modeling/data/raw/permits/omaha_multitrade_2025-11-01_2026-04-14.csv`
  - canonical wide permit CSV with preserved raw fields plus parsed columns
- `modeling/data/processed/`
  - joined/cohort tables, holdout predictions, metrics, feature importance, and error breakdowns
- `modeling/data/processed/multicounty/`
  - multicounty match/status summaries, including the address-fallback join pass
- `modeling/output/v1/`
  - manifest, scored cohort, nearest comps, band diagnostics, company rollup, and stakeholder HTML report

## Important current realities

- The broad source is genuinely multi-trade, but many plumbing/electrical/HVAC rows have no declared valuation, so they stay in intake counts while dropping out of the pricing cohort.
- The current packaged point model is `permit-type-fallback-forest-log`, selected by chronological calibration MAE.
- The recommended first product surface is still the same-type nearest-comp 5th-95th percentile band plus the comparable-job list behind it.
- The package now also carries permit-type holdout coverage diagnostics plus row-level `band_reliability_tier` / `band_reliability_note` fields so wide or weakly supported ranges are easier to caveat.
- Sarpy is staged and checked every run, but the current live cohort still contributes `0` Sarpy rows.

## Legacy / narrower path

`run_competitor_v1.py` still defaults to the older roofing-fetch flow when `--permit-csv` is omitted. Keep that behavior only for narrower prototype reruns; the current packaged competitor work uses the explicit multi-trade command above.
