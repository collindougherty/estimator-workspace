#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd

from prepare_dataset import PROPERTY_COLUMNS, profile_property_source

MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_OUTPUT_DIR = MODEL_ROOT / "data" / "raw" / "properties" / "sarpy_county"
PROCESSED_OUTPUT_DIR = MODEL_ROOT / "data" / "processed" / "sarpy_county"
DOUGLAS_DEFAULT_SOURCE = Path("/Users/collindougherty/MyCloud/properties/omaha_properties_raw_master.csv")
SARPY_DEFAULT_SOURCE = Path("/Users/collindougherty/MyCloud/properties/sarpy_properties_raw_master.csv")
DEFAULT_PERMIT_CSV = MODEL_ROOT / "data" / "raw" / "roofing" / "residential_reroof_2025-11-01_2026-04-14.csv"

RAW_SARPY_COLUMNS = [
    "parcelid",
    "cvttxdscrp",
    "schldscrp",
    "usedscrp",
    "classcd",
    "classdscrp",
    "siteaddress",
    "prprtydscrp",
    "pstlcity",
    "pstlzip5",
    "resflrarea",
    "resyrblt",
    "resstrtyp",
    "lndvalue",
    "cntassdval",
    "acreage",
    "lowparcelid",
    "building",
    "unit",
    "impvalue",
    "centroid_latitude",
    "centroid_longitude",
]

CANONICAL_MAPPING = {
    "pin": {"sarpy_source_columns": "parcelid", "sarpy_transform": "Direct rename of Sarpy parcel ID."},
    "property_a": {
        "sarpy_source_columns": "siteaddress",
        "sarpy_transform": "Parsed street-address portion before city/state/zip suffix.",
    },
    "house": {"sarpy_source_columns": "siteaddress", "sarpy_transform": "First street token when it looks like a house number."},
    "street_dir": {"sarpy_source_columns": "siteaddress", "sarpy_transform": "Derived from parsed street tokens when a directional is present."},
    "street_nam": {"sarpy_source_columns": "siteaddress", "sarpy_transform": "Derived from parsed street tokens."},
    "street_typ": {"sarpy_source_columns": "siteaddress", "sarpy_transform": "Derived from parsed street suffix when recognizable."},
    "apartment": {"sarpy_source_columns": "unit", "sarpy_transform": "Uses Sarpy unit field when present; otherwise blank."},
    "prop_city": {
        "sarpy_source_columns": "siteaddress,pstlcity",
        "sarpy_transform": "City parsed from siteaddress with postal city fallback.",
    },
    "prop_zip": {
        "sarpy_source_columns": "siteaddress,pstlzip5",
        "sarpy_transform": "ZIP parsed from siteaddress with postal ZIP fallback.",
    },
    "land_value": {"sarpy_source_columns": "lndvalue", "sarpy_transform": "Direct rename of Sarpy land value."},
    "improvemen": {"sarpy_source_columns": "impvalue", "sarpy_transform": "Direct rename of Sarpy improvement value."},
    "total_valu": {"sarpy_source_columns": "cntassdval", "sarpy_transform": "Direct rename of county assessed value."},
    "class": {
        "sarpy_source_columns": "classdscrp,usedscrp",
        "sarpy_transform": "Derived binary cohort flag: R when description contains RESIDENTIAL, else NONR.",
    },
    "school_dis": {"sarpy_source_columns": "schldscrp", "sarpy_transform": "Uses school district description text."},
    "numbldgs": {
        "sarpy_source_columns": "",
        "sarpy_transform": "Not present in Sarpy raw source; left blank to avoid inventing building counts.",
    },
    "bldg_numb": {"sarpy_source_columns": "building", "sarpy_transform": "Uses Sarpy building code when present."},
    "bldg_sf": {"sarpy_source_columns": "resflrarea", "sarpy_transform": "Direct rename of residential floor area."},
    "bldg_story": {
        "sarpy_source_columns": "resstrtyp",
        "sarpy_transform": "Numeric values retained; non-numeric structure-type codes left blank.",
    },
    "bldg_yrblt": {
        "sarpy_source_columns": "resyrblt",
        "sarpy_transform": "Direct rename after dropping zero/blank years.",
    },
    "bldg_desc": {
        "sarpy_source_columns": "usedscrp,classdscrp,prprtydscrp",
        "sarpy_transform": "Uses use/class description text; legal description retained in extra Sarpy columns.",
    },
    "quality": {"sarpy_source_columns": "", "sarpy_transform": "Unavailable in Sarpy raw source; left blank."},
    "condition": {"sarpy_source_columns": "", "sarpy_transform": "Unavailable in Sarpy raw source; left blank."},
    "acres": {"sarpy_source_columns": "acreage", "sarpy_transform": "Direct rename of acreage."},
    "sq_feet": {
        "sarpy_source_columns": "acreage",
        "sarpy_transform": "Derived as acreage * 43,560 because Sarpy source has no lot square-foot column.",
    },
    "centroid_latitude": {"sarpy_source_columns": "centroid_latitude", "sarpy_transform": "Direct rename."},
    "centroid_longitude": {"sarpy_source_columns": "centroid_longitude", "sarpy_transform": "Direct rename."},
}

DIRECTIONALS = {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}
STREET_TYPES = {
    "ALY",
    "AVE",
    "BLVD",
    "CIR",
    "CT",
    "CV",
    "DR",
    "EXPY",
    "HWY",
    "LN",
    "LP",
    "PATH",
    "PKWY",
    "PL",
    "PLZ",
    "RD",
    "RUN",
    "SQ",
    "ST",
    "TER",
    "TRL",
    "VIEW",
    "WAY",
}
ADDRESS_SUFFIX_RE = re.compile(r"^(?P<street>.+?)\s+(?P<city>[A-Z]+(?:\s+[A-Z]+)*)\s+NE\s+(?P<zip>\d{5})(?:-\d{4})?$")
UNIT_RE = re.compile(r"^(?P<street>.*?)(?:\s+(?:APT|UNIT|STE|#)\s*(?P<unit>[A-Z0-9-]+))$", re.IGNORECASE)


def non_blank_mask(series: pd.Series) -> pd.Series:
    return series.notna() & series.astype(str).str.strip().ne("")


def clean_text(value: object) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def truncate_example(value: object, limit: int = 160) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    return text if len(text) <= limit else f"{text[:limit]}..."


def parse_siteaddress_parts(siteaddress: object, pstlcity: object, pstlzip5: object) -> tuple[str | None, str | None, str | None, bool]:
    raw_text = None if siteaddress is None or pd.isna(siteaddress) else str(siteaddress).strip()
    if raw_text:
        parts = [clean_text(part) for part in re.split(r"\s{2,}", raw_text) if clean_text(part)]
        if len(parts) >= 2:
            street = parts[0]
            locality = " ".join(parts[1:])
            locality_match = re.match(r"^(?P<city>.+?)\s+NE\s+(?P<zip>\d{5})(?:-\d{4})?$", locality)
            if locality_match:
                return street, clean_text(locality_match.group("city")), clean_text(locality_match.group("zip")), True

    text = clean_text(siteaddress)
    city = clean_text(pstlcity)
    zip5 = clean_text(pstlzip5)
    if not text:
        return None, city, zip5, False
    if city and zip5:
        suffix = f"{city} NE {zip5}"
        if text.endswith(suffix):
            street = text[: -len(suffix)].strip(" ,")
            return street or None, city, zip5, True
    match = ADDRESS_SUFFIX_RE.match(text)
    if match:
        return clean_text(match.group("street")), clean_text(match.group("city")), clean_text(match.group("zip")), True
    return text, city, zip5, False


def split_street_address(street: object, unit_value: object) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    street_text = clean_text(street)
    apartment = clean_text(unit_value)
    if not street_text:
        return None, None, None, None, apartment

    unit_match = UNIT_RE.match(street_text)
    if unit_match and not apartment:
        street_text = clean_text(unit_match.group("street"))
        apartment = clean_text(unit_match.group("unit"))

    tokens = street_text.split()
    house = tokens[0] if tokens and re.match(r"^\d+[A-Z0-9-]*$", tokens[0]) else None
    remainder = tokens[1:] if house else tokens[:]

    street_dir = remainder[0] if remainder and remainder[0] in DIRECTIONALS else None
    if street_dir:
        remainder = remainder[1:]

    street_typ = remainder[-1] if remainder and remainder[-1] in STREET_TYPES else None
    if street_typ:
        remainder = remainder[:-1]

    street_name = " ".join(remainder).strip() or None
    return house, street_dir, street_name, street_typ, apartment


def derive_class(classdscrp: object, usedscrp: object) -> str | None:
    text = " ".join(part for part in [clean_text(classdscrp), clean_text(usedscrp)] if part).upper()
    if not text:
        return None
    return "R" if "RESIDENTIAL" in text else "NONR"


def summarize_raw_columns(source_path: Path) -> tuple[pd.DataFrame, int]:
    counts: dict[str, int] | None = None
    examples: dict[str, str | None] | None = None
    total_rows = 0
    for chunk in pd.read_csv(source_path, dtype=str, chunksize=10_000, encoding="utf-8-sig"):
        if counts is None or examples is None:
            counts = {column: 0 for column in chunk.columns}
            examples = {column: None for column in chunk.columns}
        total_rows += len(chunk)
        for column in chunk.columns:
            mask = non_blank_mask(chunk[column])
            counts[column] += int(mask.sum())
            if examples[column] is None and mask.any():
                examples[column] = truncate_example(chunk.loc[mask, column].iloc[0])
    if counts is None or examples is None:
        return pd.DataFrame(columns=["column", "non_null_count", "non_null_rate", "example_value"]), 0
    rows = [
        {
            "column": column,
            "non_null_count": counts[column],
            "non_null_rate": counts[column] / total_rows if total_rows else 0.0,
            "example_value": examples[column],
        }
        for column in counts
    ]
    return pd.DataFrame(rows), total_rows


def summarize_non_null_from_source(source_path: Path, columns: list[str]) -> tuple[int, dict[str, dict[str, float]]]:
    counts = {column: 0 for column in columns}
    total_rows = 0
    for chunk in pd.read_csv(source_path, dtype=str, usecols=columns, chunksize=50_000, encoding="utf-8-sig"):
        total_rows += len(chunk)
        for column in columns:
            counts[column] += int(non_blank_mask(chunk[column]).sum())
    summary = {
        column: {
            "non_null_count": counts[column],
            "non_null_rate": counts[column] / total_rows if total_rows else 0.0,
        }
        for column in columns
    }
    return total_rows, summary


def summarize_non_null_from_frame(frame: pd.DataFrame, columns: list[str]) -> dict[str, dict[str, float]]:
    total_rows = len(frame)
    return {
        column: {
            "non_null_count": int(non_blank_mask(frame[column]).sum()),
            "non_null_rate": float(non_blank_mask(frame[column]).mean()) if total_rows else 0.0,
        }
        for column in columns
    }


def normalize_addresses(series: pd.Series) -> pd.Series:
    return (
        series.fillna("")
        .astype(str)
        .str.upper()
        .str.replace(r",", " ", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )


def build_permit_overlap_summary(permit_csv: Path, staged: pd.DataFrame) -> dict[str, object]:
    permits = pd.read_csv(permit_csv, dtype=str)
    permit_pins = {value for value in permits["parcel_number"].fillna("").astype(str).str.strip().tolist() if value and value != "nan"}
    sarpy_pins = {value for value in staged["pin"].fillna("").astype(str).str.strip().tolist() if value and value != "nan"}
    sarpy_low_pins = {
        value for value in staged["sarpy_lowparcelid"].fillna("").astype(str).str.strip().tolist() if value and value != "nan"
    }

    permit_addresses = set(normalize_addresses(permits["permit_address"])) - {""}
    sarpy_full_addresses = set(normalize_addresses(staged["sarpy_raw_siteaddress"])) - {""}
    full_matches = sorted(permit_addresses & sarpy_full_addresses)

    return {
        "permit_csv": str(permit_csv),
        "permit_rows": int(len(permits)),
        "permit_rows_with_parcel_number": int(permits["parcel_number"].notna().sum()),
        "permit_unique_parcel_numbers": int(len(permit_pins)),
        "sarpy_unique_parcelid": int(len(sarpy_pins)),
        "sarpy_unique_lowparcelid": int(len(sarpy_low_pins)),
        "parcelid_matches": int(len(permit_pins & sarpy_pins)),
        "lowparcelid_matches": int(len(permit_pins & sarpy_low_pins)),
        "normalized_full_address_matches": int(len(full_matches)),
        "normalized_full_address_match_examples": full_matches[:10],
    }


def build_staged_frame(source_path: Path) -> tuple[pd.DataFrame, dict[str, object]]:
    sarpy = pd.read_csv(source_path, dtype=str, usecols=RAW_SARPY_COLUMNS, encoding="utf-8-sig")

    parsed = sarpy.apply(
        lambda row: parse_siteaddress_parts(row["siteaddress"], row["pstlcity"], row["pstlzip5"]),
        axis=1,
        result_type="expand",
    )
    parsed.columns = ["street_address", "prop_city", "prop_zip", "address_parse_success"]

    street_parts = pd.DataFrame(
        parsed.apply(
            lambda row: split_street_address(row["street_address"], sarpy.loc[row.name, "unit"]),
            axis=1,
        ).tolist(),
        columns=["house", "street_dir", "street_nam", "street_typ", "apartment"],
        index=sarpy.index,
    )

    acreage = pd.to_numeric(sarpy["acreage"], errors="coerce")
    sq_feet = (acreage * 43_560).round(2)
    bldg_story = pd.to_numeric(sarpy["resstrtyp"], errors="coerce")
    bldg_story = bldg_story.where(bldg_story > 0)
    bldg_yrblt = pd.to_numeric(sarpy["resyrblt"], errors="coerce")
    bldg_yrblt = bldg_yrblt.where(bldg_yrblt > 0)

    staged = pd.DataFrame(
        {
            "pin": sarpy["parcelid"],
            "property_a": parsed["street_address"],
            "house": street_parts["house"],
            "street_dir": street_parts["street_dir"],
            "street_nam": street_parts["street_nam"],
            "street_typ": street_parts["street_typ"],
            "apartment": street_parts["apartment"],
            "prop_city": parsed["prop_city"],
            "prop_zip": parsed["prop_zip"],
            "land_value": pd.to_numeric(sarpy["lndvalue"], errors="coerce"),
            "improvemen": pd.to_numeric(sarpy["impvalue"], errors="coerce"),
            "total_valu": pd.to_numeric(sarpy["cntassdval"], errors="coerce"),
            "class": sarpy.apply(lambda row: derive_class(row["classdscrp"], row["usedscrp"]), axis=1),
            "school_dis": sarpy["schldscrp"],
            "numbldgs": pd.NA,
            "bldg_numb": sarpy["building"],
            "bldg_sf": pd.to_numeric(sarpy["resflrarea"], errors="coerce"),
            "bldg_story": bldg_story,
            "bldg_yrblt": bldg_yrblt,
            "bldg_desc": sarpy["usedscrp"].fillna(sarpy["classdscrp"]).fillna(sarpy["prprtydscrp"]),
            "quality": pd.NA,
            "condition": pd.NA,
            "acres": acreage,
            "sq_feet": sq_feet,
            "centroid_latitude": pd.to_numeric(sarpy["centroid_latitude"], errors="coerce"),
            "centroid_longitude": pd.to_numeric(sarpy["centroid_longitude"], errors="coerce"),
            "source_county": "sarpy",
            "sarpy_classcd": sarpy["classcd"],
            "sarpy_classdscrp": sarpy["classdscrp"],
            "sarpy_usedscrp": sarpy["usedscrp"],
            "sarpy_cvttxdscrp": sarpy["cvttxdscrp"],
            "sarpy_raw_siteaddress": sarpy["siteaddress"],
            "sarpy_property_description": sarpy["prprtydscrp"],
            "sarpy_resstrtyp": sarpy["resstrtyp"],
            "sarpy_lowparcelid": sarpy["lowparcelid"],
            "sarpy_address_parse_success": parsed["address_parse_success"].astype(int),
        }
    )

    profile = {
        "staged_rows": int(len(staged)),
        "residential_rows": int((staged["class"] == "R").sum()),
        "residential_rate": float((staged["class"] == "R").mean()),
        "address_parse_success_rate": float(staged["sarpy_address_parse_success"].mean()),
        "bldg_story_non_null_rate": float(non_blank_mask(staged["bldg_story"]).mean()),
        "top_prop_cities": staged["prop_city"].fillna("Unknown").value_counts().head(10).to_dict(),
        "top_sarpy_classdscrp": staged["sarpy_classdscrp"].fillna("Unknown").value_counts().head(10).to_dict(),
    }
    return staged, profile


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage Sarpy County property data into the modeling canonical schema.")
    parser.add_argument("--sarpy-source", type=Path, default=SARPY_DEFAULT_SOURCE)
    parser.add_argument("--douglas-source", type=Path, default=DOUGLAS_DEFAULT_SOURCE)
    parser.add_argument("--permit-csv", type=Path, default=DEFAULT_PERMIT_CSV)
    parser.add_argument("--output-csv", type=Path, default=RAW_OUTPUT_DIR / "sarpy_properties_model_ready.csv")
    parser.add_argument("--profile-json", type=Path, default=RAW_OUTPUT_DIR / "sarpy_properties_profile.json")
    parser.add_argument("--raw-column-profile-csv", type=Path, default=RAW_OUTPUT_DIR / "sarpy_raw_column_profile.csv")
    parser.add_argument(
        "--canonical-comparison-csv",
        type=Path,
        default=RAW_OUTPUT_DIR / "sarpy_vs_douglas_canonical_comparison.csv",
    )
    parser.add_argument(
        "--permit-overlap-summary-json",
        type=Path,
        default=PROCESSED_OUTPUT_DIR / "sarpy_current_permit_overlap_summary.json",
    )
    args = parser.parse_args()

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    args.profile_json.parent.mkdir(parents=True, exist_ok=True)
    args.raw_column_profile_csv.parent.mkdir(parents=True, exist_ok=True)
    args.canonical_comparison_csv.parent.mkdir(parents=True, exist_ok=True)
    args.permit_overlap_summary_json.parent.mkdir(parents=True, exist_ok=True)

    raw_column_profile, sarpy_total_rows = summarize_raw_columns(args.sarpy_source)
    raw_column_profile.to_csv(args.raw_column_profile_csv, index=False)

    staged, staged_profile = build_staged_frame(args.sarpy_source)
    staged.to_csv(args.output_csv, index=False)

    sarpy_profile = profile_property_source(args.sarpy_source)
    sarpy_profile.update(staged_profile)
    sarpy_profile.update(
        {
            "row_count": sarpy_total_rows,
            "output_csv": str(args.output_csv),
            "raw_column_profile_csv": str(args.raw_column_profile_csv),
            "canonical_comparison_csv": str(args.canonical_comparison_csv),
            "permit_overlap_summary_json": str(args.permit_overlap_summary_json),
        }
    )

    _, douglas_non_null = summarize_non_null_from_source(args.douglas_source, PROPERTY_COLUMNS)
    sarpy_non_null = summarize_non_null_from_frame(staged, PROPERTY_COLUMNS)
    comparison_rows = []
    for column in PROPERTY_COLUMNS:
        comparison_rows.append(
            {
                "canonical_column": column,
                "douglas_source_column": column,
                "douglas_non_null_count": douglas_non_null[column]["non_null_count"],
                "douglas_non_null_rate": douglas_non_null[column]["non_null_rate"],
                "sarpy_source_columns": CANONICAL_MAPPING[column]["sarpy_source_columns"],
                "sarpy_transform": CANONICAL_MAPPING[column]["sarpy_transform"],
                "sarpy_non_null_count": sarpy_non_null[column]["non_null_count"],
                "sarpy_non_null_rate": sarpy_non_null[column]["non_null_rate"],
            }
        )
    pd.DataFrame(comparison_rows).to_csv(args.canonical_comparison_csv, index=False)

    overlap_summary = build_permit_overlap_summary(args.permit_csv, staged)
    args.permit_overlap_summary_json.write_text(json.dumps(overlap_summary, indent=2), encoding="utf-8")

    args.profile_json.write_text(json.dumps(sarpy_profile, indent=2), encoding="utf-8")

    print(f"[sarpy-stage] wrote {args.output_csv}")
    print(f"[sarpy-stage] wrote {args.profile_json}")
    print(f"[sarpy-stage] wrote {args.raw_column_profile_csv}")
    print(f"[sarpy-stage] wrote {args.canonical_comparison_csv}")
    print(f"[sarpy-stage] residential_rows={staged_profile['residential_rows']} address_parse_success={staged_profile['address_parse_success_rate']:.3f}")


if __name__ == "__main__":
    main()
