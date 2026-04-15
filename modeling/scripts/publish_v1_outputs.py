#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from datetime import timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from train_models import COMP_FEATURES
from train_models import fit_point_model
from train_models import predict_point_model
from train_models import select_comp_pool
from train_models import with_comp_segments

MODEL_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
MULTICOUNTY_DIR = PROCESSED_DIR / "multicounty"
SARPY_DIR = PROCESSED_DIR / "sarpy_county"
OUTPUT_DIR = MODEL_ROOT / "output" / "v1"
RELIABILITY_THRESHOLDS = {
    "higher": {"holdout_jobs": 20, "coverage_90": 0.82, "median_width_ratio": 3.0},
    "standard": {"holdout_jobs": 10, "coverage_90": 0.72, "median_width_ratio": 6.0},
}
TIER_DEMOTION = {
    "higher": "standard",
    "standard": "caution",
    "caution": "caution",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_source_county(frame: pd.DataFrame) -> pd.DataFrame:
    working = frame.copy()
    if "source_county" not in working.columns:
        working["source_county"] = "douglas"
    working["source_county"] = working["source_county"].fillna("douglas")
    return working


def safe_width_ratio(width: pd.Series, median: pd.Series) -> pd.Series:
    safe_median = pd.to_numeric(median, errors="coerce").replace({0: np.nan})
    return pd.to_numeric(width, errors="coerce") / safe_median


def dominant_value(series: pd.Series) -> str:
    cleaned = series.fillna("Unknown").astype(str)
    modes = cleaned.mode()
    if not modes.empty:
        return str(modes.iloc[0])
    if cleaned.empty:
        return "Unknown"
    return str(cleaned.iloc[0])


def coerce_int(value: float | int | None, default: int = 0) -> int:
    if value is None or pd.isna(value):
        return default
    return int(value)


def assign_band_reliability_tier(
    holdout_jobs: float | int | None,
    coverage_90: float | int | None,
    median_width_ratio: float | int | None,
) -> str:
    jobs = coerce_int(holdout_jobs)
    coverage = float(coverage_90) if coverage_90 is not None and not pd.isna(coverage_90) else np.nan
    width_ratio = (
        float(median_width_ratio) if median_width_ratio is not None and not pd.isna(median_width_ratio) else np.nan
    )
    if (
        jobs >= RELIABILITY_THRESHOLDS["higher"]["holdout_jobs"]
        and coverage >= RELIABILITY_THRESHOLDS["higher"]["coverage_90"]
        and width_ratio <= RELIABILITY_THRESHOLDS["higher"]["median_width_ratio"]
    ):
        return "higher"
    if (
        jobs >= RELIABILITY_THRESHOLDS["standard"]["holdout_jobs"]
        and coverage >= RELIABILITY_THRESHOLDS["standard"]["coverage_90"]
        and width_ratio <= RELIABILITY_THRESHOLDS["standard"]["median_width_ratio"]
    ):
        return "standard"
    return "caution"


def demote_band_reliability_tier(tier: str) -> str:
    return TIER_DEMOTION.get(tier, "caution")


def build_band_reliability_note(
    holdout_jobs: float | int | None,
    coverage_90: float | int | None,
    comp_pool_strategy: str,
    width_ratio: float | int | None,
    typical_width_ratio: float | int | None,
) -> str:
    fragments: list[str] = []
    jobs = coerce_int(holdout_jobs)
    if coverage_90 is not None and not pd.isna(coverage_90) and jobs:
        fragments.append(f"{jobs} holdout jobs; 90% band coverage {float(coverage_90) * 100:.0f}%")
    else:
        fragments.append("no meaningful holdout coverage sample for this permit type yet")
    if comp_pool_strategy != "permit_type+class":
        fragments.append(f"current row used {comp_pool_strategy} comp selection")
    if width_ratio is not None and not pd.isna(width_ratio):
        width_ratio_value = float(width_ratio)
        typical_ratio_value = (
            float(typical_width_ratio)
            if typical_width_ratio is not None and not pd.isna(typical_width_ratio)
            else np.nan
        )
        if not np.isnan(typical_ratio_value) and width_ratio_value > max(typical_ratio_value * 1.5, 6.0):
            fragments.append("current band is wider than typical for this permit type")
        elif width_ratio_value > 8.0:
            fragments.append("current band is very wide versus the comp median")
    return "; ".join(fragments)


def fit_full_cohort_packaged_point_model(frame: pd.DataFrame, point_model_name: str) -> np.ndarray:
    fitted_model = fit_point_model(point_model_name, frame)
    return predict_point_model(point_model_name, fitted_model, frame)


def build_full_cohort_comp_outputs(
    frame: pd.DataFrame,
    neighbors: int,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if len(frame) < 2:
        raise RuntimeError("Need at least 2 cohort rows to build nearest-comp outputs.")

    frame = with_comp_segments(frame)
    prep = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    fit_features = prep.fit_transform(frame[COMP_FEATURES])

    range_rows: list[dict[str, object]] = []
    comp_rows: list[dict[str, object]] = []
    for row_index in range(len(frame)):
        subject = frame.iloc[row_index]
        pool_mask, pool_strategy = select_comp_pool(frame, subject)
        candidate_positions = [int(idx) for idx in np.flatnonzero(pool_mask.to_numpy()) if int(idx) != row_index]
        if not candidate_positions:
            candidate_positions = [int(idx) for idx in range(len(frame)) if int(idx) != row_index]
            pool_strategy = "all_history"
        candidate_features = fit_features[candidate_positions]
        model = NearestNeighbors(n_neighbors=min(neighbors, len(candidate_positions)), metric="euclidean")
        model.fit(candidate_features)
        distances, indices = model.kneighbors(fit_features[row_index].reshape(1, -1))
        kept_neighbors = [
            (float(distance), int(candidate_positions[int(idx)])) for distance, idx in zip(distances[0], indices[0], strict=False)
        ]
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
                "comp_pool_strategy": pool_strategy,
                "comp_pool_size": int(len(candidate_positions)),
            }
        )

        for rank, (distance, neighbor_index) in enumerate(kept_neighbors, start=1):
            neighbor = frame.iloc[neighbor_index]
            comp_rows.append(
                {
                    "subject_record_number": subject["record_number"],
                    "subject_record_date": subject["record_date"].strftime("%Y-%m-%d"),
                    "subject_permit_type": subject["permit_type"],
                    "subject_permit_prefix": subject["permit_prefix"],
                    "subject_class": subject["class"],
                    "subject_source_county": subject["source_county"],
                    "subject_address": subject["property_a"],
                    "subject_company_name": subject["licensed_company_name"],
                    "subject_job_value": float(subject["job_value"]),
                    "neighbor_rank": rank,
                    "comp_pool_strategy": pool_strategy,
                    "distance": float(distance),
                    "neighbor_record_number": neighbor["record_number"],
                    "neighbor_record_date": neighbor["record_date"].strftime("%Y-%m-%d"),
                    "neighbor_permit_type": neighbor["permit_type"],
                    "neighbor_permit_prefix": neighbor["permit_prefix"],
                    "neighbor_class": neighbor["class"],
                    "neighbor_source_county": neighbor["source_county"],
                    "neighbor_company_name": neighbor["licensed_company_name"],
                    "neighbor_address": neighbor["property_a"],
                    "neighbor_prop_zip": neighbor["prop_zip"],
                    "neighbor_bldg_sf": float(neighbor["bldg_sf"]),
                    "neighbor_job_value": float(neighbor["job_value"]),
                }
            )

    return pd.DataFrame(range_rows), pd.DataFrame(comp_rows)


def build_scored_cohort(
    frame: pd.DataFrame,
    packaged_point_pred: np.ndarray,
    comp_ranges: pd.DataFrame,
    point_model_name: str,
    band_diagnostics: pd.DataFrame | None = None,
) -> pd.DataFrame:
    scored = frame[
        [
            "record_number",
            "record_date",
            "permit_prefix",
            "permit_type",
            "category",
            "class",
            "status",
            "source_county",
            "property_a",
            "prop_city",
            "prop_zip",
            "owner_name",
            "licensed_company_name",
            "roof_covering_material",
            "bldg_sf",
            "total_valu",
            "number_of_buildings",
            "construction_type_codes",
            "property_age",
            "job_value",
            "source_date_range_start",
            "source_date_range_end",
        ]
    ].copy()
    scored["point_model_name"] = point_model_name
    scored["packaged_point_estimate"] = packaged_point_pred
    scored["forest_point_estimate"] = packaged_point_pred
    scored = scored.merge(comp_ranges, on="record_number", how="left")
    scored["recommended_band_low"] = scored["comp_low_05"]
    scored["recommended_band_high"] = scored["comp_high_95"]
    scored["actual_minus_comp_median"] = scored["job_value"] - scored["comp_median"]
    scored["actual_vs_comp_median_pct"] = np.where(
        scored["comp_median"] > 0,
        scored["actual_minus_comp_median"] / scored["comp_median"],
        np.nan,
    )
    scored["packaged_minus_comp_median"] = scored["packaged_point_estimate"] - scored["comp_median"]
    scored["forest_minus_comp_median"] = scored["packaged_minus_comp_median"]
    scored["recommended_band_width"] = scored["recommended_band_high"] - scored["recommended_band_low"]
    scored["recommended_band_width_ratio"] = safe_width_ratio(scored["recommended_band_width"], scored["comp_median"])
    if band_diagnostics is not None and not band_diagnostics.empty:
        diagnostics = band_diagnostics.rename(
            columns={
                "holdout_jobs": "permit_type_holdout_jobs",
                "holdout_band_coverage_90": "permit_type_holdout_band_coverage_90",
                "holdout_median_band_width_ratio": "permit_type_holdout_median_band_width_ratio",
                "band_reliability_tier": "permit_type_band_reliability_tier",
            }
        )[
            [
                "permit_type",
                "permit_type_holdout_jobs",
                "permit_type_holdout_band_coverage_90",
                "permit_type_holdout_median_band_width_ratio",
                "permit_type_band_reliability_tier",
            ]
        ]
        scored = scored.merge(diagnostics, on="permit_type", how="left")
        tiers: list[str] = []
        notes: list[str] = []
        for row in scored.itertuples(index=False):
            tier = str(getattr(row, "permit_type_band_reliability_tier", "caution") or "caution")
            if getattr(row, "comp_pool_strategy", "Unknown") != "permit_type+class":
                tier = demote_band_reliability_tier(tier)
            if int(getattr(row, "comp_neighbor_count", 0) or 0) < 8:
                tier = demote_band_reliability_tier(tier)
            width_ratio = getattr(row, "recommended_band_width_ratio", np.nan)
            typical_ratio = getattr(row, "permit_type_holdout_median_band_width_ratio", np.nan)
            if pd.notna(width_ratio) and (
                (pd.notna(typical_ratio) and float(width_ratio) > max(float(typical_ratio) * 1.5, 6.0))
                or float(width_ratio) > 8.0
            ):
                tier = demote_band_reliability_tier(tier)
            tiers.append(tier)
            notes.append(
                build_band_reliability_note(
                    getattr(row, "permit_type_holdout_jobs", None),
                    getattr(row, "permit_type_holdout_band_coverage_90", None),
                    str(getattr(row, "comp_pool_strategy", "Unknown")),
                    width_ratio,
                    typical_ratio,
                )
            )
        scored["band_reliability_tier"] = tiers
        scored["band_reliability_note"] = notes
        scored = scored.drop(columns=["permit_type_band_reliability_tier", "permit_type_holdout_median_band_width_ratio"])
    else:
        scored["permit_type_holdout_jobs"] = np.nan
        scored["permit_type_holdout_band_coverage_90"] = np.nan
        scored["band_reliability_tier"] = "caution"
        scored["band_reliability_note"] = "No holdout comparable-band diagnostics available."
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
            median_packaged_point_estimate=("packaged_point_estimate", "median"),
            median_comp_median=("comp_median", "median"),
            median_recommended_band_low=("recommended_band_low", "median"),
            median_recommended_band_high=("recommended_band_high", "median"),
            first_seen=("record_date", "min"),
            last_seen=("record_date", "max"),
        )
        .reset_index()
        .sort_values(["job_count", "median_job_value"], ascending=[False, False])
    )
    company_rollup["median_forest_point_estimate"] = company_rollup["median_packaged_point_estimate"]
    return company_rollup


def build_band_diagnostics(scored: pd.DataFrame, holdout: pd.DataFrame) -> pd.DataFrame:
    scored_work = scored.copy()
    scored_work["permit_type"] = scored_work["permit_type"].fillna("Unknown").astype(str)
    holdout_work = holdout.copy()
    holdout_work["permit_type"] = holdout_work["permit_type"].fillna("Unknown").astype(str)
    holdout_work["band_width"] = holdout_work["comp_high_95"] - holdout_work["comp_low_05"]
    holdout_work["band_width_ratio"] = safe_width_ratio(holdout_work["band_width"], holdout_work["comp_median"])
    holdout_work["in_band_90"] = (holdout_work["job_value"] >= holdout_work["comp_low_05"]) & (
        holdout_work["job_value"] <= holdout_work["comp_high_95"]
    )

    grouped_holdout = (
        holdout_work.groupby("permit_type", dropna=False)
        .agg(
            holdout_jobs=("record_number", "count"),
            holdout_band_coverage_90=("in_band_90", "mean"),
            holdout_median_band_width=("band_width", "median"),
            holdout_median_band_width_ratio=("band_width_ratio", "median"),
            holdout_median_neighbor_count=("comp_neighbor_count", "median"),
        )
        .reset_index()
    )
    cohort_counts = scored_work["permit_type"].value_counts().rename_axis("permit_type").reset_index(name="cohort_rows")
    dominant_pool = (
        scored_work.groupby("permit_type", dropna=False)["comp_pool_strategy"]
        .agg(dominant_value)
        .rename("dominant_comp_pool_strategy")
        .reset_index()
    )
    permit_types = pd.DataFrame(
        {"permit_type": sorted(set(cohort_counts["permit_type"]).union(set(grouped_holdout["permit_type"])))}
    )
    diagnostics = (
        permit_types.merge(cohort_counts, on="permit_type", how="left")
        .merge(grouped_holdout, on="permit_type", how="left")
        .merge(dominant_pool, on="permit_type", how="left")
        .fillna({"cohort_rows": 0, "holdout_jobs": 0, "dominant_comp_pool_strategy": "Unknown"})
    )
    diagnostics["cohort_rows"] = diagnostics["cohort_rows"].astype(int)
    diagnostics["holdout_jobs"] = diagnostics["holdout_jobs"].astype(int)
    diagnostics["band_reliability_tier"] = diagnostics.apply(
        lambda row: assign_band_reliability_tier(
            row["holdout_jobs"],
            row["holdout_band_coverage_90"],
            row["holdout_median_band_width_ratio"],
        ),
        axis=1,
    )
    diagnostics["band_reliability_note"] = diagnostics.apply(
        lambda row: build_band_reliability_note(
            row["holdout_jobs"],
            row["holdout_band_coverage_90"],
            str(row["dominant_comp_pool_strategy"]),
            row["holdout_median_band_width_ratio"],
            row["holdout_median_band_width_ratio"],
        ),
        axis=1,
    )
    return diagnostics.sort_values(
        ["cohort_rows", "holdout_jobs", "holdout_band_coverage_90"],
        ascending=[False, False, False],
    ).reset_index(drop=True)


def read_json(path: Path | None) -> dict[str, object] | None:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def build_manifest(
    cohort: pd.DataFrame,
    scored: pd.DataFrame,
    stub: str,
    cohort_profile: str,
    metrics: pd.DataFrame | None,
    model_summary: dict[str, object] | None,
    band_diagnostics: pd.DataFrame | None,
    sarpy_overlap: dict[str, object] | None,
    multicounty_summary: dict[str, object] | None,
    output_dir: Path,
    scored_path: Path,
    comps_path: Path,
    company_rollup_path: Path,
    band_diagnostics_path: Path,
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

    packaged_model_name = str((model_summary or {}).get("selected_point_model", "random-forest-log"))
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
    permit_type_counts = cohort["permit_type"].fillna("Unknown").value_counts().to_dict()
    class_counts = cohort["class"].fillna("Unknown").value_counts().to_dict()
    company_coverage = (
        float(
            (
                ~cohort["licensed_company_name"]
                .fillna("")
                .astype(str)
                .str.strip()
                .isin(["", "Unknown", "N/A", "Not Hyperlinked"])
            ).mean()
        )
        if "licensed_company_name" in cohort.columns
        else 0.0
    )
    multi_trade_surface = (
        "Job-level competitor band within the same permit type (and preferably the same property class): "
        "show the nearest-comp 5th-95th percentile band, the comp median, and the closest comparable permits behind it."
    )
    band_reliability_counts = (
        scored["band_reliability_tier"].value_counts(dropna=False).to_dict()
        if "band_reliability_tier" in scored.columns
        else {}
    )
    caution_types = []
    if band_diagnostics is not None and not band_diagnostics.empty:
        caution_types = (
            band_diagnostics.loc[
                (band_diagnostics["band_reliability_tier"] == "caution") & (band_diagnostics["cohort_rows"] >= 10),
                "permit_type",
            ]
            .head(5)
            .tolist()
        )

    return {
        "package_version": "v1",
        "generated_at": iso_now(),
        "permit_window": permit_window,
        "cohort": {
            "rows": int(len(cohort)),
            "cohort_profile": cohort_profile,
            "source_counties": source_counties,
            "permit_type_counts": permit_type_counts,
            "class_counts": class_counts,
            "median_job_value": float(cohort["job_value"].median()),
        },
        "validation": {
            "best_point_model": (model_summary or {}).get("best_point_model", (model_summary or {}).get("best_model")),
            "packaged_point_model": packaged_model_name,
            "packaged_point_model_selected_via": "chronological calibration MAE",
            "packaged_point_model_holdout_mae": (packaged_model_metrics or {}).get("holdout_mae"),
            "packaged_point_model_holdout_median_ape_pct": (packaged_model_metrics or {}).get("holdout_median_ape_pct"),
            "recommended_band_method": "nearest-neighbor empirical 5th-95th percentile band",
            "recommended_band_holdout_coverage": (model_summary or {}).get("neighbor_range_coverage_90"),
            "recommended_band_confidence_method": (
                "permit-type holdout coverage plus current comp-pool breadth and band-width checks"
            ),
        },
        "band_reliability": {
            "tier_counts": band_reliability_counts,
            "higher_share": float((scored["band_reliability_tier"] == "higher").mean())
            if "band_reliability_tier" in scored.columns
            else None,
            "caution_share": float((scored["band_reliability_tier"] == "caution").mean())
            if "band_reliability_tier" in scored.columns
            else None,
            "median_band_width": float(scored["recommended_band_width"].median())
            if "recommended_band_width" in scored.columns
            else None,
            "median_band_width_ratio": float(scored["recommended_band_width_ratio"].median())
            if "recommended_band_width_ratio" in scored.columns
            else None,
            "caution_permit_types": caution_types,
        },
        "readiness": {
            "nearest_comp_band": "v1-ready",
            "nearest_comp_list": "v1-ready",
            "packaged_point_estimate": "supporting-only",
            "company_rollup": "source-limited" if company_coverage < 0.10 else "exploratory",
            "sarpy_multicounty_signal": "staged-no-live-signal",
        },
        "sarpy_status": sarpy_status,
        "recommended_first_product_surface": (
            multi_trade_surface if cohort_profile == "broad_permit_modeling"
            else "Douglas-only job-level competitor band: show the nearest-comp 5th-95th percentile band, comp median, and the closest comparable permits for residential re-roof jobs."
        ),
        "files": {
            "output_dir": str(output_dir),
            "scored_cohort_csv": str(scored_path),
            "nearest_comps_csv": str(comps_path),
            "company_rollup_csv": str(company_rollup_path),
            "band_diagnostics_csv": str(band_diagnostics_path),
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
            (
                "Current cohort uses the broader multi-trade Omaha permit copy and same-type comparable pools."
                if cohort_profile == "broad_permit_modeling"
                else "Current live cohort is Douglas-only residential re-roof permits."
            ),
            "Permit job value is a public declared valuation, not realized invoice revenue.",
            (
                "The current multi-trade source mostly lacks contractor/company fields, so company rollups remain limited."
                if company_coverage < 0.10
                else "Contractor/company strings are not yet normalized, so company rollups remain exploratory."
            ),
            sarpy_note,
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish product-facing v1 competitor-analysis outputs.")
    parser.add_argument("--cohort-csv", type=Path, required=True)
    parser.add_argument("--cohort-profile", default="residential_roofing_v1")
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

    model_summary = read_json(model_summary_json)
    selected_point_model = str((model_summary or {}).get("selected_point_model", "random-forest-log"))
    packaged_point_pred = fit_full_cohort_packaged_point_model(cohort, selected_point_model)
    comp_ranges, nearest_comps = build_full_cohort_comp_outputs(cohort, neighbors=args.neighbors)
    base_scored = build_scored_cohort(cohort, packaged_point_pred, comp_ranges, selected_point_model)

    metrics = pd.read_csv(metrics_csv) if metrics_csv.exists() else None
    sarpy_overlap = read_json(sarpy_overlap_summary_json)
    multicounty_summary = read_json(multicounty_join_summary_json)
    holdout_predictions_path = Path(
        (model_summary or {}).get("artifacts", {}).get("holdout_predictions_csv", PROCESSED_DIR / f"{stub}_holdout_predictions.csv")
    )
    holdout_predictions = pd.read_csv(holdout_predictions_path) if holdout_predictions_path.exists() else pd.DataFrame()
    band_diagnostics = build_band_diagnostics(base_scored, holdout_predictions) if not holdout_predictions.empty else pd.DataFrame()
    scored = build_scored_cohort(cohort, packaged_point_pred, comp_ranges, selected_point_model, band_diagnostics=band_diagnostics)
    company_rollup = build_company_rollup(scored)

    scored_path = args.output_dir / "scored_cohort.csv"
    comps_path = args.output_dir / "nearest_comps.csv"
    company_rollup_path = args.output_dir / "company_rollup.csv"
    band_diagnostics_path = args.output_dir / "band_diagnostics.csv"
    manifest_path = args.output_dir / "manifest.json"

    scored.to_csv(scored_path, index=False)
    nearest_comps.to_csv(comps_path, index=False)
    company_rollup.to_csv(company_rollup_path, index=False)
    band_diagnostics.to_csv(band_diagnostics_path, index=False)

    manifest = build_manifest(
        cohort=cohort,
        scored=scored,
        stub=stub,
        cohort_profile=args.cohort_profile,
        metrics=metrics,
        model_summary=model_summary,
        band_diagnostics=band_diagnostics,
        sarpy_overlap=sarpy_overlap,
        multicounty_summary=multicounty_summary,
        output_dir=args.output_dir,
        scored_path=scored_path,
        comps_path=comps_path,
        company_rollup_path=company_rollup_path,
        band_diagnostics_path=band_diagnostics_path,
        metrics_path=metrics_csv,
        model_summary_path=model_summary_json,
        multicounty_summary_path=multicounty_join_summary_json,
        sarpy_overlap_path=sarpy_overlap_summary_json,
    )
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[publish-v1] wrote {scored_path}")
    print(f"[publish-v1] wrote {comps_path}")
    print(f"[publish-v1] wrote {company_rollup_path}")
    print(f"[publish-v1] wrote {band_diagnostics_path}")
    print(f"[publish-v1] wrote {manifest_path}")


if __name__ == "__main__":
    main()
