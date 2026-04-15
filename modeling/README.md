# Modeling workspace

## Canonical v1 pipeline

Run the current usable package from the repo root:

```bash
python3 modeling/scripts/run_competitor_v1.py
```

Default behavior reuses the copied Omaha permit extract already under `modeling/data/raw/roofing/`, rebuilds the Douglas modeling cohort, refreshes Sarpy staging + multicounty status checks, retrains the prototype models, and publishes clean consumer-facing outputs under `modeling/output/v1/`.

Use `--refresh-permits` only when you want to hit the live Accela source again:

```bash
python3 modeling/scripts/run_competitor_v1.py --refresh-permits
```

The v1 pipeline currently packages:
1. Douglas-only residential re-roof cohort prep and evaluation artifacts in `modeling/data/processed/`
2. Sarpy staging/status refresh in `modeling/data/raw/properties/sarpy_county/` and `modeling/data/processed/sarpy_county/`
3. multicounty join status artifacts in `modeling/data/processed/multicounty/`
4. app-consumable v1 outputs in `modeling/output/v1/`

## Legacy prototype entrypoint

The original exploratory orchestrator still exists:

```bash
python3 modeling/scripts/run_full_pipeline.py
```

Use that only if you want the narrower prototype flow without the v1 packaging layer.
