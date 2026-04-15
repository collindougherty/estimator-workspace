#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from datetime import timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from train_models import CATEGORICAL_FEATURES
from train_models import COMP_FEATURES
from train_models import NUMERIC_FEATURES
from train_models import fit_log_model
from train_models import make_preprocessor
from train_models import predict_dollars

MODEL_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
MULTICOUNTY_DIR = PROCESSED_DIR / "multicounty"
SARPY_DIR = PROCESSED_DIR / "sarpy_county"
OUTPUT_DIR = MODEL_ROOT / "output" / "v1"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_source_county(frame: pd.DataFrame) -> pd.DataFrame:
    working = frame.copy()
    if "source_county" not in working.columns:
        working["source_county"] = "douglas"
    working["source_county"] = working["source_county"].fillna("douglas")
    return working


def fit_full_cohort_forest(frame: pd.DataFrame) -> np.ndarray:
    forest_pipeline = Pipeline(
        [
            ("preprocess", make_preprocessor(scale_numeric=False, dense_output=True)),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=400,
                    max_depth=12,
                    min_samples_leaf=3,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    forest_pipeline = fit_log_model(forest_pipeline, frame[NUMERIC_FEATURES + CATEGORICAL_FEATURES], frame["job_value"])
    return predict_dollars(forest_pipeline, frame[NUMERIC_FEATURES + CATEGORICAL_FEATURES])


def build_full_cohort_comp_outputs(
    frame: pd.DataFrame,
    neighbors: int,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if len(frame) < 2:
        raise RuntimeError("Need at least 2 cohort rows to build nearest-comp outputs.")

    prep = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    fit_features = prep.fit_transform(frame[COMP_FEATURES])
    model = NearestNeighbors(n_neighbors=min(neighbors + 1, len(frame)), metric="euclidean")
    model.fit(fit_features)
    distances, indices = model.kneighbors(fit_features)

    range_rows: list[dict[str, object]] = []
    comp_rows: list[dict[str, object]] = []
    for row_index, (dist_row, idx_row) in enumerate(zip(distances, indices, strict=False)):
        subject = frame.iloc[row_index]
        kept_neighbors = [(float(distance), int(idx)) for distance, idx in zip(dist_row, idx_row, strict=False) if int(idx) != row_index]
        kept_neighbors = kept_neighbors[:neighbors]
        if not kept_neighbors:
            continue

        neighbor_index_list = [idx for _, idx in kept_neighbors]
        neighbor_frame = frame.iloc[neighbor_index_list].copy().reset_index(drop=True)
        values = neighbor_frame["job_value"].to_numpy(dtype=float)

        range_rows.append(
            {
                "record_number": subject["record_number"],
                "comp_median": float(np.median(values)),
                "comp_low_10": float(np.quantile(values, 0.10)),
                "comp_high_90": float(np.quantile(values, 0.90)),
                "comp_low_05": float(np.quantile(values, 0.05)),
                "comp_high_95": float(np.quantile(values, 0.95)),
                "comp_neighbor_count": int(len(values)),
            }
        )

        for rank, (distance, neighbor_index) in enumerate(kept_neighbors, start=1):
            neighbor = frame.iloc[neighbor_index]
            comp_rows.append(
                {
                    "subject_record_number": subject["record_number"],
                    "subject_record_date": subject["record_date"].strftime("%Y-%m-%d"),
                    "subject_source_county": subject["source_county"],
                    "subject_address": subject["property_a"],
                    "subject_company_name": subject["licensed_company_name"],
                    "subject_job_value": float(subject["job_value"]),
                    "neighbor_rank": rank,
                    "distance": float(distance),
                    "neighbor_record_number": neighbor["record_number"],
                    "neighbor_record_date": neighbor["record_date"].strftime("%Y-%m-%d"),
                    "neighbor_source_county": neighbor["source_county"],
                    "neighbor_company_name": neighbor["licensed_company_name"],
                    "neighbor_address": neighbor["property_a"],
                    "neighbor_prop_zip": neighbor["prop_zip"],
                    "neighbor_bldg_sf": float(neighbor["bldg_sf"]),
                    "neighbor_job_value": float(neighbor["job_value"]),
                }
            )

    return pd.DataFrame(range_rows), pd.DataFrame(comp_rows)


def build_scored_cohort(frame: pd.DataFrame, forest_pred: np.ndarray, comp_ranges: pd.DataFrame) -> pd.DataFrame:
    scored = frame[
        [
            "record_number",
            "record_date",
            "permit_type",
            "status",
            "source_county",
            "property_a",
            "prop_city",
            "prop_zip",
            "licensed_company_name",
            "roof_covering_material",
            "bldg_sf",
            "total_valu",
            "property_age",
            "job_value",
            "source_date_range_start",
            "source_date_range_end",
        ]
    ].copy()
    scored["forest_point_estimate"] = forest_pred
    scored = scored.merge(comp_ranges, on="record_number", how="left")
    scored["recommended_band_low"] = scored["comp_low_05"]
    scored["recommended_band_high"] = scored["comp_high_95"]
    scored["actual_minus_comp_median"] = scored["job_value"] - scored["comp_median"]
    scored["actual_vs_comp_median_pct"] = np.where(
        scored["comp_median"] > 0,
        scored["actual_minus_comp_median"] / scored["comp_median"],
        np.nan,
    )
    scored["forest_minus_comp_median"] = scored["forest_point_estimate"] - scored["comp_median"]
    scored["record_date"] = pd.to_datetime(scored["record_date"], errors="coerce").dt.strftime("%Y-%m-%d")
    return scored.sort_values(["record_date", "record_number"]).reset_index(drop=True)


def build_company_rollup(scored: pd.DataFrame) -> pd.DataFrame:
    working = scored.copy()
    working["licensed_company_name"] = working["licensed_company_name"].fillna("Unknown")
    company_rollup = (
        working.groupby(["licensed_company_name", "source_county"], dropna=False)
        .agg(
            job_count=("record_number", "count"),
            median_job_value=("job_value", "median"),
            median_forest_point_estimate=("forest_point_estimate", "median"),
            median_comp_median=("comp_median", "median"),
            median_recommended_band_low=("recommended_band_low", "median"),
            median_recommended_band_high=("recommended_band_high", "median"),
            first_seen=("record_date", "min"),
            last_seen=("record_date", "max"),
        )
        .reset_index()
        .sort_values(["job_count", "median_job_value"], ascending=[False, False])
    )
    return company_rollup


def read_json(path: Path | None) -> dict[str, object] | None:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def build_manifest(
    cohort: pd.DataFrame,
    stub: str,
    metrics: pd.DataFrame | None,
    model_summary: dict[str, object] | None,
    sarpy_overlap: dict[str, object] | None,
    multicounty_summary: dict[str, object] | None,
    output_dir: Path,
    scored_path: Path,
    comps_path: Path,
    company_rollup_path: Path,
    metrics_path: Path,
    model_summary_path: Path,
    multicounty_summary_path: Path,
    sarpy_overlap_path: Path,
) -> dict[str, object]:
    source_counties = cohort["source_county"].fillna("Unknown").value_counts().to_dict()
    stub_parts = stub.replace("_cohort", "").split("_")
    permit_key = "_".join(stub_parts[:-2]) if len(stub_parts) >= 3 else stub.replace("_cohort", "")
    permit_window = {
        "stub": stub,
        "permit_key": permit_key,
        "start_date": cohort["source_date_range_start"].dropna().min() if not cohort["source_date_range_start"].dropna().empty else None,
        "end_date": cohort["source_date_range_end"].dropna().max() if not cohort["source_date_range_end"].dropna().empty else None,
    }

    packaged_model_name = "random-forest-log"
    packaged_model_metrics = None
    if metrics is not None and not metrics.empty and "model" in metrics.columns:
        packaged_row = metrics.loc[metrics["model"] == packaged_model_name]
        if not packaged_row.empty:
            record = packaged_row.iloc[0].to_dict()
            packaged_model_metrics = {
                "holdout_mae": float(record["mae"]),
                "holdout_rmse": float(record["rmse"]),
                "holdout_median_ape": float(record["median_ape"]),
                "holdout_median_ape_pct": float(record["median_ape"]) * 100.0,
                "holdout_within_10pct": float(record["within_10pct"]),
                "holdout_within_20pct": float(record["within_20pct"]),
            }

    sarpy_note = "Sarpy is staged but currently contributes no rows to the live permit-window cohort."
    sarpy_status = {
        "staged": sarpy_overlap is not None,
        "parcel_matches": int((sarpy_overlap or {}).get("parcelid_matches", 0)),
        "normalized_full_address_matches": int((sarpy_overlap or {}).get("normalized_full_address_matches", 0)),
        "live_cohort_rows": int(((multicounty_summary or {}).get("cohort_rows_by_source") or {}).get("sarpy", 0)),
        "note": sarpy_note,
    }

    return {
        "package_version": "v1",
        "generated_at": iso_now(),
        "permit_window": permit_window,
        "cohort": {
            "rows": int(len(cohort)),
            "source_counties": source_counties,
            "median_job_value": float(cohort["job_value"].median()),
        },
        "validation": {
            "best_point_model": (model_summary or {}).get("best_model"),
            "packaged_point_model": packaged_model_name,
            "packaged_point_model_holdout_mae": (packaged_model_metrics or {}).get("holdout_mae"),
            "packaged_point_model_holdout_median_ape_pct": (packaged_model_metrics or {}).get("holdout_median_ape_pct"),
            "recommended_band_method": "nearest-neighbor empirical 5th-95th percentile band",
            "recommended_band_holdout_coverage": (model_summary or {}).get("neighbor_range_coverage_90"),
        },
        "readiness": {
            "nearest_comp_band": "v1-ready",
            "nearest_comp_list": "v1-ready",
            "random_forest_point_estimate": "supporting-only",
            "company_rollup": "exploratory",
            "sarpy_multicounty_signal": "staged-no-live-signal",
        },
        "sarpy_status": sarpy_status,
        "recommended_first_product_surface": "Douglas-only job-level competitor band: show the nearest-comp 5th-95th percentile band, comp median, and the closest comparable permits for residential re-roof jobs.",
        "files": {
            "output_dir": str(output_dir),
            "scored_cohort_csv": str(scored_path),
            "nearest_comps_csv": str(comps_path),
            "company_rollup_csv": str(company_rollup_path),
            "output_readme": str(output_dir / "README.md"),
        },
        "supporting_artifacts": {
            "metrics_csv": str(metrics_path),
            "holdout_predictions_csv": str(PROCESSED_DIR / f"{stub}_holdout_predictions.csv"),
            "model_summary_json": str(model_summary_path),
            "multicounty_join_summary_json": str(multicounty_summary_path),
            "sarpy_overlap_summary_json": str(sarpy_overlap_path),
        },
        "limitations": [
            "Current live cohort is Douglas-only residential re-roof permits.",
            "Permit job value is a public declared valuation, not realized invoice revenue.",
            "Contractor/company strings are not yet normalized, so company rollups remain exploratory.",
            sarpy_note,
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish product-facing v1 competitor-analysis outputs.")
    parser.add_argument("--cohort-csv", type=Path, required=True)
    parser.add_argument("--metrics-csv", type=Path)
    parser.add_argument("--model-summary-json", type=Path)
    parser.add_argument("--sarpy-overlap-summary-json", type=Path)
    parser.add_argument("--multicounty-join-summary-json", type=Path)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--neighbors", type=int, default=12)
    args = parser.parse_args()

    stub = args.cohort_csv.stem
    metrics_csv = args.metrics_csv or (PROCESSED_DIR / f"{stub}_metrics.csv")
    model_summary_json = args.model_summary_json or (PROCESSED_DIR / f"{stub}_model_summary.json")
    sarpy_overlap_summary_json = args.sarpy_overlap_summary_json or (SARPY_DIR / "sarpy_current_permit_overlap_summary.json")
    multicounty_join_summary_json = args.multicounty_join_summary_json or (
        MULTICOUNTY_DIR / f"{stub.replace('_cohort', '')}_multicounty_join_summary.json"
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)

    cohort = pd.read_csv(args.cohort_csv, parse_dates=["record_date"])
    cohort = ensure_source_county(cohort)
    cohort["job_value"] = pd.to_numeric(cohort["job_value"], errors="coerce")
    cohort = cohort.dropna(subset=["job_value"]).sort_values(["record_date", "record_number"]).reset_index(drop=True)

    forest_pred = fit_full_cohort_forest(cohort)
    comp_ranges, nearest_comps = build_full_cohort_comp_outputs(cohort, neighbors=args.neighbors)
    scored = build_scored_cohort(cohort, forest_pred, comp_ranges)
    company_rollup = build_company_rollup(scored)

    scored_path = args.output_dir / "scored_cohort.csv"
    comps_path = args.output_dir / "nearest_comps.csv"
    company_rollup_path = args.output_dir / "company_rollup.csv"
    manifest_path = args.output_dir / "manifest.json"

    scored.to_csv(scored_path, index=False)
    nearest_comps.to_csv(comps_path, index=False)
    company_rollup.to_csv(company_rollup_path, index=False)

    metrics = pd.read_csv(metrics_csv) if metrics_csv.exists() else None
    model_summary = read_json(model_summary_json)
    sarpy_overlap = read_json(sarpy_overlap_summary_json)
    multicounty_summary = read_json(multicounty_join_summary_json)
    manifest = build_manifest(
        cohort=cohort,
        stub=stub,
        metrics=metrics,
        model_summary=model_summary,
        sarpy_overlap=sarpy_overlap,
        multicounty_summary=multicounty_summary,
        output_dir=args.output_dir,
        scored_path=scored_path,
        comps_path=comps_path,
        company_rollup_path=company_rollup_path,
        metrics_path=metrics_csv,
        model_summary_path=model_summary_json,
        multicounty_summary_path=multicounty_join_summary_json,
        sarpy_overlap_path=sarpy_overlap_summary_json,
    )
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[publish-v1] wrote {scored_path}")
    print(f"[publish-v1] wrote {comps_path}")
    print(f"[publish-v1] wrote {company_rollup_path}")
    print(f"[publish-v1] wrote {manifest_path}")


if __name__ == "__main__":
    main()
