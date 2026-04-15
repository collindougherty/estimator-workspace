#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_ROOFING_DIR = MODEL_ROOT / "data" / "raw" / "roofing"
RAW_SARPY_CSV = MODEL_ROOT / "data" / "raw" / "properties" / "sarpy_county" / "sarpy_properties_model_ready.csv"
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
MULTICOUNTY_DIR = PROCESSED_DIR / "multicounty"
SCRIPTS_DIR = MODEL_ROOT / "scripts"
DOUGLAS_PROPERTY_SOURCE = Path("/Users/collindougherty/MyCloud/properties/omaha_properties_raw_master.csv")


def run_step(command: list[str]) -> None:
    print(f"[v1] {' '.join(command)}")
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the canonical v1 competitor-analysis modeling pipeline.")
    parser.add_argument("--start-date", default="2025-11-01")
    parser.add_argument("--end-date", default="2026-04-14")
    parser.add_argument("--permit-key", default="residential_reroof")
    parser.add_argument("--detail-workers", type=int, default=1)
    parser.add_argument("--detail-pause-seconds", type=float, default=0.15)
    parser.add_argument(
        "--refresh-permits",
        action="store_true",
        help="Re-fetch the raw Omaha permit extract before rebuilding downstream artifacts.",
    )
    args = parser.parse_args()

    stub = f"{args.permit_key}_{args.start_date}_{args.end_date}"
    permit_csv = RAW_ROOFING_DIR / f"{stub}.csv"
    cohort_csv = PROCESSED_DIR / f"{stub}_cohort.csv"
    metrics_csv = PROCESSED_DIR / f"{stub}_cohort_metrics.csv"
    model_summary_json = PROCESSED_DIR / f"{stub}_cohort_model_summary.json"
    multicounty_join_summary_json = MULTICOUNTY_DIR / f"{stub}_multicounty_join_summary.json"

    if args.refresh_permits or not permit_csv.exists():
        run_step(
            [
                sys.executable,
                str(SCRIPTS_DIR / "fetch_roofing_permits.py"),
                "--permit-key",
                args.permit_key,
                "--start-date",
                args.start_date,
                "--end-date",
                args.end_date,
                "--detail-workers",
                str(args.detail_workers),
                "--detail-pause-seconds",
                str(args.detail_pause_seconds),
                "--output-csv",
                str(permit_csv),
            ]
        )
    else:
        print(f"[v1] reusing existing permit extract {permit_csv}")

    run_step(
        [
            sys.executable,
            str(SCRIPTS_DIR / "prepare_dataset.py"),
            "--permit-csv",
            str(permit_csv),
        ]
    )
    run_step(
        [
            sys.executable,
            str(SCRIPTS_DIR / "train_models.py"),
            "--cohort-csv",
            str(cohort_csv),
        ]
    )
    run_step(
        [
            sys.executable,
            str(SCRIPTS_DIR / "stage_sarpy_county.py"),
            "--permit-csv",
            str(permit_csv),
        ]
    )
    run_step(
        [
            sys.executable,
            str(SCRIPTS_DIR / "prepare_multicounty_dataset.py"),
            "--permit-csv",
            str(permit_csv),
            "--property-source",
            f"douglas={DOUGLAS_PROPERTY_SOURCE}",
            "--property-source",
            f"sarpy={RAW_SARPY_CSV}",
        ]
    )
    run_step(
        [
            sys.executable,
            str(SCRIPTS_DIR / "publish_v1_outputs.py"),
            "--cohort-csv",
            str(cohort_csv),
            "--metrics-csv",
            str(metrics_csv),
            "--model-summary-json",
            str(model_summary_json),
            "--multicounty-join-summary-json",
            str(multicounty_join_summary_json),
        ]
    )
    print("[v1] complete")


if __name__ == "__main__":
    main()
