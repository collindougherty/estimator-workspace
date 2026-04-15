#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error
from sklearn.metrics import mean_squared_error
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.preprocessing import StandardScaler

matplotlib.use("Agg")
import matplotlib.pyplot as plt

MODEL_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = MODEL_ROOT / "data" / "processed"
ARTIFACTS_DIR = MODEL_ROOT / "artifacts"

NUMERIC_FEATURES = [
    "bldg_sf",
    "total_valu",
    "land_value",
    "improvemen",
    "property_age",
    "bldg_story",
    "acres",
    "sq_feet",
    "centroid_latitude",
    "centroid_longitude",
    "description_length",
    "kw_gutter",
    "kw_decking",
    "kw_garage",
    "kw_insurance",
    "kw_impact_shingle",
    "kw_metal",
    "kw_flat_roof",
    "kw_ventilation",
    "kw_skylight",
]

CATEGORICAL_FEATURES = [
    "roof_covering_material",
    "quality",
    "condition",
    "prop_zip",
    "permit_month",
]

COMP_FEATURES = [
    "bldg_sf",
    "total_valu",
    "property_age",
    "bldg_story",
    "acres",
    "centroid_latitude",
    "centroid_longitude",
]


@dataclass
class SegmentRateBaseline:
    global_rate: float | None = None
    zip_rates: dict[str, float] | None = None

    def fit(self, frame: pd.DataFrame) -> "SegmentRateBaseline":
        working = frame[(frame["bldg_sf"] > 0) & frame["job_value"].notna()].copy()
        total_bldg_sf = working["bldg_sf"].sum()
        self.global_rate = float(working["job_value"].sum() / total_bldg_sf) if total_bldg_sf else float(working["job_value"].median())
        grouped = working.groupby("prop_zip", dropna=False).agg(job_value_sum=("job_value", "sum"), bldg_sf_sum=("bldg_sf", "sum"))
        zip_rates = (grouped["job_value_sum"] / grouped["bldg_sf_sum"]).replace([np.inf, -np.inf], np.nan).dropna()
        self.zip_rates = zip_rates.to_dict()
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        if self.global_rate is None or self.zip_rates is None:
            raise RuntimeError("Baseline must be fit before prediction.")
        rates = frame["prop_zip"].map(self.zip_rates).astype(float)
        rates = rates.fillna(self.global_rate)
        prediction = frame["bldg_sf"].fillna(frame["bldg_sf"].median()) * rates
        return prediction.to_numpy(dtype=float)


def make_preprocessor(scale_numeric: bool, dense_output: bool = True) -> ColumnTransformer:
    numeric_steps: list[tuple[str, object]] = [("imputer", SimpleImputer(strategy="median"))]
    if scale_numeric:
        numeric_steps.append(("scaler", StandardScaler()))
    return ColumnTransformer(
        transformers=[
            ("num", Pipeline(numeric_steps), NUMERIC_FEATURES),
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=not dense_output)),
                    ]
                ),
                CATEGORICAL_FEATURES,
            ),
        ],
        remainder="drop",
    )


def chronological_split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ordered = frame.sort_values(["record_date", "record_number"]).reset_index(drop=True)
    n_rows = len(ordered)
    if n_rows < 15:
        raise RuntimeError(f"Need at least 15 cohort rows to train models, found {n_rows}.")
    n_test = max(5, int(round(n_rows * 0.2)))
    n_cal = max(5, int(round(n_rows * 0.2)))
    min_train = max(5, int(round(n_rows * 0.4)))
    while n_test + n_cal + min_train > n_rows and (n_test > 5 or n_cal > 5):
        if n_test >= n_cal and n_test > 5:
            n_test -= 1
        elif n_cal > 5:
            n_cal -= 1
    test = ordered.iloc[-n_test:].copy()
    remaining = ordered.iloc[:-n_test].copy()
    calibration = remaining.iloc[-n_cal:].copy()
    train = remaining.iloc[:-n_cal].copy()
    return train, calibration, test


def fit_log_model(pipeline: Pipeline, features: pd.DataFrame, target: pd.Series) -> Pipeline:
    pipeline.fit(features, np.log1p(target))
    return pipeline


def predict_dollars(model: Pipeline, features: pd.DataFrame) -> np.ndarray:
    return np.expm1(model.predict(features)).clip(min=0)


def metric_row(model_name: str, actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | str]:
    ape = np.abs(actual - predicted) / actual
    return {
        "model": model_name,
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "median_ape": float(np.median(ape)),
        "within_10pct": float(np.mean(ape <= 0.10)),
        "within_20pct": float(np.mean(ape <= 0.20)),
    }


def mae_on_dollars(estimator: Pipeline, features: pd.DataFrame, actual: pd.Series) -> float:
    predicted = predict_dollars(estimator, features)
    return -mean_absolute_error(actual, predicted)


def make_interval(
    cal_actual: pd.Series,
    cal_pred: np.ndarray,
    test_pred: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    residuals = np.log1p(cal_actual.to_numpy(dtype=float)) - np.log1p(cal_pred)
    q_low, q_high = np.quantile(residuals, [0.10, 0.90])
    low = np.expm1(np.log1p(test_pred) + q_low).clip(min=0)
    high = np.expm1(np.log1p(test_pred) + q_high).clip(min=0)
    return low, high, {"q10_log_residual": float(q_low), "q90_log_residual": float(q_high)}


def build_neighbor_ranges(
    history: pd.DataFrame,
    target: pd.DataFrame,
    neighbors: int = 12,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    prep = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    fit_features = prep.fit_transform(history[COMP_FEATURES])
    model = NearestNeighbors(n_neighbors=min(neighbors, len(history)), metric="euclidean")
    model.fit(fit_features)
    target_features = prep.transform(target[COMP_FEATURES])
    distances, indices = model.kneighbors(target_features)

    range_rows = []
    comp_rows = []
    for row_index, (dist_row, idx_row) in enumerate(zip(distances, indices, strict=False)):
        target_row = target.iloc[row_index]
        neighbors_frame = history.iloc[idx_row].copy().reset_index(drop=True)
        values = neighbors_frame["job_value"].to_numpy(dtype=float)
        range_rows.append(
            {
                "record_number": target_row["record_number"],
                "comp_median": float(np.median(values)),
                "comp_low_10": float(np.quantile(values, 0.10)),
                "comp_high_90": float(np.quantile(values, 0.90)),
                "comp_low_05": float(np.quantile(values, 0.05)),
                "comp_high_95": float(np.quantile(values, 0.95)),
                "comp_neighbor_count": int(len(values)),
            }
        )
        for rank, (distance, (_, neighbor)) in enumerate(zip(dist_row, neighbors_frame.iterrows(), strict=False), start=1):
            comp_rows.append(
                {
                    "target_record_number": target_row["record_number"],
                    "target_job_value": float(target_row["job_value"]),
                    "neighbor_rank": rank,
                    "distance": float(distance),
                    "neighbor_record_number": neighbor["record_number"],
                    "neighbor_record_date": neighbor["record_date"].strftime("%Y-%m-%d"),
                    "neighbor_job_value": float(neighbor["job_value"]),
                    "neighbor_company_name": neighbor["licensed_company_name"],
                    "neighbor_address": neighbor["property_a"],
                }
            )
    return pd.DataFrame(range_rows), pd.DataFrame(comp_rows)


def plot_actual_vs_pred(actual: np.ndarray, predicted: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    low = min(actual.min(), predicted.min())
    high = max(actual.max(), predicted.max())
    plt.figure(figsize=(6.5, 6.5))
    plt.scatter(actual, predicted, alpha=0.65, edgecolors="none")
    plt.plot([low, high], [low, high], linestyle="--", color="black", linewidth=1)
    plt.xlabel("Actual declared job value ($)")
    plt.ylabel("Predicted declared job value ($)")
    plt.title("Holdout actual vs. predicted job value")
    plt.tight_layout()
    plt.savefig(output_path, dpi=160)
    plt.close()


def plot_residuals(actual: np.ndarray, predicted: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    residual_pct = (predicted - actual) / actual * 100
    plt.figure(figsize=(7.0, 4.5))
    plt.hist(residual_pct, bins=25, color="#4472c4", alpha=0.8)
    plt.axvline(0, color="black", linestyle="--", linewidth=1)
    plt.xlabel("Prediction error (%)")
    plt.ylabel("Holdout count")
    plt.title("Holdout residual distribution")
    plt.tight_layout()
    plt.savefig(output_path, dpi=160)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train lightweight pricing prototype models.")
    parser.add_argument("--cohort-csv", type=Path, required=True)
    parser.add_argument("--metrics-csv", type=Path)
    parser.add_argument("--holdout-predictions-csv", type=Path)
    parser.add_argument("--feature-importance-csv", type=Path)
    parser.add_argument("--ridge-coefficients-csv", type=Path)
    parser.add_argument("--error-by-zip-csv", type=Path)
    parser.add_argument("--nearest-comps-csv", type=Path)
    parser.add_argument("--model-summary-json", type=Path)
    args = parser.parse_args()

    cohort_csv = args.cohort_csv
    stub = cohort_csv.stem
    metrics_csv = args.metrics_csv or (PROCESSED_DIR / f"{stub}_metrics.csv")
    holdout_predictions_csv = args.holdout_predictions_csv or (PROCESSED_DIR / f"{stub}_holdout_predictions.csv")
    feature_importance_csv = args.feature_importance_csv or (PROCESSED_DIR / f"{stub}_feature_importance.csv")
    ridge_coefficients_csv = args.ridge_coefficients_csv or (PROCESSED_DIR / f"{stub}_ridge_coefficients.csv")
    error_by_zip_csv = args.error_by_zip_csv or (PROCESSED_DIR / f"{stub}_error_by_zip.csv")
    nearest_comps_csv = args.nearest_comps_csv or (PROCESSED_DIR / f"{stub}_nearest_comps.csv")
    model_summary_json = args.model_summary_json or (PROCESSED_DIR / f"{stub}_model_summary.json")

    frame = pd.read_csv(cohort_csv, parse_dates=["record_date"])
    train, calibration, test = chronological_split(frame)
    history = pd.concat([train, calibration], ignore_index=True)

    baseline = SegmentRateBaseline().fit(history)
    baseline_pred = baseline.predict(test)

    ridge_pipeline = Pipeline(
        [
            ("preprocess", make_preprocessor(scale_numeric=True, dense_output=True)),
            ("model", RidgeCV(alphas=np.logspace(-3, 3, 25))),
        ]
    )
    ridge_pipeline = fit_log_model(ridge_pipeline, history[NUMERIC_FEATURES + CATEGORICAL_FEATURES], history["job_value"])
    ridge_pred = predict_dollars(ridge_pipeline, test[NUMERIC_FEATURES + CATEGORICAL_FEATURES])

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
    forest_pipeline = fit_log_model(forest_pipeline, history[NUMERIC_FEATURES + CATEGORICAL_FEATURES], history["job_value"])
    forest_pred = predict_dollars(forest_pipeline, test[NUMERIC_FEATURES + CATEGORICAL_FEATURES])

    neighbor_ranges, neighbor_rows = build_neighbor_ranges(history, test)
    neighbor_rows.to_csv(nearest_comps_csv, index=False)
    comp_median_pred = neighbor_ranges["comp_median"].to_numpy(dtype=float)

    metrics = pd.DataFrame(
        [
            metric_row("zip-rate-baseline", test["job_value"].to_numpy(dtype=float), baseline_pred),
            metric_row("ridge-log-linear", test["job_value"].to_numpy(dtype=float), ridge_pred),
            metric_row("random-forest-log", test["job_value"].to_numpy(dtype=float), forest_pred),
            metric_row("nearest-comp-median", test["job_value"].to_numpy(dtype=float), comp_median_pred),
        ]
    ).sort_values("mae")
    metrics.to_csv(metrics_csv, index=False)

    cal_pred = predict_dollars(forest_pipeline, calibration[NUMERIC_FEATURES + CATEGORICAL_FEATURES])
    interval_low, interval_high, interval_meta = make_interval(calibration["job_value"], cal_pred, forest_pred)

    holdout = test[
        [
            "record_number",
            "record_date",
            "property_a",
            "licensed_company_name",
            "roof_covering_material",
            "prop_zip",
            "bldg_sf",
            "total_valu",
            "job_value",
        ]
    ].copy()
    holdout["baseline_pred"] = baseline_pred
    holdout["ridge_pred"] = ridge_pred
    holdout["forest_pred"] = forest_pred
    holdout["forest_interval_low_10"] = interval_low
    holdout["forest_interval_high_90"] = interval_high
    holdout = holdout.merge(neighbor_ranges, on="record_number", how="left")
    holdout["forest_abs_error"] = np.abs(holdout["job_value"] - holdout["forest_pred"])
    holdout["forest_ape"] = holdout["forest_abs_error"] / holdout["job_value"]
    holdout.to_csv(holdout_predictions_csv, index=False)

    permutation = permutation_importance(
        forest_pipeline,
        test[NUMERIC_FEATURES + CATEGORICAL_FEATURES],
        test["job_value"],
        n_repeats=15,
        random_state=42,
        scoring=mae_on_dollars,
    )
    feature_importance = pd.DataFrame(
        {
            "feature": NUMERIC_FEATURES + CATEGORICAL_FEATURES,
            "importance_mean": permutation.importances_mean,
            "importance_std": permutation.importances_std,
        }
    ).sort_values("importance_mean", ascending=False)
    feature_importance.to_csv(feature_importance_csv, index=False)

    ridge_feature_names = ridge_pipeline.named_steps["preprocess"].get_feature_names_out()
    ridge_coefficients = pd.DataFrame(
        {
            "feature": ridge_feature_names,
            "coefficient": ridge_pipeline.named_steps["model"].coef_,
        }
    )
    ridge_coefficients["abs_coefficient"] = ridge_coefficients["coefficient"].abs()
    ridge_coefficients.sort_values("abs_coefficient", ascending=False).to_csv(ridge_coefficients_csv, index=False)

    error_by_zip = (
        holdout.groupby("prop_zip")
        .agg(
            holdout_jobs=("record_number", "count"),
            mae=("forest_abs_error", "mean"),
            median_ape=("forest_ape", "median"),
            median_actual=("job_value", "median"),
            median_pred=("forest_pred", "median"),
        )
        .reset_index()
        .sort_values(["holdout_jobs", "mae"], ascending=[False, False])
    )
    error_by_zip.to_csv(error_by_zip_csv, index=False)

    plot_actual_vs_pred(test["job_value"].to_numpy(dtype=float), forest_pred, ARTIFACTS_DIR / f"{stub}_actual_vs_pred.png")
    plot_residuals(test["job_value"].to_numpy(dtype=float), forest_pred, ARTIFACTS_DIR / f"{stub}_residuals.png")

    summary = {
        "rows": int(len(frame)),
        "train_rows": int(len(train)),
        "calibration_rows": int(len(calibration)),
        "test_rows": int(len(test)),
        "best_model": metrics.iloc[0]["model"],
        "best_model_mae": float(metrics.iloc[0]["mae"]),
        "forest_interval_meta": interval_meta,
        "forest_interval_coverage_80": float(
            np.mean((holdout["job_value"] >= holdout["forest_interval_low_10"]) & (holdout["job_value"] <= holdout["forest_interval_high_90"]))
        ),
        "neighbor_range_coverage_80": float(
            np.mean((holdout["job_value"] >= holdout["comp_low_10"]) & (holdout["job_value"] <= holdout["comp_high_90"]))
        ),
        "neighbor_range_coverage_90": float(
            np.mean((holdout["job_value"] >= holdout["comp_low_05"]) & (holdout["job_value"] <= holdout["comp_high_95"]))
        ),
        "artifacts": {
            "metrics_csv": str(metrics_csv),
            "holdout_predictions_csv": str(holdout_predictions_csv),
            "feature_importance_csv": str(feature_importance_csv),
            "ridge_coefficients_csv": str(ridge_coefficients_csv),
            "error_by_zip_csv": str(error_by_zip_csv),
            "nearest_comps_csv": str(nearest_comps_csv),
        },
    }
    model_summary_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[train] wrote {metrics_csv}")
    print(f"[train] wrote {holdout_predictions_csv}")
    print(f"[train] wrote {feature_importance_csv}")
    print(f"[train] best model={summary['best_model']} mae={summary['best_model_mae']:,.0f}")


if __name__ == "__main__":
    main()
