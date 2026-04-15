#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import pandas as pd

from prepare_dataset import PROPERTY_COLUMNS, engineer_features, summarize_targets

MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_PROPERTIES_DIR = MODEL_ROOT / "data" / "raw" / "properties" / "multicounty"
PROCESSED_DIR = MODEL_ROOT / "data" / "processed" / "multicounty"


def parse_source_arg(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("Property sources must be passed as county=path.")
    county, raw_path = value.split("=", 1)
    county = county.strip()
    path = Path(raw_path).expanduser()
    if not county:
        raise argparse.ArgumentTypeError("County label cannot be blank.")
    return county, path


def profile_source_columns(source_path: Path) -> list[str]:
    with source_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        return next(reader)


def non_blank_mask(series: pd.Series) -> pd.Series:
    return series.notna() & series.astype(str).str.strip().ne("")


def build_county_subset(source_path: Path, permit_pins: set[str], county_label: str) -> tuple[pd.DataFrame, dict[str, object]]:
    columns = profile_source_columns(source_path)
    missing = [column for column in PROPERTY_COLUMNS if column not in columns]
    if missing:
        raise ValueError(f"{county_label} source {source_path} is missing canonical columns: {missing}")

    selected_columns = set(PROPERTY_COLUMNS) | {"source_county"}
    total_rows = 0
    matched_rows = 0
    chunks: list[pd.DataFrame] = []
    for chunk in pd.read_csv(
        source_path,
        dtype=str,
        usecols=lambda column: column in selected_columns,
        chunksize=50_000,
        encoding="utf-8-sig",
    ):
        total_rows += len(chunk)
        filtered = chunk[chunk["pin"].isin(permit_pins)].copy()
        if filtered.empty:
            continue
        matched_rows += len(filtered)
        if "source_county" not in filtered.columns:
            filtered["source_county"] = county_label
        else:
            filtered["source_county"] = filtered["source_county"].fillna(county_label)
        chunks.append(filtered[PROPERTY_COLUMNS + ["source_county"]])

    subset = (
        pd.concat(chunks, ignore_index=True).drop_duplicates(subset=["pin"], keep="first")
        if chunks
        else pd.DataFrame(columns=PROPERTY_COLUMNS + ["source_county"])
    )
    return subset, {
        "county_label": county_label,
        "source_path": str(source_path),
        "source_size_bytes": source_path.stat().st_size,
        "total_rows_scanned": total_rows,
        "matched_rows": matched_rows,
        "matched_unique_pins": int(subset["pin"].nunique()) if not subset.empty else 0,
        "residential_rows": int((subset["class"] == "R").sum()) if not subset.empty else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Join permit data against multiple county property sources.")
    parser.add_argument("--permit-csv", type=Path, required=True)
    parser.add_argument(
        "--property-source",
        dest="property_sources",
        action="append",
        type=parse_source_arg,
        required=True,
        help="Repeat as county=path for each property source.",
    )
    parser.add_argument("--property-subset-csv", type=Path)
    parser.add_argument("--source-summary-json", type=Path)
    parser.add_argument("--joined-output-csv", type=Path)
    parser.add_argument("--cohort-output-csv", type=Path)
    parser.add_argument("--join-summary-json", type=Path)
    parser.add_argument("--target-summary-csv", type=Path)
    parser.add_argument("--company-summary-csv", type=Path)
    args = parser.parse_args()

    permit_csv = args.permit_csv
    stub = permit_csv.stem
    property_subset_csv = args.property_subset_csv or (RAW_PROPERTIES_DIR / f"{stub}_multicounty_property_subset.csv")
    source_summary_json = args.source_summary_json or (PROCESSED_DIR / f"{stub}_multicounty_source_summary.json")
    joined_output_csv = args.joined_output_csv or (PROCESSED_DIR / f"{stub}_multicounty_joined.csv")
    cohort_output_csv = args.cohort_output_csv or (PROCESSED_DIR / f"{stub}_multicounty_cohort.csv")
    join_summary_json = args.join_summary_json or (PROCESSED_DIR / f"{stub}_multicounty_join_summary.json")
    target_summary_csv = args.target_summary_csv or (PROCESSED_DIR / f"{stub}_multicounty_target_summary.csv")
    company_summary_csv = args.company_summary_csv or (PROCESSED_DIR / f"{stub}_multicounty_company_summary.csv")

    property_subset_csv.parent.mkdir(parents=True, exist_ok=True)
    source_summary_json.parent.mkdir(parents=True, exist_ok=True)
    joined_output_csv.parent.mkdir(parents=True, exist_ok=True)
    cohort_output_csv.parent.mkdir(parents=True, exist_ok=True)
    join_summary_json.parent.mkdir(parents=True, exist_ok=True)
    target_summary_csv.parent.mkdir(parents=True, exist_ok=True)
    company_summary_csv.parent.mkdir(parents=True, exist_ok=True)

    permits = pd.read_csv(permit_csv, dtype=str)
    permit_pins = {pin for pin in permits["parcel_number"].dropna().astype(str).tolist() if pin and pin != "nan"}

    per_source_stats: list[dict[str, object]] = []
    source_subsets: list[pd.DataFrame] = []
    for county_label, source_path in args.property_sources:
        subset, stats = build_county_subset(source_path, permit_pins, county_label)
        per_source_stats.append(stats)
        if not subset.empty:
            source_subsets.append(subset)

    property_subset = (
        pd.concat(source_subsets, ignore_index=True).drop_duplicates(subset=["pin"], keep="first")
        if source_subsets
        else pd.DataFrame(columns=PROPERTY_COLUMNS + ["source_county"])
    )
    property_subset.to_csv(property_subset_csv, index=False)

    joined = permits.merge(property_subset, left_on="parcel_number", right_on="pin", how="left", indicator=True)
    joined = engineer_features(joined)
    joined.to_csv(joined_output_csv, index=False)

    cohort = joined[
        (joined["_merge"] == "both")
        & (joined["job_value"].fillna(0) > 0)
        & (joined["status"].fillna("").isin(["Issued", "Closed"]))
        & (joined["class"].fillna("") == "R")
        & (joined["bldg_sf"].notna())
        & (joined["total_valu"].notna())
        & ((joined["number_of_buildings"].isna()) | (joined["number_of_buildings"] <= 1))
    ].copy()
    cohort = cohort.sort_values(["record_date", "record_number"]).reset_index(drop=True)
    cohort.to_csv(cohort_output_csv, index=False)

    join_summary = {
        "permit_rows": int(len(permits)),
        "permit_rows_with_job_value": int(pd.to_numeric(permits["job_value"], errors="coerce").notna().sum()),
        "permit_rows_with_parcel_number": int(permits["parcel_number"].notna().sum()),
        "property_subset_rows": int(len(property_subset)),
        "subset_rows_by_source": property_subset["source_county"].fillna("Unknown").value_counts().to_dict(),
        "joined_rows": int(len(joined)),
        "matched_rows": int((joined["_merge"] == "both").sum()),
        "matched_rows_by_source": joined.loc[joined["_merge"] == "both", "source_county"].fillna("Unknown").value_counts().to_dict(),
        "match_rate": float((joined["_merge"] == "both").mean()) if len(joined) else 0.0,
        "cohort_rows": int(len(cohort)),
        "cohort_rows_by_source": cohort["source_county"].fillna("Unknown").value_counts().to_dict(),
        "cohort_start_date": cohort["record_date"].min().strftime("%Y-%m-%d") if len(cohort) else None,
        "cohort_end_date": cohort["record_date"].max().strftime("%Y-%m-%d") if len(cohort) else None,
        "median_job_value": float(cohort["job_value"].median()) if len(cohort) else None,
        "median_job_value_per_bldg_sf": float(cohort["job_value_per_bldg_sf"].median()) if len(cohort) else None,
        "property_sources": [stats["county_label"] for stats in per_source_stats],
    }
    join_summary_json.write_text(json.dumps(join_summary, indent=2), encoding="utf-8")

    target_summary = summarize_targets(cohort)
    target_summary.to_csv(target_summary_csv, index=False)

    company_summary = (
        cohort.groupby(["licensed_company_name", "source_county"], dropna=False)
        .agg(
            job_count=("record_number", "count"),
            median_job_value=("job_value", "median"),
            median_job_value_per_bldg_sf=("job_value_per_bldg_sf", "median"),
            median_bldg_sf=("bldg_sf", "median"),
            first_seen=("record_date", "min"),
            last_seen=("record_date", "max"),
        )
        .reset_index()
        .sort_values(["job_count", "median_job_value"], ascending=[False, False])
    )
    company_summary.to_csv(company_summary_csv, index=False)

    source_summary_json.write_text(json.dumps(per_source_stats, indent=2), encoding="utf-8")

    print(f"[multicounty] wrote {property_subset_csv}")
    print(f"[multicounty] wrote {joined_output_csv}")
    print(f"[multicounty] wrote {cohort_output_csv}")
    print(f"[multicounty] wrote {join_summary_json}")
    print(f"[multicounty] matched_rows={join_summary['matched_rows']} sources={join_summary['matched_rows_by_source']}")


if __name__ == "__main__":
    main()
