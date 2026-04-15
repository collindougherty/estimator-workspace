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
    "number_of_buildings",
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
    "permit_prefix",
    "permit_type",
    "category",
    "class",
    "construction_type_codes",
    "roof_covering_material",
    "quality",
    "condition",
    "prop_zip",
    "permit_month",
]

FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

COMP_FEATURES = [
    "bldg_sf",
    "total_valu",
    "property_age",
    "bldg_story",
    "acres",
    "number_of_buildings",
    "centroid_latitude",
    "centroid_longitude",
]

COMP_SEGMENT_COLUMNS = ["permit_type", "category", "class", "permit_prefix"]
POINT_MODEL_NAMES = [
    "ridge-log-linear",
    "random-forest-log",
    "permit-type-fallback-forest-log",
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


@dataclass
class PermitTypeFallbackForest:
    global_model: Pipeline
    segment_models: dict[str, Pipeline]
    min_segment_rows: int


def with_comp_segments(frame: pd.DataFrame) -> pd.DataFrame:
    working = frame.copy()
    for column in COMP_SEGMENT_COLUMNS:
        if column not in working.columns:
            working[column] = "Unknown"
        working[f"_segment_{column}"] = working[column].fillna("Unknown").astype(str).str.strip().replace("", "Unknown")
    return working


def select_comp_pool(history: pd.DataFrame, subject: pd.Series) -> tuple[pd.Series, str]:
    strategies = [
        (
            "permit_type+class",
            (history["_segment_permit_type"] == subject["_segment_permit_type"])
            & (history["_segment_class"] == subject["_segment_class"]),
        ),
        ("permit_type", history["_segment_permit_type"] == subject["_segment_permit_type"]),
        ("category", history["_segment_category"] == subject["_segment_category"]),
        ("permit_prefix", history["_segment_permit_prefix"] == subject["_segment_permit_prefix"]),
        ("class", history["_segment_class"] == subject["_segment_class"]),
    ]
    for label, mask in strategies:
        if int(mask.sum()) >= 2:
            return mask, label
    return pd.Series(True, index=history.index), "all_history"


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


def make_ridge_pipeline() -> Pipeline:
    return Pipeline(
        [
            ("preprocess", make_preprocessor(scale_numeric=True, dense_output=True)),
            ("model", RidgeCV(alphas=np.logspace(-3, 3, 25))),
        ]
    )


def make_forest_pipeline(
    *,
    n_estimators: int,
    max_depth: int | None,
    min_samples_leaf: int,
) -> Pipeline:
    return Pipeline(
        [
            ("preprocess", make_preprocessor(scale_numeric=False, dense_output=True)),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=n_estimators,
                    max_depth=max_depth,
                    min_samples_leaf=min_samples_leaf,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def fit_ridge_model(frame: pd.DataFrame) -> Pipeline:
    return fit_log_model(make_ridge_pipeline(), frame[FEATURE_COLUMNS], frame["job_value"])


def fit_forest_model(
    frame: pd.DataFrame,
    *,
    n_estimators: int,
    max_depth: int | None,
    min_samples_leaf: int,
) -> Pipeline:
    return fit_log_model(
        make_forest_pipeline(
            n_estimators=n_estimators,
            max_depth=max_depth,
            min_samples_leaf=min_samples_leaf,
        ),
        frame[FEATURE_COLUMNS],
        frame["job_value"],
    )


def fit_permit_type_fallback_forest(frame: pd.DataFrame, *, min_segment_rows: int = 75) -> PermitTypeFallbackForest:
    working = frame.copy()
    working["permit_type"] = working["permit_type"].fillna("Unknown")
    global_model = fit_forest_model(
        working,
        n_estimators=500,
        max_depth=14,
        min_samples_leaf=2,
    )
    segment_models: dict[str, Pipeline] = {}
    for permit_type, count in working["permit_type"].value_counts().items():
        if int(count) < min_segment_rows:
            continue
        segment_frame = working.loc[working["permit_type"] == permit_type].copy()
        segment_models[str(permit_type)] = fit_forest_model(
            segment_frame,
            n_estimators=400,
            max_depth=12,
            min_samples_leaf=2,
        )
    return PermitTypeFallbackForest(
        global_model=global_model,
        segment_models=segment_models,
        min_segment_rows=min_segment_rows,
    )


def predict_permit_type_fallback(model: PermitTypeFallbackForest, frame: pd.DataFrame) -> np.ndarray:
    working = frame.reset_index(drop=True).copy()
    if "permit_type" not in working.columns:
        working["permit_type"] = "Unknown"
    working["permit_type"] = working["permit_type"].fillna("Unknown")
    predictions = np.zeros(len(working), dtype=float)
    for permit_type, positions in working.groupby("permit_type", dropna=False).groups.items():
        row_positions = list(positions)
        estimator = model.segment_models.get(str(permit_type), model.global_model)
        predictions[row_positions] = predict_dollars(estimator, working.iloc[row_positions][FEATURE_COLUMNS])
    return predictions


def fit_point_model(model_name: str, frame: pd.DataFrame) -> Pipeline | PermitTypeFallbackForest:
    if model_name == "ridge-log-linear":
        return fit_ridge_model(frame)
    if model_name == "random-forest-log":
        return fit_forest_model(
            frame,
            n_estimators=400,
            max_depth=12,
            min_samples_leaf=3,
        )
    if model_name == "permit-type-fallback-forest-log":
        return fit_permit_type_fallback_forest(frame)
    raise ValueError(f"Unsupported point model: {model_name}")


def predict_point_model(
    model_name: str,
    model: Pipeline | PermitTypeFallbackForest,
    frame: pd.DataFrame,
) -> np.ndarray:
    if model_name == "permit-type-fallback-forest-log":
        if not isinstance(model, PermitTypeFallbackForest):
            raise TypeError("Permit-type fallback model expected a PermitTypeFallbackForest bundle.")
        return predict_permit_type_fallback(model, frame)
    if not isinstance(model, Pipeline):
        raise TypeError(f"Expected a Pipeline for point model {model_name}.")
    return predict_dollars(model, frame[FEATURE_COLUMNS])


def metric_row(model_name: str, actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | str]:
    safe_actual = np.where(actual > 0, actual, np.nan)
    ape = np.abs(actual - predicted) / safe_actual
    return {
        "model": model_name,
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "median_ape": float(np.nanmedian(ape)),
        "within_10pct": float(np.nanmean(ape <= 0.10)),
        "within_20pct": float(np.nanmean(ape <= 0.20)),
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
    history = with_comp_segments(history)
    target = with_comp_segments(target)
    prep = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    fit_features = prep.fit_transform(history[COMP_FEATURES])
    target_features = prep.transform(target[COMP_FEATURES])

    range_rows = []
    comp_rows = []
    for row_index, _subject in enumerate(target.itertuples(index=False), start=0):
        subject_row = target.iloc[row_index]
        pool_mask, pool_strategy = select_comp_pool(history, subject_row)
        candidate_positions = np.flatnonzero(pool_mask.to_numpy())
        if candidate_positions.size == 0:
            candidate_positions = np.arange(len(history))
            pool_strategy = "all_history"
        candidate_features = fit_features[candidate_positions]
        model = NearestNeighbors(n_neighbors=min(neighbors, len(candidate_positions)), metric="euclidean")
        model.fit(candidate_features)
        distances, indices = model.kneighbors(target_features[row_index].reshape(1, -1))
        dist_row = distances[0]
        idx_row = candidate_positions[indices[0]]
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
                "comp_pool_strategy": pool_strategy,
                "comp_pool_size": int(len(candidate_positions)),
            }
        )
        for rank, (distance, (_, neighbor)) in enumerate(zip(dist_row, neighbors_frame.iterrows(), strict=False), start=1):
            comp_rows.append(
                {
                    "target_record_number": target_row["record_number"],
                    "target_permit_type": target_row["permit_type"],
                    "target_permit_prefix": target_row["permit_prefix"],
                    "target_class": target_row["class"],
                    "target_job_value": float(target_row["job_value"]),
                    "neighbor_rank": rank,
                    "comp_pool_strategy": pool_strategy,
                    "distance": float(distance),
                    "neighbor_record_number": neighbor["record_number"],
                    "neighbor_record_date": neighbor["record_date"].strftime("%Y-%m-%d"),
                    "neighbor_permit_type": neighbor["permit_type"],
                    "neighbor_permit_prefix": neighbor["permit_prefix"],
                    "neighbor_class": neighbor["class"],
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
    parser.add_argument("--error-by-value-band-csv", type=Path)
    parser.add_argument("--error-by-permit-type-csv", type=Path)
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
    error_by_value_band_csv = args.error_by_value_band_csv or (PROCESSED_DIR / f"{stub}_error_by_value_band.csv")
    error_by_permit_type_csv = args.error_by_permit_type_csv or (PROCESSED_DIR / f"{stub}_error_by_permit_type.csv")
    nearest_comps_csv = args.nearest_comps_csv or (PROCESSED_DIR / f"{stub}_nearest_comps.csv")
    model_summary_json = args.model_summary_json or (PROCESSED_DIR / f"{stub}_model_summary.json")

    frame = pd.read_csv(cohort_csv, parse_dates=["record_date"])
    frame["job_value"] = pd.to_numeric(frame["job_value"], errors="coerce")
    frame = frame.dropna(subset=["job_value"]).reset_index(drop=True)
    train, calibration, test = chronological_split(frame)
    history = pd.concat([train, calibration], ignore_index=True)

    calibration_actual = calibration["job_value"].to_numpy(dtype=float)
    calibration_models: dict[str, Pipeline | PermitTypeFallbackForest] = {}
    calibration_predictions: dict[str, np.ndarray] = {}
    calibration_metrics_rows: list[dict[str, float | str]] = []
    for model_name in POINT_MODEL_NAMES:
        fitted_model = fit_point_model(model_name, train)
        calibration_models[model_name] = fitted_model
        predictions = predict_point_model(model_name, fitted_model, calibration)
        calibration_predictions[model_name] = predictions
        calibration_metrics_rows.append(metric_row(model_name, calibration_actual, predictions))
    calibration_metrics = pd.DataFrame(calibration_metrics_rows).sort_values("mae").reset_index(drop=True)
    selected_point_model = str(calibration_metrics.iloc[0]["model"])

    baseline = SegmentRateBaseline().fit(history)
    baseline_pred = baseline.predict(test)

    history_models = {model_name: fit_point_model(model_name, history) for model_name in POINT_MODEL_NAMES}
    ridge_pipeline = history_models["ridge-log-linear"]
    forest_pipeline = history_models["random-forest-log"]
    packaged_point_model = history_models[selected_point_model]

    ridge_pred = predict_point_model("ridge-log-linear", ridge_pipeline, test)
    forest_pred = predict_point_model("random-forest-log", forest_pipeline, test)
    permit_type_fallback_pred = predict_point_model(
        "permit-type-fallback-forest-log",
        history_models["permit-type-fallback-forest-log"],
        test,
    )
    packaged_pred = predict_point_model(selected_point_model, packaged_point_model, test)

    neighbor_ranges, neighbor_rows = build_neighbor_ranges(history, test)
    neighbor_rows.to_csv(nearest_comps_csv, index=False)
    comp_median_pred = neighbor_ranges["comp_median"].to_numpy(dtype=float)

    actual_test = test["job_value"].to_numpy(dtype=float)
    metrics = pd.DataFrame(
        [
            metric_row("zip-rate-baseline", actual_test, baseline_pred),
            metric_row("ridge-log-linear", actual_test, ridge_pred),
            metric_row("random-forest-log", actual_test, forest_pred),
            metric_row("permit-type-fallback-forest-log", actual_test, permit_type_fallback_pred),
            metric_row("nearest-comp-median", actual_test, comp_median_pred),
        ]
    ).sort_values("mae")
    metrics.to_csv(metrics_csv, index=False)
    point_metrics = metrics.loc[metrics["model"].isin(POINT_MODEL_NAMES)].sort_values("mae").reset_index(drop=True)

    calibration_packaged_pred = calibration_predictions[selected_point_model]
    interval_low, interval_high, interval_meta = make_interval(
        calibration["job_value"],
        calibration_packaged_pred,
        packaged_pred,
    )

    holdout = test[
        [
            "record_number",
            "record_date",
            "permit_type",
            "permit_prefix",
            "class",
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
    holdout["permit_type_fallback_forest_pred"] = permit_type_fallback_pred
    holdout["packaged_model"] = selected_point_model
    holdout["packaged_pred"] = packaged_pred
    holdout["packaged_interval_low_10"] = interval_low
    holdout["packaged_interval_high_90"] = interval_high
    holdout["forest_interval_low_10"] = interval_low
    holdout["forest_interval_high_90"] = interval_high
    holdout = holdout.merge(neighbor_ranges, on="record_number", how="left")
    holdout["forest_abs_error"] = np.abs(holdout["job_value"] - holdout["forest_pred"])
    holdout["forest_ape"] = holdout["forest_abs_error"] / holdout["job_value"]
    holdout["packaged_abs_error"] = np.abs(holdout["job_value"] - holdout["packaged_pred"])
    holdout["packaged_ape"] = holdout["packaged_abs_error"] / holdout["job_value"]
    holdout.to_csv(holdout_predictions_csv, index=False)

    permutation_model = packaged_point_model.global_model if isinstance(packaged_point_model, PermitTypeFallbackForest) else packaged_point_model
    if not isinstance(permutation_model, Pipeline):
        raise TypeError("Expected packaged permutation model to be a Pipeline.")
    permutation = permutation_importance(
        permutation_model,
        test[FEATURE_COLUMNS],
        test["job_value"],
        n_repeats=15,
        random_state=42,
        scoring=mae_on_dollars,
    )
    feature_importance = pd.DataFrame(
        {
            "feature": FEATURE_COLUMNS,
            "importance_mean": permutation.importances_mean,
            "importance_std": permutation.importances_std,
        }
    ).sort_values("importance_mean", ascending=False)
    feature_importance.to_csv(feature_importance_csv, index=False)

    if not isinstance(ridge_pipeline, Pipeline):
        raise TypeError("Ridge point model must be a Pipeline.")
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
            mae=("packaged_abs_error", "mean"),
            median_ape=("packaged_ape", "median"),
            median_actual=("job_value", "median"),
            median_pred=("packaged_pred", "median"),
        )
        .reset_index()
        .sort_values(["holdout_jobs", "mae"], ascending=[False, False])
    )
    error_by_zip.to_csv(error_by_zip_csv, index=False)

    value_band_count = min(5, int(holdout["job_value"].nunique()))
    if value_band_count >= 2:
        holdout["value_band"] = pd.qcut(holdout["job_value"], q=value_band_count, duplicates="drop").astype(str)
    else:
        holdout["value_band"] = "all_jobs"
    error_by_value_band = (
        holdout.groupby("value_band")
        .agg(
            holdout_jobs=("record_number", "count"),
            mae=("packaged_abs_error", "mean"),
            median_ape=("packaged_ape", "median"),
            median_actual=("job_value", "median"),
            median_pred=("packaged_pred", "median"),
        )
        .reset_index()
    )
    error_by_value_band.to_csv(error_by_value_band_csv, index=False)

    error_by_permit_type = (
        holdout.groupby("permit_type", dropna=False)
        .agg(
            holdout_jobs=("record_number", "count"),
            mae=("packaged_abs_error", "mean"),
            median_ape=("packaged_ape", "median"),
            median_actual=("job_value", "median"),
            median_pred=("packaged_pred", "median"),
        )
        .reset_index()
        .sort_values(["holdout_jobs", "mae"], ascending=[False, True])
    )
    error_by_permit_type.to_csv(error_by_permit_type_csv, index=False)

    plot_actual_vs_pred(actual_test, packaged_pred, ARTIFACTS_DIR / f"{stub}_actual_vs_pred.png")
    plot_residuals(actual_test, packaged_pred, ARTIFACTS_DIR / f"{stub}_residuals.png")

    summary = {
        "rows": int(len(frame)),
        "train_rows": int(len(train)),
        "calibration_rows": int(len(calibration)),
        "test_rows": int(len(test)),
        "permit_type_counts": frame["permit_type"].fillna("Unknown").value_counts().to_dict(),
        "calibration_model_ranking": calibration_metrics.to_dict(orient="records"),
        "selected_point_model": selected_point_model,
        "best_point_model": point_metrics.iloc[0]["model"],
        "best_point_model_mae": float(point_metrics.iloc[0]["mae"]),
        "best_model": metrics.iloc[0]["model"],
        "best_model_mae": float(metrics.iloc[0]["mae"]),
        "packaged_interval_meta": interval_meta,
        "packaged_interval_coverage_80": float(
            np.mean((holdout["job_value"] >= holdout["packaged_interval_low_10"]) & (holdout["job_value"] <= holdout["packaged_interval_high_90"]))
        ),
        "forest_interval_meta": interval_meta,
        "forest_interval_coverage_80": float(
            np.mean((holdout["job_value"] >= holdout["packaged_interval_low_10"]) & (holdout["job_value"] <= holdout["packaged_interval_high_90"]))
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
            "error_by_value_band_csv": str(error_by_value_band_csv),
            "error_by_permit_type_csv": str(error_by_permit_type_csv),
            "nearest_comps_csv": str(nearest_comps_csv),
        },
    }
    model_summary_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[train] wrote {metrics_csv}")
    print(f"[train] wrote {holdout_predictions_csv}")
    print(f"[train] wrote {feature_importance_csv}")
    print(f"[train] wrote {error_by_value_band_csv}")
    print(f"[train] wrote {error_by_permit_type_csv}")
    print(f"[train] selected point model={summary['selected_point_model']}")
    print(f"[train] best model={summary['best_model']} mae={summary['best_model_mae']:,.0f}")


if __name__ == "__main__":
    main()
