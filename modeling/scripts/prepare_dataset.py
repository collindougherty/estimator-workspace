#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_PROPERTIES_DIR = MODEL_ROOT / "data" / "raw" / "properties"
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
DEFAULT_PROPERTY_SOURCE = Path("/Users/collindougherty/MyCloud/properties/omaha_properties_raw_master.csv")

PROPERTY_COLUMNS = [
    "pin",
    "property_a",
    "house",
    "street_dir",
    "street_nam",
    "street_typ",
    "apartment",
    "prop_city",
    "prop_zip",
    "land_value",
    "improvemen",
    "total_valu",
    "class",
    "school_dis",
    "numbldgs",
    "bldg_numb",
    "bldg_sf",
    "bldg_story",
    "bldg_yrblt",
    "bldg_desc",
    "quality",
    "condition",
    "acres",
    "sq_feet",
    "centroid_latitude",
    "centroid_longitude",
]

KEYWORD_MAP = {
    "gutter": ["gutter", "downspout"],
    "decking": ["decking", "osb", "plywood", "sheathing"],
    "garage": ["garage"],
    "insurance": ["insurance"],
    "impact_shingle": ["class 3", "class 4", "impact"],
    "metal": ["metal"],
    "flat_roof": ["tpo", "epdm", "flat roof", "low slope"],
    "ventilation": ["vent", "ridge vent"],
    "skylight": ["skylight"],
}

COHORT_PROFILE_NOTES = {
    "residential_roofing_v1": (
        "Matched permit rows with positive declared value, Issued/Closed status, residential property class, "
        "non-null building sqft and total value, and at most one building."
    ),
    "broad_permit_modeling": (
        "Matched permit rows with positive declared value, Issued/Closed status, and non-null building sqft "
        "and total value across all permit types and property classes."
    ),
}


def normalize_address(value: str | None) -> str | None:
    if value is None or pd.isna(value):
        return None
    head = str(value).split(",")[0]
    normalized = " ".join(head.upper().replace(".", " ").split())
    return normalized or None


def to_float(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def count_values(frame: pd.DataFrame, column: str) -> dict[str, int]:
    if column not in frame.columns:
        return {}
    cleaned = frame[column].fillna("Unknown").astype(str).str.strip().replace("", "Unknown")
    return {str(key): int(value) for key, value in cleaned.value_counts().to_dict().items()}


def profile_property_source(source_path: Path) -> dict[str, object]:
    with source_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
    return {
        "source_path": str(source_path),
        "source_size_bytes": source_path.stat().st_size,
        "column_count": len(header),
        "columns": header,
    }


def build_property_subset(
    source_path: Path,
    permit_pins: set[str],
    permit_address_keys: set[str],
    output_csv: Path,
) -> tuple[pd.DataFrame, dict[str, object]]:
    chunks: list[pd.DataFrame] = []
    total_rows = 0
    matched_rows = 0
    for chunk in pd.read_csv(
        source_path,
        dtype=str,
        usecols=PROPERTY_COLUMNS,
        chunksize=50_000,
        encoding="utf-8-sig",
    ):
        total_rows += len(chunk)
        chunk["property_address_key"] = chunk["property_a"].map(normalize_address)
        filtered = chunk[
            chunk["pin"].isin(permit_pins) | chunk["property_address_key"].isin(permit_address_keys)
        ].copy()
        if not filtered.empty:
            matched_rows += len(filtered)
            chunks.append(filtered)

    subset = pd.concat(chunks, ignore_index=True).drop_duplicates(subset=["pin"]) if chunks else pd.DataFrame(columns=PROPERTY_COLUMNS)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    subset.to_csv(output_csv, index=False)
    return subset, {
        "total_rows_scanned": total_rows,
        "matched_rows": matched_rows,
        "matched_unique_pins": int(subset["pin"].nunique()) if not subset.empty else 0,
        "output_csv": str(output_csv),
    }


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["record_date"] = pd.to_datetime(df["record_date"], errors="coerce")
    df["job_value"] = pd.to_numeric(df["job_value"], errors="coerce")
    df["number_of_buildings"] = pd.to_numeric(df["number_of_buildings"], errors="coerce")
    for column in [
        "land_value",
        "improvemen",
        "total_valu",
        "bldg_sf",
        "bldg_story",
        "bldg_yrblt",
        "acres",
        "sq_feet",
        "centroid_latitude",
        "centroid_longitude",
    ]:
        df[column] = to_float(df[column])

    df["property_age"] = df["record_date"].dt.year - df["bldg_yrblt"]
    df["property_age"] = df["property_age"].where(df["property_age"] >= 0)
    df["description_full"] = (
        df["description"].fillna("")
        + " "
        + df["short_note"].fillna("")
        + " "
        + df["construction_type_codes"].fillna("")
    ).str.strip()
    df["description_length"] = df["description_full"].str.len()
    df["job_value_per_bldg_sf"] = df["job_value"] / df["bldg_sf"]
    df["job_value_per_total_value"] = df["job_value"] / df["total_valu"]
    df["permit_month"] = df["record_date"].dt.to_period("M").astype(str)
    df["licensed_company_name"] = df["licensed_company_name"].fillna("Unknown")
    df["roof_covering_material"] = df["roof_covering_material"].fillna("Unknown")
    df["quality"] = df["quality"].fillna("Unknown")
    df["condition"] = df["condition"].fillna("Unknown")
    df["prop_zip"] = df["prop_zip"].fillna("Unknown")
    if "permit_prefix" not in df.columns:
        df["permit_prefix"] = df["record_number"].fillna("").astype(str).str.split("-").str[0].replace("", "Unknown")
    df["permit_prefix"] = df["permit_prefix"].fillna("Unknown")
    if "permit_type" not in df.columns:
        df["permit_type"] = "Unknown"
    df["permit_type"] = df["permit_type"].fillna("Unknown")
    if "category" not in df.columns:
        df["category"] = df["permit_type"]
    df["category"] = df["category"].fillna(df["permit_type"]).fillna("Unknown")
    df["class"] = df["class"].fillna("Unknown")
    if "construction_type_codes" not in df.columns:
        df["construction_type_codes"] = "Unknown"
    df["construction_type_codes"] = df["construction_type_codes"].fillna("Unknown")

    text_series = df["description_full"].str.lower().fillna("")
    for key, phrases in KEYWORD_MAP.items():
        df[f"kw_{key}"] = text_series.apply(lambda text, phrases=phrases: int(any(phrase in text for phrase in phrases)))

    return df


def build_cohort(joined: pd.DataFrame, cohort_profile: str) -> pd.DataFrame:
    if cohort_profile not in COHORT_PROFILE_NOTES:
        raise ValueError(f"Unsupported cohort profile: {cohort_profile}")

    base_mask = (
        (joined["_merge"] == "both")
        & (joined["job_value"].fillna(0) > 0)
        & (joined["status"].fillna("").isin(["Issued", "Closed"]))
        & (joined["bldg_sf"].notna())
        & (joined["total_valu"].notna())
    )
    if cohort_profile == "residential_roofing_v1":
        base_mask &= (joined["class"].fillna("") == "R") & (
            joined["number_of_buildings"].isna() | (joined["number_of_buildings"] <= 1)
        )

    cohort = joined[base_mask].copy()
    cohort = cohort.sort_values(["record_date", "record_number"]).reset_index(drop=True)
    return cohort


def summarize_targets(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    targets = {
        "job_value": "Raw declared permit job value in dollars.",
        "log_job_value": "log1p-transformed job value for more stable regression.",
        "job_value_per_bldg_sf": "Declared value normalized by assessed building square footage.",
        "job_value_per_total_value": "Declared value normalized by county assessed total value.",
    }
    working = df.copy()
    working["log_job_value"] = np.log1p(working["job_value"])
    for column, note in targets.items():
        series = pd.to_numeric(working[column], errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
        rows.append(
            {
                "target": column,
                "count": int(series.shape[0]),
                "mean": float(series.mean()),
                "median": float(series.median()),
                "p10": float(series.quantile(0.10)),
                "p90": float(series.quantile(0.90)),
                "std": float(series.std()),
                "notes": note,
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Join permit and property data for modeling.")
    parser.add_argument("--permit-csv", type=Path, required=True)
    parser.add_argument("--property-source", type=Path, default=DEFAULT_PROPERTY_SOURCE)
    parser.add_argument(
        "--cohort-profile",
        default="residential_roofing_v1",
        choices=sorted(COHORT_PROFILE_NOTES),
        help="Filter profile used to define the modeled cohort from the joined permit/property rows.",
    )
    parser.add_argument("--property-subset-csv", type=Path)
    parser.add_argument("--joined-output-csv", type=Path)
    parser.add_argument("--cohort-output-csv", type=Path)
    parser.add_argument("--join-summary-json", type=Path)
    parser.add_argument("--property-profile-json", type=Path)
    parser.add_argument("--target-summary-csv", type=Path)
    parser.add_argument("--company-summary-csv", type=Path)
    args = parser.parse_args()

    permit_csv = args.permit_csv
    property_source = args.property_source
    stub = permit_csv.stem
    property_subset_csv = args.property_subset_csv or (RAW_PROPERTIES_DIR / f"{stub}_property_subset.csv")
    joined_output_csv = args.joined_output_csv or (PROCESSED_DIR / f"{stub}_joined.csv")
    cohort_output_csv = args.cohort_output_csv or (PROCESSED_DIR / f"{stub}_cohort.csv")
    join_summary_json = args.join_summary_json or (PROCESSED_DIR / f"{stub}_join_summary.json")
    property_profile_json = args.property_profile_json or (RAW_PROPERTIES_DIR / f"{stub}_property_profile.json")
    target_summary_csv = args.target_summary_csv or (PROCESSED_DIR / f"{stub}_target_summary.csv")
    company_summary_csv = args.company_summary_csv or (PROCESSED_DIR / f"{stub}_company_summary.csv")

    permits = pd.read_csv(permit_csv, dtype=str)
    permits["address_key"] = permits["permit_address"].fillna(permits["address"]).map(normalize_address)
    permit_pins = {pin for pin in permits["parcel_number"].dropna().astype(str).tolist() if pin and pin != "nan"}
    permit_address_keys = {
        address_key for address_key in permits["address_key"].dropna().astype(str).tolist() if address_key and address_key != "nan"
    }

    profile = profile_property_source(property_source)
    property_subset, subset_stats = build_property_subset(property_source, permit_pins, permit_address_keys, property_subset_csv)
    profile.update(subset_stats)
    property_profile_json.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    pin_join = permits.merge(property_subset, left_on="parcel_number", right_on="pin", how="left", suffixes=("", "_pin"))
    address_lookup = property_subset.drop_duplicates(subset=["property_address_key"]).rename(
        columns={column: f"{column}_addr" for column in property_subset.columns if column != "property_address_key"}
    )
    address_join = permits.merge(address_lookup, left_on="address_key", right_on="property_address_key", how="left")

    joined = pin_join.copy()
    property_columns = [column for column in property_subset.columns if column != "property_address_key"]
    for column in property_columns:
        addr_column = f"{column}_addr"
        if addr_column in address_join.columns:
            joined[column] = joined[column].fillna(address_join[addr_column])
    joined["property_address_key"] = joined["property_address_key"].fillna(address_join["property_address_key"])
    joined["join_method"] = np.where(
        joined["pin"].notna(),
        "pin",
        np.where(address_join.get("pin_addr", pd.Series(index=joined.index)).notna(), "address", "unmatched"),
    )
    joined["_merge"] = np.where(joined["join_method"] == "unmatched", "left_only", "both")
    joined = engineer_features(joined)
    joined_output_csv.parent.mkdir(parents=True, exist_ok=True)
    joined.to_csv(joined_output_csv, index=False)

    cohort = build_cohort(joined, args.cohort_profile)
    cohort.to_csv(cohort_output_csv, index=False)

    permits_with_job_value = permits.loc[pd.to_numeric(permits["job_value"], errors="coerce").notna()].copy()

    join_summary = {
        "permit_rows": int(len(permits)),
        "cohort_profile": args.cohort_profile,
        "cohort_profile_note": COHORT_PROFILE_NOTES[args.cohort_profile],
        "permit_rows_with_job_value": int(len(permits_with_job_value)),
        "permit_rows_with_parcel_number": int(permits["parcel_number"].notna().sum()),
        "permit_rows_with_address_key": int(permits["address_key"].notna().sum()),
        "permit_rows_by_permit_type": count_values(permits, "permit_type"),
        "permit_rows_with_job_value_by_permit_type": count_values(permits_with_job_value, "permit_type"),
        "permit_rows_by_category": count_values(permits, "category"),
        "property_subset_rows": int(len(property_subset)),
        "joined_rows": int(len(joined)),
        "matched_rows": int((joined["_merge"] == "both").sum()),
        "match_rate": float((joined["_merge"] == "both").mean()) if len(joined) else 0.0,
        "pin_matches": int((joined["join_method"] == "pin").sum()),
        "address_matches": int((joined["join_method"] == "address").sum()),
        "cohort_rows": int(len(cohort)),
        "cohort_rows_by_permit_type": count_values(cohort, "permit_type"),
        "cohort_rows_by_category": count_values(cohort, "category"),
        "cohort_rows_by_class": count_values(cohort, "class"),
        "cohort_start_date": cohort["record_date"].min().strftime("%Y-%m-%d") if len(cohort) else None,
        "cohort_end_date": cohort["record_date"].max().strftime("%Y-%m-%d") if len(cohort) else None,
        "median_job_value": float(cohort["job_value"].median()) if len(cohort) else None,
        "median_job_value_per_bldg_sf": float(cohort["job_value_per_bldg_sf"].median()) if len(cohort) else None,
    }
    join_summary_json.write_text(json.dumps(join_summary, indent=2), encoding="utf-8")

    target_summary = summarize_targets(cohort)
    target_summary.to_csv(target_summary_csv, index=False)

    company_summary = (
        cohort.groupby("licensed_company_name", dropna=False)
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

    print(f"[prepare] wrote {property_subset_csv}")
    print(f"[prepare] wrote {joined_output_csv}")
    print(f"[prepare] wrote {cohort_output_csv}")
    print(f"[prepare] wrote {join_summary_json}")
    print(f"[prepare] cohort rows={len(cohort)} match_rate={join_summary['match_rate']:.3f}")


if __name__ == "__main__":
    main()
