#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
from io import StringIO
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

MODEL_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = MODEL_ROOT / "output" / "v1"

BRAND = "#2f7d32"
BRAND_DARK = "#1f5a22"
ACCENT = "#0f766e"
WARNING = "#b45309"
DANGER = "#b91c1c"
SLATE = "#475569"
SURFACE = "#f8fafc"
BORDER = "#dbe3ef"


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_csv(path: Path, parse_dates: list[str] | None = None) -> pd.DataFrame:
    kwargs: dict[str, object] = {}
    if parse_dates:
        kwargs["parse_dates"] = parse_dates
    return pd.read_csv(path, **kwargs)


def maybe_relative(path: Path) -> str:
    try:
        return str(path.relative_to(MODEL_ROOT))
    except ValueError:
        return str(path)


def format_int(value: float | int | None) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "—"
    return f"{int(round(float(value))):,}"


def format_number(value: float | int | None, digits: int = 1) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "—"
    return f"{float(value):,.{digits}f}"


def format_currency(value: float | int | None, digits: int = 0) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "—"
    return f"${float(value):,.{digits}f}"


def format_pct(value: float | int | None, digits: int = 1, assume_ratio: bool = True) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "—"
    numeric = float(value)
    if assume_ratio:
        numeric *= 100.0
    return f"{numeric:.{digits}f}%"


def describe_cohort_scope(manifest: dict[str, object]) -> str:
    cohort = manifest.get("cohort", {}) or {}
    profile = cohort.get("cohort_profile")
    if profile == "broad_permit_modeling":
        return "matched Omaha multi-trade permits"
    return "Douglas residential re-roof permits"


def humanize_model_name(model_name: str | None) -> str:
    if not model_name:
        return "Point model"
    replacements = {
        "zip-rate-baseline": "ZIP rate baseline",
        "ridge-log-linear": "Ridge log-linear",
        "random-forest-log": "Random forest",
        "permit-type-fallback-forest-log": "Permit-type fallback forest",
        "nearest-comp-median": "Nearest-comp median",
    }
    return replacements.get(model_name, model_name.replace("-", " "))


def summarize_count_map(counts: dict[str, object] | None, limit: int = 4) -> str:
    if not counts:
        return "—"
    items = sorted(counts.items(), key=lambda item: float(item[1]), reverse=True)[:limit]
    return ", ".join(f"{label}: {format_int(value)}" for label, value in items)


def clean_feature_name(feature: str) -> str:
    replacements = {
        "bldg_sf": "building sqft",
        "total_valu": "total property value",
        "land_value": "land value",
        "improvemen": "improvement value",
        "description_length": "permit text length",
        "centroid_longitude": "longitude",
        "property_age": "property age",
        "kw_decking": "decking keyword",
        "sq_feet": "permit sqft",
        "kw_gutter": "gutter keyword",
        "kw_ventilation": "ventilation keyword",
    }
    return replacements.get(feature, feature.replace("_", " "))


def render_svg(fig: plt.Figure) -> str:
    buffer = StringIO()
    fig.tight_layout()
    fig.savefig(buffer, format="svg", bbox_inches="tight")
    plt.close(fig)
    svg = buffer.getvalue()
    svg_start = svg.find("<svg")
    return svg[svg_start:] if svg_start != -1 else svg


def build_funnel_svg(multicounty_summary: dict[str, object]) -> str:
    steps = [
        ("Permits copied", float(multicounty_summary.get("permit_rows", 0))),
        ("With job value", float(multicounty_summary.get("permit_rows_with_job_value", 0))),
        ("Property subset", float(multicounty_summary.get("property_subset_rows", 0))),
        ("Matched rows", float(multicounty_summary.get("matched_rows", 0))),
        ("Model cohort", float(multicounty_summary.get("cohort_rows", 0))),
    ]

    labels = [label for label, _ in steps]
    values = np.array([value for _, value in steps], dtype=float)
    positions = np.arange(len(labels))

    fig, axis = plt.subplots(figsize=(8.4, 4.6))
    bars = axis.barh(positions, values, color=[BRAND, BRAND, ACCENT, ACCENT, BRAND_DARK])
    axis.set_yticks(positions, labels)
    axis.invert_yaxis()
    axis.set_xlabel("Rows")
    axis.set_title("Data funnel: from raw permits to modeled cohort", loc="left")
    axis.grid(axis="x", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)

    max_value = max(values.max(), 1)
    for bar, value in zip(bars, values, strict=False):
        axis.text(
            min(value + max_value * 0.015, max_value * 1.03),
            bar.get_y() + bar.get_height() / 2,
            format_int(value),
            va="center",
            ha="left",
            color=SLATE,
            fontsize=9,
        )

    axis.set_xlim(0, max_value * 1.12)
    return render_svg(fig)


def build_monthly_volume_svg(scored: pd.DataFrame) -> str:
    monthly = (
        scored.assign(month=pd.to_datetime(scored["record_date"], errors="coerce").dt.to_period("M").astype(str))
        .groupby("month", dropna=False)
        .agg(job_count=("record_number", "count"), median_job_value=("job_value", "median"))
        .reset_index()
    )

    fig, axis = plt.subplots(figsize=(8.4, 4.6))
    axis.bar(monthly["month"], monthly["job_count"], color=BRAND, alpha=0.9)
    axis.set_ylabel("Job count")
    axis.set_title("Monthly cohort volume and median declared valuation", loc="left")
    axis.tick_params(axis="x", rotation=35)
    axis.spines[["top"]].set_visible(False)
    axis.grid(axis="y", color=BORDER, alpha=0.85)

    second_axis = axis.twinx()
    second_axis.plot(
        monthly["month"],
        monthly["median_job_value"],
        color=WARNING,
        linewidth=2.2,
        marker="o",
    )
    second_axis.set_ylabel("Median job value")
    second_axis.spines[["top"]].set_visible(False)

    return render_svg(fig)


def build_job_value_histogram_svg(scored: pd.DataFrame) -> str:
    values = scored["job_value"].dropna().astype(float)
    median_value = float(values.median())

    fig, axis = plt.subplots(figsize=(8.4, 4.6))
    axis.hist(values, bins=24, color=ACCENT, alpha=0.88, edgecolor="white")
    axis.axvline(median_value, color=DANGER, linestyle="--", linewidth=2, label="Median job value")
    axis.set_title("Job value distribution across the packaged cohort", loc="left")
    axis.set_xlabel("Declared permit job value")
    axis.set_ylabel("Jobs")
    axis.grid(axis="y", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    axis.legend(frameon=False)
    return render_svg(fig)


def build_holdout_scatter_svg(holdout: pd.DataFrame, point_model_label: str) -> str:
    actual = holdout["job_value"].astype(float)
    prediction_column = "packaged_pred" if "packaged_pred" in holdout.columns else "forest_pred"
    predicted = holdout[prediction_column].astype(float)
    lower = max(min(actual.min(), predicted.min()), 250)
    upper = max(actual.max(), predicted.max()) * 1.08

    fig, axis = plt.subplots(figsize=(6.4, 6.4))
    axis.scatter(actual, predicted, s=28, alpha=0.65, color=BRAND)
    axis.plot([lower, upper], [lower, upper], linestyle="--", linewidth=2, color=SLATE)
    axis.set_xscale("log")
    axis.set_yscale("log")
    axis.set_xlim(lower, upper)
    axis.set_ylim(lower, upper)
    axis.set_xlabel("Actual declared value")
    axis.set_ylabel(f"{point_model_label} point estimate")
    axis.set_title(f"Holdout actual vs {point_model_label.lower()} prediction", loc="left")
    axis.grid(color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    return render_svg(fig)


def build_coverage_svg(model_summary: dict[str, object]) -> str:
    point_interval_coverage = float(
        model_summary.get("packaged_interval_coverage_80", model_summary.get("forest_interval_coverage_80", 0))
    )
    labels = [
        "Point-model 10-90 interval",
        "Neighbor 10-90 band",
        "Neighbor 5-95 band",
    ]
    values = np.array(
        [
            point_interval_coverage,
            float(model_summary.get("neighbor_range_coverage_80", 0)),
            float(model_summary.get("neighbor_range_coverage_90", 0)),
        ],
        dtype=float,
    )

    fig, axis = plt.subplots(figsize=(7.0, 4.4))
    bars = axis.bar(labels, values * 100.0, color=[SLATE, ACCENT, BRAND_DARK], alpha=0.95)
    axis.set_ylim(0, 100)
    axis.set_ylabel("Holdout coverage")
    axis.set_title("Coverage check across point-model and comp-based ranges", loc="left")
    axis.grid(axis="y", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    axis.tick_params(axis="x", rotation=12)

    for bar, value in zip(bars, values, strict=False):
        axis.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 2,
            format_pct(value),
            ha="center",
            va="bottom",
            color=SLATE,
            fontsize=9,
        )

    return render_svg(fig)


def build_error_band_svg(error_by_value_band: pd.DataFrame) -> str:
    working = error_by_value_band.copy()
    working["median_ape_pct"] = working["median_ape"].astype(float) * 100.0

    fig, axis = plt.subplots(figsize=(8.4, 4.6))
    axis.bar(working["value_band"], working["median_ape_pct"], color=WARNING, alpha=0.9)
    axis.set_ylabel("Median APE %")
    axis.set_xlabel("Holdout value band")
    axis.set_title("Point-model error rises sharply on the highest-value jobs", loc="left")
    axis.tick_params(axis="x", rotation=18)
    axis.grid(axis="y", color=BORDER, alpha=0.85)
    axis.spines[["top"]].set_visible(False)

    second_axis = axis.twinx()
    second_axis.plot(working["value_band"], working["mae"], color=BRAND_DARK, marker="o", linewidth=2)
    second_axis.set_ylabel("MAE")
    second_axis.spines[["top"]].set_visible(False)

    return render_svg(fig)


def build_feature_importance_svg(feature_importance: pd.DataFrame) -> str:
    top_features = (
        feature_importance.head(10)
        .assign(feature_label=lambda frame: frame["feature"].map(clean_feature_name))
        .sort_values("importance_mean", ascending=True)
    )

    fig, axis = plt.subplots(figsize=(8.0, 4.8))
    axis.barh(top_features["feature_label"], top_features["importance_mean"], color=BRAND, alpha=0.92)
    axis.set_xlabel("Permutation importance")
    axis.set_title("Top signal drivers in the packaged point model", loc="left")
    axis.grid(axis="x", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    return render_svg(fig)


def build_band_width_svg(scored: pd.DataFrame) -> str:
    working = scored.copy()
    working["band_width"] = (
        working["recommended_band_high"].astype(float) - working["recommended_band_low"].astype(float)
    )
    values = working["band_width"].replace([np.inf, -np.inf], np.nan).dropna()
    clipped_values = values.clip(upper=float(values.quantile(0.97)))
    median_value = float(values.median())

    fig, axis = plt.subplots(figsize=(8.0, 4.6))
    axis.hist(clipped_values, bins=24, color=SLATE, alpha=0.9, edgecolor="white")
    axis.axvline(median_value, color=BRAND_DARK, linestyle="--", linewidth=2, label="Median width")
    axis.set_title("Comp-band width distribution", loc="left")
    axis.set_xlabel("Recommended band width in dollars (97th percentile capped for readability)")
    axis.set_ylabel("Jobs")
    axis.grid(axis="y", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    axis.legend(frameon=False)
    return render_svg(fig)


def build_company_rollup_svg(company_rollup: pd.DataFrame) -> str:
    top_companies = company_rollup.head(10).copy().sort_values("job_count", ascending=True)

    fig, axis = plt.subplots(figsize=(8.4, 5.0))
    axis.barh(top_companies["licensed_company_name"], top_companies["job_count"], color=ACCENT, alpha=0.88)
    axis.set_xlabel("Jobs in cohort")
    axis.set_title("Top observed companies by cohort volume (exploratory)", loc="left")
    axis.grid(axis="x", color=BORDER, alpha=0.85)
    axis.spines[["top", "right"]].set_visible(False)
    return render_svg(fig)


def build_permit_mix_table(scored: pd.DataFrame) -> pd.DataFrame:
    permit_mix = (
        scored.groupby("permit_type", dropna=False)
        .agg(
            jobs=("record_number", "count"),
            median_job_value=("job_value", "median"),
            median_band_low=("recommended_band_low", "median"),
            median_band_high=("recommended_band_high", "median"),
        )
        .reset_index()
        .sort_values(["jobs", "median_job_value"], ascending=[False, False])
        .head(12)
    )
    permit_mix["jobs"] = permit_mix["jobs"].map(format_int)
    permit_mix["median_job_value"] = permit_mix["median_job_value"].map(format_currency)
    permit_mix["median_band_low"] = permit_mix["median_band_low"].map(format_currency)
    permit_mix["median_band_high"] = permit_mix["median_band_high"].map(format_currency)
    return permit_mix.rename(
        columns={
            "permit_type": "Permit type",
            "jobs": "Jobs",
            "median_job_value": "Median actual",
            "median_band_low": "Median band low",
            "median_band_high": "Median band high",
        }
    )


def build_source_coverage_table(multicounty_summary: dict[str, object]) -> pd.DataFrame:
    copied = multicounty_summary.get("permit_rows_by_permit_type", {}) or {}
    with_value = multicounty_summary.get("permit_rows_with_job_value_by_permit_type", {}) or {}
    cohort = multicounty_summary.get("cohort_rows_by_permit_type", {}) or {}
    rows = []
    for permit_type, copied_count in sorted(copied.items(), key=lambda item: float(item[1]), reverse=True)[:12]:
        copied_value = float(copied_count)
        valued_value = float(with_value.get(permit_type, 0))
        cohort_value = float(cohort.get(permit_type, 0))
        rows.append(
            {
                "Permit type": permit_type,
                "Copied": format_int(copied_value),
                "With value": format_int(valued_value),
                "Modeled": format_int(cohort_value),
                "Model share of copied": format_pct(cohort_value / copied_value if copied_value else 0),
            }
        )
    return pd.DataFrame(rows)


def build_holdout_permit_error_table(error_by_permit_type: pd.DataFrame) -> pd.DataFrame:
    table = error_by_permit_type.copy().head(12)
    table["holdout_jobs"] = table["holdout_jobs"].map(format_int)
    table["mae"] = table["mae"].map(format_currency)
    table["median_ape"] = table["median_ape"].map(lambda value: format_pct(value))
    table["median_actual"] = table["median_actual"].map(format_currency)
    table["median_pred"] = table["median_pred"].map(format_currency)
    return table.rename(
        columns={
            "permit_type": "Permit type",
            "holdout_jobs": "Holdout jobs",
            "mae": "MAE",
            "median_ape": "Median APE",
            "median_actual": "Median actual",
            "median_pred": "Median pred",
        }
    )


def build_band_diagnostics_table(band_diagnostics: pd.DataFrame) -> pd.DataFrame:
    if band_diagnostics.empty:
        return pd.DataFrame(
            [{"Permit type": "—", "Cohort jobs": "—", "Holdout jobs": "—", "Coverage": "—", "Median width ratio": "—", "Tier": "—"}]
        )
    table = band_diagnostics.copy().head(12)
    table["cohort_rows"] = table["cohort_rows"].map(format_int)
    table["holdout_jobs"] = table["holdout_jobs"].map(format_int)
    table["holdout_band_coverage_90"] = table["holdout_band_coverage_90"].map(lambda value: format_pct(value))
    table["holdout_median_band_width"] = table["holdout_median_band_width"].map(format_currency)
    table["holdout_median_band_width_ratio"] = table["holdout_median_band_width_ratio"].map(
        lambda value: "—" if pd.isna(value) else f"{float(value):.1f}x"
    )
    table["band_reliability_tier"] = table["band_reliability_tier"].fillna("—").astype(str).str.title()
    return table.rename(
        columns={
            "permit_type": "Permit type",
            "cohort_rows": "Cohort jobs",
            "holdout_jobs": "Holdout jobs",
            "holdout_band_coverage_90": "Coverage",
            "holdout_median_band_width": "Median band width",
            "holdout_median_band_width_ratio": "Median width ratio",
            "dominant_comp_pool_strategy": "Dominant pool",
            "band_reliability_tier": "Tier",
        }
    )[
        ["Permit type", "Cohort jobs", "Holdout jobs", "Coverage", "Median band width", "Median width ratio", "Dominant pool", "Tier"]
    ]


def format_frame(frame: pd.DataFrame, formatters: dict[str, callable]) -> pd.DataFrame:
    formatted = frame.copy()
    for column, formatter in formatters.items():
        if column in formatted.columns:
            formatted[column] = formatted[column].map(formatter)
    return formatted


def table_html(frame: pd.DataFrame) -> str:
    safe_frame = frame.fillna("—")
    return safe_frame.to_html(index=False, classes=["report-table"], border=0, escape=True)


def build_summary_cards(
    manifest: dict[str, object],
    multicounty_summary: dict[str, object],
    scored: pd.DataFrame,
) -> list[dict[str, str]]:
    validation = manifest.get("validation", {})
    band_reliability = manifest.get("band_reliability", {}) or {}
    cohort = manifest.get("cohort", {}) or {}
    permit_type_counts = cohort.get("permit_type_counts", {}) or {}
    cohort_scope = describe_cohort_scope(manifest)
    card_data = [
        {
            "label": "Modeled cohort",
            "value": format_int(cohort.get("rows")),
            "note": f"{cohort_scope} in the current packaged window",
        },
        {
            "label": "Permit types",
            "value": format_int(len(permit_type_counts)),
            "note": summarize_count_map(permit_type_counts, limit=4),
        },
        {
            "label": "Copied permits",
            "value": format_int(multicounty_summary.get("permit_rows")),
            "note": "Raw permit rows staged inside modeling/ before property matching and cohort filtering",
        },
        {
            "label": "Median job value",
            "value": format_currency(cohort.get("median_job_value")),
            "note": "Declared public permit valuation across the packaged cohort",
        },
        {
            "label": "Recommended band coverage",
            "value": format_pct(validation.get("recommended_band_holdout_coverage")),
            "note": "Holdout coverage for the empirical nearest-comp 5th-95th band",
        },
        {
            "label": "Packaged point-model MAE",
            "value": format_currency(validation.get("packaged_point_model_holdout_mae")),
            "note": f"{humanize_model_name(str(validation.get('packaged_point_model', '')))} supporting estimate only; not the recommended primary surface",
        },
        {
            "label": "Median band width",
            "value": format_currency(
                (
                    scored["recommended_band_high"].astype(float)
                    - scored["recommended_band_low"].astype(float)
                ).median()
            ),
            "note": "Typical spread of the client-facing comparable-job band",
        },
        {
            "label": "Higher-confidence band share",
            "value": format_pct(band_reliability.get("higher_share")),
            "note": "Share of packaged jobs where permit-type holdout support and current band width are both relatively strong",
        },
    ]
    return card_data


def build_process_table(
    multicounty_summary: dict[str, object],
    model_summary: dict[str, object],
    manifest: dict[str, object],
) -> pd.DataFrame:
    cohort = manifest.get("cohort", {}) or {}
    cohort_scope = describe_cohort_scope(manifest)
    validation = manifest.get("validation", {}) or {}
    return pd.DataFrame(
        [
            {"Stage": "Raw permit copy", "Rows / value": format_int(multicounty_summary.get("permit_rows")), "What it means": "Copied Omaha permit rows inside modeling/ without touching the live scraper"},
            {"Stage": "Permits with declared value", "Rows / value": format_int(multicounty_summary.get("permit_rows_with_job_value")), "What it means": "Rows where public job valuation exists"},
            {"Stage": "Property subset", "Rows / value": format_int(multicounty_summary.get("property_subset_rows")), "What it means": "County property rows staged for matching and enrichment"},
            {"Stage": "Matched permit rows", "Rows / value": format_int(multicounty_summary.get("matched_rows")), "What it means": "Permit rows successfully joined to property enrichment"},
            {"Stage": "Final modeled cohort", "Rows / value": format_int(multicounty_summary.get("cohort_rows")), "What it means": f"{cohort_scope} included in the current v1 outputs"},
            {"Stage": "Modeled permit mix", "Rows / value": format_int(len((cohort.get('permit_type_counts') or {}).keys())), "What it means": summarize_count_map(cohort.get("permit_type_counts", {}), limit=5)},
            {"Stage": "Train / calibration / holdout", "Rows / value": " / ".join([format_int(model_summary.get("train_rows")), format_int(model_summary.get("calibration_rows")), format_int(model_summary.get("test_rows"))]), "What it means": "Split used for evaluation and interval sanity checks"},
            {"Stage": "Packaged point model", "Rows / value": humanize_model_name(str(validation.get("packaged_point_model", ""))), "What it means": str(validation.get("packaged_point_model_selected_via", "chronological calibration MAE"))},
            {"Stage": "Recommended product surface", "Rows / value": "Comp band + comps", "What it means": str(manifest.get("recommended_first_product_surface", "—"))},
        ]
    )


def build_readiness_table(manifest: dict[str, object]) -> pd.DataFrame:
    readiness = manifest.get("readiness", {})
    return pd.DataFrame(
        [
            {
                "Surface": key.replace("_", " "),
                "Status": value,
            }
            for key, value in readiness.items()
        ]
    )


def build_metrics_table(metrics: pd.DataFrame) -> pd.DataFrame:
    table = metrics.copy()
    table["mae"] = table["mae"].map(format_currency)
    table["rmse"] = table["rmse"].map(format_currency)
    table["median_ape"] = table["median_ape"].map(lambda value: format_pct(value))
    table["within_10pct"] = table["within_10pct"].map(lambda value: format_pct(value))
    table["within_20pct"] = table["within_20pct"].map(lambda value: format_pct(value))
    table = table.rename(
        columns={
            "model": "Model",
            "mae": "MAE",
            "rmse": "RMSE",
            "median_ape": "Median APE",
            "within_10pct": "Within 10%",
            "within_20pct": "Within 20%",
        }
    )
    return table


def build_company_table(company_rollup: pd.DataFrame) -> pd.DataFrame:
    table = company_rollup.head(12).copy()
    table["job_count"] = table["job_count"].map(format_int)
    if "median_packaged_point_estimate" not in table.columns and "median_forest_point_estimate" in table.columns:
        table["median_packaged_point_estimate"] = table["median_forest_point_estimate"]
    if "median_forest_point_estimate" in table.columns and "median_packaged_point_estimate" in table.columns:
        table = table.drop(columns=["median_forest_point_estimate"])
    for column in [
        "median_job_value",
        "median_packaged_point_estimate",
        "median_comp_median",
        "median_recommended_band_low",
        "median_recommended_band_high",
    ]:
        if column in table.columns:
            table[column] = table[column].map(format_currency)
    return table.rename(
        columns={
            "licensed_company_name": "Company",
            "source_county": "County",
            "job_count": "Jobs",
            "median_job_value": "Median actual",
            "median_packaged_point_estimate": "Median packaged point",
            "median_comp_median": "Median comp median",
            "median_recommended_band_low": "Median band low",
            "median_recommended_band_high": "Median band high",
            "first_seen": "First seen",
            "last_seen": "Last seen",
        }
    )


def build_sample_subject_tables(
    scored: pd.DataFrame,
    nearest_comps: pd.DataFrame,
) -> tuple[dict[str, str], pd.DataFrame]:
    target_job_value = float(scored["job_value"].median())
    sample_subject = scored.iloc[(scored["job_value"].astype(float) - target_job_value).abs().argsort()].iloc[0]
    sample_comps = (
        nearest_comps.loc[nearest_comps["subject_record_number"] == sample_subject["record_number"]]
        .sort_values("neighbor_rank")
        .head(6)
        .copy()
    )
    sample_comps["neighbor_job_value"] = sample_comps["neighbor_job_value"].map(format_currency)
    sample_comps["distance"] = sample_comps["distance"].map(lambda value: format_number(value, 2))
    sample_comps = sample_comps.rename(
        columns={
            "neighbor_rank": "Rank",
            "neighbor_permit_type": "Permit type",
            "neighbor_company_name": "Comparable company",
            "neighbor_address": "Comparable address",
            "neighbor_prop_zip": "ZIP",
            "neighbor_bldg_sf": "Bldg sqft",
            "neighbor_job_value": "Comparable value",
            "distance": "Feature distance",
        }
    )[
        ["Rank", "Permit type", "Comparable company", "Comparable address", "ZIP", "Bldg sqft", "Comparable value", "Feature distance"]
    ]

    subject_card = {
        "record_number": str(sample_subject["record_number"]),
        "permit_type": str(sample_subject["permit_type"]),
        "address": str(sample_subject["property_a"]),
        "company": str(sample_subject["licensed_company_name"]),
        "job_value": format_currency(sample_subject["job_value"]),
        "comp_median": format_currency(sample_subject["comp_median"]),
        "band": f"{format_currency(sample_subject['recommended_band_low'])} – {format_currency(sample_subject['recommended_band_high'])}",
        "neighbors": format_int(sample_subject["comp_neighbor_count"]),
        "band_reliability_tier": str(sample_subject.get("band_reliability_tier", "—")).title(),
        "band_reliability_note": str(sample_subject.get("band_reliability_note", "—")),
    }
    return subject_card, sample_comps


def build_file_table(manifest: dict[str, object], report_path: Path) -> pd.DataFrame:
    files = dict(manifest.get("files", {}))
    files["html_report"] = str(report_path)
    return pd.DataFrame(
        [{"Artifact": key.replace("_", " "), "Path": maybe_relative(Path(value))} for key, value in files.items()]
    )


def build_html(
    manifest_path: Path,
    output_html: Path,
) -> str:
    manifest = read_json(manifest_path)
    files = manifest["files"]
    supporting = manifest["supporting_artifacts"]
    scored = read_csv(Path(files["scored_cohort_csv"]), parse_dates=["record_date"])
    nearest_comps = read_csv(
        Path(files["nearest_comps_csv"]),
        parse_dates=["subject_record_date", "neighbor_record_date"],
    )
    company_rollup = read_csv(Path(files["company_rollup_csv"]), parse_dates=["first_seen", "last_seen"])
    band_diagnostics_path = Path(files.get("band_diagnostics_csv", output_html.parent / "band_diagnostics.csv"))
    band_diagnostics = read_csv(band_diagnostics_path) if band_diagnostics_path.exists() else pd.DataFrame()
    metrics = read_csv(Path(supporting["metrics_csv"]))
    holdout = read_csv(Path(supporting["holdout_predictions_csv"]))
    model_summary = read_json(Path(supporting["model_summary_json"]))
    multicounty_summary = read_json(Path(supporting["multicounty_join_summary_json"]))
    feature_importance = read_csv(Path(model_summary["artifacts"]["feature_importance_csv"]))
    error_by_value_band = read_csv(
        Path(supporting["metrics_csv"]).with_name(
            Path(supporting["metrics_csv"]).name.replace("_metrics.csv", "_error_by_value_band.csv")
        )
    )
    error_by_permit_type_path = Path(
        model_summary.get("artifacts", {}).get(
            "error_by_permit_type_csv",
            str(
                Path(supporting["metrics_csv"]).with_name(
                    Path(supporting["metrics_csv"]).name.replace("_metrics.csv", "_error_by_permit_type.csv")
                )
            ),
        )
    )
    error_by_permit_type = read_csv(error_by_permit_type_path)

    summary_cards = build_summary_cards(manifest, multicounty_summary, scored)
    process_table = build_process_table(multicounty_summary, model_summary, manifest)
    readiness_table = build_readiness_table(manifest)
    metrics_table = build_metrics_table(metrics)
    company_table = build_company_table(company_rollup)
    permit_mix_table = build_permit_mix_table(scored)
    source_coverage_table = build_source_coverage_table(multicounty_summary)
    holdout_permit_error_table = build_holdout_permit_error_table(error_by_permit_type)
    band_diagnostics_table = build_band_diagnostics_table(band_diagnostics)
    subject_card, sample_comps_table = build_sample_subject_tables(scored, nearest_comps)
    file_table = build_file_table(manifest, output_html)
    point_model_label = humanize_model_name(str((manifest.get("validation", {}) or {}).get("packaged_point_model", "")))

    chart_markup = {
        "funnel": build_funnel_svg(multicounty_summary),
        "monthly_volume": build_monthly_volume_svg(scored),
        "job_value_distribution": build_job_value_histogram_svg(scored),
        "holdout_scatter": build_holdout_scatter_svg(holdout, point_model_label),
        "coverage": build_coverage_svg(model_summary),
        "error_band": build_error_band_svg(error_by_value_band),
        "feature_importance": build_feature_importance_svg(feature_importance),
        "band_width": build_band_width_svg(scored),
        "company_rollup": build_company_rollup_svg(company_rollup),
    }

    summary_cards_html = "".join(
        f"""
        <article class="metric-card">
          <span>{html.escape(card["label"])}</span>
          <strong>{html.escape(card["value"])}</strong>
          <p>{html.escape(card["note"])}</p>
        </article>
        """
        for card in summary_cards
    )

    limitations_html = "".join(
        f"<li>{html.escape(str(item))}</li>" for item in manifest.get("limitations", [])
    )

    source_counties = ", ".join(
        f"{county}: {format_int(count)}"
        for county, count in (manifest.get("cohort", {}).get("source_counties", {}) or {}).items()
    )
    cohort_scope = describe_cohort_scope(manifest)
    cohort_profile = (manifest.get("cohort", {}) or {}).get("cohort_profile")
    hero_title = "Omaha multi-trade competitor pricing report" if cohort_profile == "broad_permit_modeling" else "Douglas-first competitor pricing report"
    usefulness_copy = (
        "The current package is strongest when it answers, “what do closely comparable jobs of the same permit type look priced at?” "
        "That is why the recommended first surface is the empirical nearest-neighbor band within the same permit type, with the packaged point estimate kept as support instead of UI truth."
        if cohort_profile == "broad_permit_modeling"
        else "The current package is strongest when it answers, “what do closely comparable residential re-roof jobs look priced at?” "
        "That is why the recommended first surface is the empirical nearest-neighbor band, with the packaged point estimate kept as support instead of UI truth."
    )

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Competitor analysis v1 report</title>
    <style>
      :root {{
        color-scheme: light;
        --brand: {BRAND};
        --brand-dark: {BRAND_DARK};
        --accent: {ACCENT};
        --warning: {WARNING};
        --danger: {DANGER};
        --text: #0f172a;
        --muted: #475569;
        --surface: #ffffff;
        --surface-alt: #f8fafc;
        --border: #dbe3ef;
        --shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      }}

      * {{
        box-sizing: border-box;
      }}

      body {{
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top right, rgba(47, 125, 50, 0.08), transparent 28%),
          linear-gradient(180deg, #f5fbf6 0%, #f8fafc 16%, #f8fafc 100%);
      }}

      main {{
        width: min(1320px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 56px;
      }}

      .hero {{
        display: grid;
        gap: 18px;
        padding: 28px;
        border: 1px solid rgba(47, 125, 50, 0.12);
        border-radius: 28px;
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.97), rgba(240, 253, 244, 0.98));
        box-shadow: var(--shadow);
      }}

      .hero-top {{
        display: flex;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }}

      .eyebrow {{
        margin: 0;
        color: var(--brand);
        font-size: 0.88rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }}

      h1 {{
        margin: 8px 0 12px;
        font-size: clamp(2.1rem, 4vw, 3.6rem);
        line-height: 1.04;
      }}

      .hero p,
      .section-copy,
      .note,
      .pill,
      li,
      td,
      th {{
        line-height: 1.55;
      }}

      .hero-copy {{
        max-width: 880px;
      }}

      .hero-meta {{
        display: grid;
        gap: 8px;
        align-content: start;
        min-width: 240px;
      }}

      .pill-row {{
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }}

      .pill {{
        display: inline-flex;
        align-items: center;
        padding: 9px 13px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.8);
        color: var(--muted);
        font-size: 0.92rem;
        font-weight: 600;
      }}

      .pill-strong {{
        background: rgba(47, 125, 50, 0.1);
        border-color: rgba(47, 125, 50, 0.18);
        color: var(--brand-dark);
      }}

      .metric-grid,
      .section-grid,
      .chart-grid {{
        display: grid;
        gap: 18px;
      }}

      .metric-grid {{
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }}

      .metric-card,
      .section-card,
      .chart-card,
      .callout {{
        border-radius: 24px;
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow);
      }}

      .metric-card {{
        padding: 20px 20px 18px;
      }}

      .metric-card span {{
        display: block;
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 600;
      }}

      .metric-card strong {{
        display: block;
        margin-top: 10px;
        font-size: 2rem;
        line-height: 1.05;
      }}

      .metric-card p {{
        margin: 12px 0 0;
        color: var(--muted);
        font-size: 0.95rem;
      }}

      section {{
        margin-top: 26px;
      }}

      .section-header {{
        margin-bottom: 14px;
      }}

      .section-header h2 {{
        margin: 0 0 8px;
        font-size: 1.65rem;
      }}

      .section-copy {{
        margin: 0;
        color: var(--muted);
        max-width: 860px;
      }}

      .section-grid {{
        grid-template-columns: 1.15fr 0.85fr;
      }}

      .chart-grid {{
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }}

      .chart-card,
      .section-card {{
        padding: 20px;
      }}

      .chart-card h3,
      .section-card h3,
      .callout h3 {{
        margin: 0 0 8px;
        font-size: 1.08rem;
      }}

      .chart-card p,
      .section-card p,
      .callout p {{
        margin: 0 0 14px;
        color: var(--muted);
      }}

      .chart-frame svg {{
        width: 100%;
        height: auto;
      }}

      .report-table {{
        width: 100%;
        border-collapse: collapse;
        font-size: 0.94rem;
      }}

      .report-table th,
      .report-table td {{
        padding: 11px 12px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }}

      .report-table thead th {{
        color: var(--muted);
        font-size: 0.83rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: var(--surface-alt);
      }}

      .report-table tbody tr:hover {{
        background: rgba(248, 250, 252, 0.82);
      }}

      .callout {{
        padding: 20px;
        background: linear-gradient(180deg, rgba(255, 247, 237, 0.92), rgba(255, 255, 255, 1));
      }}

      .callout-danger {{
        background: linear-gradient(180deg, rgba(254, 242, 242, 0.92), rgba(255, 255, 255, 1));
      }}

      .callout ul {{
        margin: 0;
        padding-left: 20px;
      }}

      .sample-grid {{
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 18px;
      }}

      .sample-card {{
        padding: 18px;
        border-radius: 20px;
        border: 1px solid rgba(47, 125, 50, 0.16);
        background: rgba(240, 253, 244, 0.74);
      }}

      .sample-card dt {{
        color: var(--muted);
        font-size: 0.86rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }}

      .sample-card dd {{
        margin: 6px 0 14px;
        font-size: 1rem;
        font-weight: 600;
      }}

      .file-note {{
        color: var(--muted);
        font-size: 0.92rem;
      }}

      @media (max-width: 1024px) {{
        .metric-grid,
        .section-grid,
        .chart-grid,
        .sample-grid {{
          grid-template-columns: 1fr;
        }}
      }}

      @media (max-width: 720px) {{
        main {{
          width: min(100vw - 20px, 1320px);
          padding: 18px 0 40px;
        }}

        .hero,
        .metric-card,
        .section-card,
        .chart-card,
        .callout {{
          padding: 16px;
          border-radius: 20px;
        }}
      }}
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <p class="eyebrow">Competitor analysis v1</p>
            <h1>{html.escape(hero_title)}</h1>
            <p class="section-copy">
              This HTML packages the current modeling process end to end: the copied permit intake, the county-property join,
              the packaged cohort, the point-model diagnostics, and the nearest-comparable pricing band that is strongest for a first client-facing surface across {html.escape(cohort_scope)}.
            </p>
          </div>
          <div class="hero-meta">
            <div class="pill-row">
              <span class="pill pill-strong">Nearest-comp band: v1-ready</span>
              <span class="pill">{html.escape(point_model_label)}: supporting only</span>
              <span class="pill">Company rollups: exploratory</span>
            </div>
            <div class="pill-row">
              <span class="pill">Generated {html.escape(str(manifest.get("generated_at", "—")))}</span>
              <span class="pill">Source counties {html.escape(source_counties or "—")}</span>
            </div>
          </div>
        </div>
        <div class="metric-grid">
          {summary_cards_html}
        </div>
      </section>

      <section>
        <div class="section-header">
          <h2>Client usefulness and methodological posture</h2>
          <p class="section-copy">
            {html.escape(usefulness_copy)}
          </p>
        </div>
        <div class="section-grid">
          <article class="callout">
            <h3>What should be client-facing now</h3>
            <ul>
              <li>Comparable-job band using the empirical <strong>5th-95th percentile</strong> of the nearest neighbors drawn from the same permit type.</li>
              <li>A short comparable-job list so clients can inspect the jobs behind the range.</li>
              <li>A clear median comparable value to anchor the conversation around the range.</li>
            </ul>
          </article>
          <article class="callout callout-danger">
            <h3>What should stay caveated</h3>
            <ul>
              {limitations_html}
            </ul>
          </article>
        </div>
      </section>

      <section>
        <div class="section-header">
          <h2>Whole-process view</h2>
          <p class="section-copy">
            This section shows the pipeline as it exists today: copied permit intake, match and cohort filters, evaluation split, and the packaged outputs that later product wiring can consume.
          </p>
        </div>
        <div class="section-grid">
          <article class="chart-card">
            <h3>Pipeline funnel</h3>
            <p>Rows drop only where declared values or final cohort eligibility are missing; Douglas matching is otherwise very high.</p>
            <div class="chart-frame">{chart_markup["funnel"]}</div>
          </article>
          <article class="section-card">
            <h3>Process checkpoints</h3>
            {table_html(process_table)}
          </article>
          <article class="section-card">
            <h3>Permit mix in the packaged cohort</h3>
            <p>These are the highest-volume permit types currently represented in the modeled cohort.</p>
            {table_html(permit_mix_table)}
          </article>
          <article class="section-card">
            <h3>Where the broader intake narrows</h3>
            <p>This shows the difference between copied permit volume, rows that actually carry declared valuations, and the final modeled cohort by permit type.</p>
            {table_html(source_coverage_table)}
          </article>
        </div>
      </section>

      <section>
        <div class="section-header">
          <h2>Validation, calibration, and why the band wins</h2>
          <p class="section-copy">
            The packaged point model is materially better now, but the comparable-job band still wins the product argument because it is easier to explain, easier to inspect, and still behaves better on the market segments clients care about most.
          </p>
        </div>
        <div class="chart-grid">
          <article class="chart-card">
            <h3>Coverage comparison</h3>
            <p>The point-model interval is now reasonably calibrated too, but the comp band remains the cleaner client-facing answer because its uncertainty comes directly from observable comparable jobs.</p>
            <div class="chart-frame">{chart_markup["coverage"]}</div>
          </article>
          <article class="chart-card">
            <h3>Holdout scatter</h3>
            <p>The packaged point model tracks the middle of the market reasonably well but still compresses the highest-value jobs too much.</p>
            <div class="chart-frame">{chart_markup["holdout_scatter"]}</div>
          </article>
          <article class="chart-card">
            <h3>Error by value band</h3>
            <p>The highest-value holdout band is where MAE and median APE deteriorate most, reinforcing the band-first recommendation.</p>
            <div class="chart-frame">{chart_markup["error_band"]}</div>
          </article>
          <article class="chart-card">
            <h3>Feature importance</h3>
            <p>Square footage, property value context, and permit-text signals still dominate the current point-model signal mix.</p>
            <div class="chart-frame">{chart_markup["feature_importance"]}</div>
          </article>
        </div>
        <article class="section-card">
          <h3>Point-model benchmark table</h3>
          <p>These are supporting diagnostics for the current packaged cohort, not a recommendation to ship a pure point-estimate UI.</p>
          {table_html(metrics_table)}
        </article>
        <article class="section-card">
          <h3>Holdout error by permit type</h3>
          <p>These are the highest-volume permit types in the holdout slice, which is the clearest view of where the current point model is genuinely useful vs still rough.</p>
          {table_html(holdout_permit_error_table)}
        </article>
        <article class="section-card">
          <h3>Comparable-band reliability by permit type</h3>
          <p>These tiers combine holdout band coverage, holdout sample size, and the typical width of the 5th-95th comparable range so product can separate stronger permit types from cautionary ones.</p>
          {table_html(band_diagnostics_table)}
        </article>
      </section>

      <section>
        <div class="section-header">
          <h2>Client-facing report shape</h2>
          <p class="section-copy">
            These visuals describe what clients would actually experience: cohort value spread, the width of the comparable-job range, and one representative example of the comps that sit behind a recommended band.
          </p>
        </div>
        <div class="chart-grid">
          <article class="chart-card">
            <h3>Job value distribution</h3>
            <p>The packaged cohort still spans a very wide range, which is why nearest-comparable context matters more than a single number.</p>
            <div class="chart-frame">{chart_markup["job_value_distribution"]}</div>
          </article>
          <article class="chart-card">
            <h3>Band-width distribution</h3>
            <p>Comparable-job uncertainty is not uniform; this view shows the dollar spread clients would actually see in a recommended range.</p>
            <div class="chart-frame">{chart_markup["band_width"]}</div>
          </article>
          <article class="chart-card">
            <h3>Monthly cohort shape</h3>
            <p>Volume is steady across the current permit window, while median declared job value moves meaningfully month to month.</p>
            <div class="chart-frame">{chart_markup["monthly_volume"]}</div>
          </article>
          <article class="chart-card">
            <h3>Exploratory company rollup</h3>
            <p>This is useful for internal review, but it stays exploratory until contractor names are normalized more aggressively.</p>
            <div class="chart-frame">{chart_markup["company_rollup"]}</div>
          </article>
        </div>
      </section>

      <section>
        <div class="section-header">
          <h2>Representative comparable-job view</h2>
          <p class="section-copy">
            A first client surface should feel like this: one subject job, a recommended band, and a short ranked list of comparable permits behind that range.
          </p>
        </div>
        <div class="sample-grid">
          <article class="sample-card">
            <h3>Example subject near the cohort median</h3>
            <dl>
              <dt>Record</dt>
              <dd>{html.escape(subject_card["record_number"])}</dd>
              <dt>Permit type</dt>
              <dd>{html.escape(subject_card["permit_type"])}</dd>
              <dt>Address</dt>
              <dd>{html.escape(subject_card["address"])}</dd>
              <dt>Company</dt>
              <dd>{html.escape(subject_card["company"])}</dd>
              <dt>Actual declared value</dt>
              <dd>{html.escape(subject_card["job_value"])}</dd>
              <dt>Comparable median</dt>
              <dd>{html.escape(subject_card["comp_median"])}</dd>
              <dt>Recommended band</dt>
              <dd>{html.escape(subject_card["band"])}</dd>
              <dt>Neighbor count</dt>
              <dd>{html.escape(subject_card["neighbors"])}</dd>
              <dt>Band reliability</dt>
              <dd>{html.escape(subject_card["band_reliability_tier"])}</dd>
              <dt>Reliability note</dt>
              <dd>{html.escape(subject_card["band_reliability_note"])}</dd>
            </dl>
          </article>
          <article class="section-card">
            <h3>Closest comparable permits for the sample subject</h3>
            <p>The ranked list below is what should back the “show me the comps” affordance in a future client panel.</p>
            {table_html(sample_comps_table)}
          </article>
        </div>
      </section>

      <section>
        <div class="section-header">
          <h2>Readiness and output contract</h2>
          <p class="section-copy">
            This is the current handoff line between exploratory modeling work and something that product can safely consume later.
          </p>
        </div>
        <div class="section-grid">
          <article class="section-card">
            <h3>Readiness matrix</h3>
            {table_html(readiness_table)}
          </article>
          <article class="section-card">
            <h3>Published files</h3>
            <p class="file-note">These artifacts are refreshed by the canonical v1 pipeline and meant to remain the stable package boundary.</p>
            {table_html(file_table)}
          </article>
        </div>
        <article class="section-card">
          <h3>Exploratory company summary table</h3>
          <p>The counts below are informative for internal review, but name normalization is still the gating step before any leaderboard-style product use.</p>
          {table_html(company_table)}
        </article>
      </section>
    </main>
  </body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the packaged v1 modeling HTML report.")
    parser.add_argument("--manifest-json", type=Path, default=OUTPUT_DIR / "manifest.json")
    parser.add_argument("--output-html", type=Path, default=OUTPUT_DIR / "report.html")
    args = parser.parse_args()

    html_content = build_html(args.manifest_json, args.output_html)
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    args.output_html.write_text(html_content, encoding="utf-8")

    manifest = read_json(args.manifest_json)
    manifest.setdefault("files", {})["html_report"] = str(args.output_html)
    args.manifest_json.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[build-report] wrote {args.output_html}")
    print(f"[build-report] updated {args.manifest_json}")


if __name__ == "__main__":
    main()
