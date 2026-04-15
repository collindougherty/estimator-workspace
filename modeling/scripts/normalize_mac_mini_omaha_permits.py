#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd

MODEL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = MODEL_ROOT / "data" / "raw" / "permits" / "mac-mini-roofing"
DEFAULT_OUTPUT_CSV = MODEL_ROOT / "data" / "raw" / "permits" / "omaha_multitrade_2025-11-01_2026-04-14.csv"

RECORD_PATTERN = re.compile(r"^[A-Z0-9]{2,6}-\d{2}-\d{3,6}$")
DATE_PATTERN = re.compile(r"^\d{2}/\d{2}/\d{4}$")
JOB_VALUE_PATTERN = re.compile(r"\$([0-9,]+(?:\.[0-9]+)?)")
BUILDINGS_PATTERN = re.compile(r"Number of Buildings:\s*([0-9]+(?:\.[0-9]+)?)", flags=re.I)
CONSTRUCTION_PATTERN = re.compile(r"Construction Type Codes:\s*(.+)", flags=re.I | re.S)


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def parse_job_value(raw_value: str | None) -> float | None:
    if not raw_value:
        return None
    match = JOB_VALUE_PATTERN.search(raw_value)
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def parse_number_of_buildings(raw_value: str | None) -> float | None:
    if not raw_value:
        return None
    match = BUILDINGS_PATTERN.search(raw_value)
    if not match:
        return None
    return float(match.group(1))


def parse_construction_type_codes(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    match = CONSTRUCTION_PATTERN.search(raw_value)
    if not match:
        return None
    return clean_text(match.group(1))


def normalize_record(raw_row: dict[str, object], source_file: Path) -> dict[str, object] | None:
    raw_date = clean_text(raw_row.get("1"))
    record_number = clean_text(raw_row.get("2"))
    if not raw_date or not DATE_PATTERN.match(raw_date):
        return None
    if not record_number or not RECORD_PATTERN.match(record_number):
        return None

    permit_type = clean_text(raw_row.get("3"))
    address = clean_text(raw_row.get("4"))
    status = clean_text(raw_row.get("5"))
    description = clean_text(raw_row.get("6"))
    note_status = clean_text(raw_row.get("7"))
    row_badge = clean_text(raw_row.get("8"))
    short_note = clean_text(raw_row.get("9"))
    permit_address = clean_text(raw_row.get("10")) or address
    owner_name = clean_text(raw_row.get("Owner"))
    valuation_raw = clean_text(raw_row.get("Valuation"))

    record_date = pd.to_datetime(raw_date, format="%m/%d/%Y", errors="coerce")
    if pd.isna(record_date):
        return None

    return {
        "category": permit_type,
        "record_number": record_number,
        "record_date": record_date.date().isoformat(),
        "permit_type": permit_type,
        "permit_prefix": record_number.split("-", 1)[0],
        "address": address,
        "status": status,
        "description": description or short_note,
        "short_note": short_note,
        "permit_address": permit_address,
        "detail_url": None,
        "job_value": parse_job_value(valuation_raw),
        "job_value_raw": valuation_raw,
        "parcel_number": None,
        "roof_covering_material": None,
        "number_of_buildings": parse_number_of_buildings(valuation_raw),
        "construction_type_codes": parse_construction_type_codes(valuation_raw),
        "owner_name": owner_name,
        "licensed_professional_name": None,
        "licensed_company_name": None,
        "licensed_professional_raw": None,
        "fetch_error": None,
        "source_file": source_file.name,
        "source_path": str(source_file),
        "source_system": "mac-mini-omaha-permits",
        "note_status": note_status,
        "row_badge": row_badge,
        **{f"raw_col_{index}": clean_text(raw_row.get(str(index))) for index in range(0, 19)},
    }
def load_rows(input_dir: Path) -> list[dict[str, object]]:
    candidate_paths = sorted(input_dir.glob("historical_data/omaha_permits_*.json"))
    candidate_paths.extend(
        [
            input_dir / "omaha_permits_april_2026.json",
            input_dir / "omaha_permits_04-06-2026.json",
        ]
    )
    rows: list[dict[str, object]] = []
    for path in candidate_paths:
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            continue
        for raw_row in payload:
            if not isinstance(raw_row, dict):
                continue
            normalized = normalize_record(raw_row, path)
            if normalized is not None:
                rows.append(normalized)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize the mac-mini Omaha permit JSON snapshots into a canonical permit CSV.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV)
    parser.add_argument("--start-date", default="2025-11-01")
    parser.add_argument("--end-date", default="2026-04-14")
    args = parser.parse_args()

    rows = load_rows(args.input_dir)
    if not rows:
        raise RuntimeError(f"No permit rows found under {args.input_dir}")

    frame = pd.DataFrame(rows)
    frame["record_date"] = pd.to_datetime(frame["record_date"], errors="coerce")
    start_date = pd.Timestamp(args.start_date)
    end_date = pd.Timestamp(args.end_date)
    frame = frame.loc[(frame["record_date"] >= start_date) & (frame["record_date"] <= end_date)].copy()
    if frame.empty:
        raise RuntimeError("No rows remained after filtering to the requested date range.")

    frame["_job_value_missing"] = frame["job_value"].isna().astype(int)
    frame["_owner_missing"] = (
        frame["owner_name"].fillna("").astype(str).str.strip().isin(["", "N/A", "Not Hyperlinked"]).astype(int)
    )
    frame["_construction_missing"] = frame["construction_type_codes"].isna().astype(int)
    frame = frame.sort_values(
        ["record_number", "_job_value_missing", "_owner_missing", "_construction_missing", "source_file", "record_date"]
    )
    frame = frame.drop_duplicates(subset=["record_number"], keep="first").copy()
    frame = frame.sort_values(["record_date", "record_number"]).reset_index(drop=True)
    frame["record_date"] = frame["record_date"].dt.strftime("%Y-%m-%d")
    frame["source_date_range_start"] = args.start_date
    frame["source_date_range_end"] = args.end_date
    frame["address"] = frame["address"].fillna(frame["permit_address"])
    frame["permit_address"] = frame["permit_address"].fillna(frame["address"])
    frame["category"] = frame["category"].fillna(frame["permit_type"])

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    frame = frame.drop(columns=["_job_value_missing", "_owner_missing", "_construction_missing"])
    frame.to_csv(args.output_csv, index=False)

    permit_type_counts = frame["permit_type"].fillna("Unknown").value_counts().head(20).to_dict()
    print(f"[normalize-permits] wrote {args.output_csv}")
    print(
        "[normalize-permits] rows="
        f"{len(frame)} permit_types={len(frame['permit_type'].fillna('Unknown').unique())} "
        f"range={frame['record_date'].min()}..{frame['record_date'].max()}"
    )
    print(f"[normalize-permits] top permit types={permit_type_counts}")


if __name__ == "__main__":
    main()
