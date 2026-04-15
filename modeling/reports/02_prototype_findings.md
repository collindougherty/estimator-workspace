# Initial modeling findings memo

## Objective

Build a low-compute prototype for estimating **competitor price ranges** for comparable residential re-roof jobs using public permit valuations plus county property attributes.

## Modeling setup

### Candidate targets

See `modeling/data/processed/residential_reroof_2025-11-01_2026-04-14_target_summary.csv`.

Targets considered:
1. `job_value` — raw declared permit valuation
2. `log_job_value` — chosen regression target for point models
3. `job_value_per_bldg_sf`
4. `job_value_per_total_value`

Why `log_job_value` for the main model:
- positive, right-skewed target
- stabilizes the high-value tail
- keeps linear and tree baselines inexpensive

### Features used

Core numeric features:
- `bldg_sf`
- `total_valu`, `land_value`, `improvemen`
- `property_age`, `bldg_story`, `sq_feet`, `acres`
- lat/lon
- `description_length`
- keyword flags from description (`decking`, `gutter`, `ventilation`, etc.)

Core categorical features:
- `roof_covering_material`
- `quality`
- `condition`
- `prop_zip`
- `permit_month`

Deliberately excluded from the main point model:
- contractor/company identity, because that is partly the thing we want to analyze rather than leak into a general market-price predictor

### Validation design

Chronological split on the 803-row cohort:
- train: **481**
- calibration: **161**
- holdout test: **161**

This is intentionally future-facing: predict later permits from earlier ones.

## Baselines and results

Metrics file:
- `modeling/data/processed/residential_reroof_2025-11-01_2026-04-14_cohort_metrics.csv`

Holdout results:

| model | MAE | median APE |
|---|---:|---:|
| random-forest-log | **$6,336** | **32.7%** |
| ridge-log-linear | $6,559 | 33.4% |
| nearest-comp-median | $6,854 | 37.4% |
| zip-rate-baseline | $7,675 | 43.1% |

Interpretation:
- The random forest is the best low-compute point model in this pass.
- The ridge model is close enough to remain a useful transparent baseline.
- The zip-rate heuristic is clearly weaker but still directionally usable as a sanity check.

## Range generation

### 1) Model-residual range

Current multiplicative residual interval from the random forest is **under-covered**:
- nominal 10/90 style interval coverage on holdout: **52.2%**

Conclusion: not reliable enough yet for a product-facing competitor range.

### 2) Nearest-neighbor comp range

Using empirical nearest historical comps was better:
- comp 10th–90th percentile coverage: **70.2%**
- comp 5th–95th percentile coverage: **85.1%**
- median 5th–95th range width: **~$18.1k**

Recommendation for v0:
- use the random forest for a **point estimate**
- use **nearest-neighbor empirical ranges** for the displayed competitor band

This is more faithful to the product concept anyway: “what comparable jobs appear to be priced at,” rather than pretending the point model is already calibrated enough to emit trustworthy uncertainty.

## Interpretability

Permutation importance for the random forest:
- `bldg_sf`
- `total_valu`
- `land_value`
- `improvemen`
- `description_length`
- `centroid_longitude`
- `property_age`
- `kw_decking`

The ridge coefficients tell a similar story:
- larger building footprint is the strongest positive driver
- higher assessed quality/value lifts expected valuation
- decking/gutter/ventilation language behaves like a lightweight complexity proxy

Artifacts:
- feature importance: `..._cohort_feature_importance.csv`
- ridge coefficients: `..._cohort_ridge_coefficients.csv`
- plots: `modeling/artifacts/residential_reroof_2025-11-01_2026-04-14_cohort_actual_vs_pred.png`, `..._residuals.png`

## Competitor / market observations

Filtered company summary:
- `modeling/data/processed/residential_reroof_2025-11-01_2026-04-14_company_summary_filtered.csv`

A few examples from this pull:
- Results Contracting: 49 jobs, median **$13.0k**
- Royalty Roofing Inc: 35 jobs, median **$8.6k**
- Bulldog Roofing: 27 jobs, median **$8.2k**
- Anchor Roofing & Landscaping LLC: 18 jobs, median **$16.5k**
- Erie Construction Mid-West Inc: 14 jobs, median **$35.2k**

Takeaway:
- even before deeper normalization, contractor-level spreads are large enough to justify a range-oriented UI
- some company strings are noisy, so contractor/entity cleanup should be an explicit next-step task

## Error analysis

Useful error tables:
- by zip: `..._cohort_error_by_zip.csv`
- by value band: `..._cohort_error_by_value_band.csv`

Patterns:
- small jobs (< roughly $7k) are frequently overpredicted
- large jobs (> roughly $15.7k) remain hard; MAE in the top quartile is materially larger than the middle of the distribution
- worst misses tend to be unusually cheap permits on otherwise normal-sized homes, suggesting misclassified scope, owner/self-permit behavior, or noisy declared valuations

## Limitations

1. **Permit valuation != realized competitor invoice**
   - this is still the best public, scalable target found in the available data, but it is noisy
2. **Only residential re-roof cohort**
   - roof repair and commercial work should be modeled separately
3. **Contractor identity needs cleanup**
   - some licensed-professional/company strings are not canonical business names
4. **No explicit roof geometry**
   - county building sf is only a proxy for roof size/complexity
5. **Uncertainty calibration is not production-ready**
   - nearest-comp ranges look more promising than residual-based model intervals

## Practical next steps

1. add contractor/entity normalization
2. parse more complexity signals from descriptions (multi-level roof, steep, detached garage, decking replacement volume)
3. evaluate quantile models or conformal methods after better label cleanup
4. split separate models for low-dollar/simple jobs vs. larger custom jobs
5. consider a product response shaped like:
   - point estimate from random forest
   - comp range from nearest neighbors
   - list of 5–10 comps with contractor, date, value, and property size

## Rerun

From repo root:

```bash
python3 modeling/scripts/run_full_pipeline.py
```

That reproduces the copied permit extract, property subset, prepared cohort, models, and evaluation artifacts inside `modeling/`.
