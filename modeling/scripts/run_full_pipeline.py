#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_ROOFING_DIR = MODEL_ROOT / "data" / "raw" / "roofing"
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
SCRIPTS_DIR = MODEL_ROOT / "scripts"


def run_step(command: list[str]) -> None:
    print(f"[pipeline] {' '.join(command)}")
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the lightweight competitor pricing prototype pipeline.")
    parser.add_argument("--start-date", default="2025-11-01")
    parser.add_argument("--end-date", default="2026-04-14")
    parser.add_argument("--permit-key", default="residential_reroof")
    parser.add_argument("--detail-workers", type=int, default=1)
    parser.add_argument("--detail-pause-seconds", type=float, default=0.15)
    args = parser.parse_args()

    stub = f"{args.permit_key}_{args.start_date}_{args.end_date}"
    permit_csv = RAW_ROOFING_DIR / f"{stub}.csv"
    cohort_csv = PROCESSED_DIR / f"{stub}_cohort.csv"

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
    print("[pipeline] complete")


if __name__ == "__main__":
    main()
