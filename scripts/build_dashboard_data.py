#!/usr/bin/env python3
"""Build the browser-ready dataset from the controlled analysis outputs.

The site intentionally ships a compact, static JSON extract. This keeps the
GitHub Pages build serverless while preserving a reproducible link to every
source CSV used by the interface.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import defaultdict
from datetime import timezone
from pathlib import Path
from zoneinfo import ZoneInfo

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

try:
    import numpy as np
    import pandas as pd
except ImportError:  # pragma: no cover - reported cleanly when data rebuild is requested.
    np = None
    pd = None


SUPPORTED_HORIZONS = (1, 3, 5, 10, 15, 30)
PRIMARY_SOURCE = "NQ"
SOURCE_HIERARCHY = (
    {
        "instrument": "NQ",
        "sourceId": "NQ_long_history",
        "rank": 1,
        "role": "primary",
        "status": "available",
        "available": True,
        "fallbackLevel": 0,
        "notes": "Primary source for adverse-movement evidence.",
    },
    {
        "instrument": "MNQ",
        "sourceId": "MNQ_U6_overlap",
        "rank": 2,
        "role": "first fallback",
        "status": "limited overlap validation only",
        "available": False,
        "fallbackLevel": 1,
        "notes": "Retained as a fallback concept and overlap check; not used while primary NQ is available.",
    },
    {
        "instrument": "US100",
        "sourceId": "US100",
        "rank": 3,
        "role": "final fallback",
        "status": "not available in the current controlled outputs",
        "available": False,
        "fallbackLevel": 2,
        "notes": "Reserved for future fallback only.",
    },
)
TRADING_INSTRUMENTS = {
    "MNQ": {"dollarsPerPoint": 2.0, "commissionPerSide": 0.5},
    "NQ": {"dollarsPerPoint": 20.0, "commissionPerSide": 1.75},
}

NY = ZoneInfo("America/New_York")
MINUTE_NS = 60_000_000_000
SESSIONS = (
    ("Asia KZ", 20 * 60, 24 * 60),
    ("London KZ", 2 * 60, 5 * 60),
    ("Pre-Market OR", 7 * 60, 7 * 60 + 30),
    ("08:30 OR", 8 * 60 + 30, 9 * 60 + 30),
    ("NY AM OR", 9 * 60 + 30, 10 * 60),
    ("NY 1st DR", 9 * 60 + 30, 10 * 60 + 30),
    ("NY AM SB", 10 * 60, 11 * 60),
    ("NY Lunch", 11 * 60 + 30, 13 * 60 + 30),
    ("NY PM KZ", 13 * 60 + 30, 16 * 60),
)
SESSION_ORDER = {name: index for index, (name, _, _) in enumerate(SESSIONS)}


SELECTED_FILES = {
    "stop_loss_volatility_reference.csv",
    "seasonal_bootstrap_confidence_intervals.csv",
    "iso_year_week_splits.csv",
    "atr_mae_metrics.csv",
    "bootstrap_confidence_intervals.csv",
    "cash_open_5m_bins.csv",
    "rolling_20_60_session_stability.csv",
    "nq_mnq_overlap_comparison.csv",
    "nq_mnq_relative_session_effects.csv",
    "execution_bootstrap_confidence_intervals.csv",
    "risk_150_compatibility.csv",
    "thesis_grouping_summary.csv",
    "account_day_summary.csv",
    "performance_after_loss_summary.csv",
    "claim_evidence_register.csv",
    "data_quality_register.csv",
    "source_manifest.json",
    "generated_output_manifest.json",
}

DATA_SOURCE_FALLBACK = list(SOURCE_HIERARCHY)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(value: str | None, integer: bool = False):
    if value in (None, ""):
        return None
    parsed = float(value)
    return int(parsed) if integer else round(parsed, 6)


def _source_metadata() -> dict[str, object]:
    return {
        "dataInstrument": PRIMARY_SOURCE,
        "sourceId": "NQ_long_history",
        "sourceRank": 1,
        "fallbackLevel": 0,
        "fallbackReason": "primary NQ data available",
        "reconciliationStatus": "NQ primary; MNQ overlap retained as a limited comparability check; US100 unavailable",
    }


def _decorate(row: dict[str, object]) -> dict[str, object]:
    return {**row, **_source_metadata()}


def _require_analysis_libs() -> None:
    if pd is None or np is None:
        raise RuntimeError(
            "pandas and numpy are required to rebuild derived horizon rows from primary_active_nq_series.parquet"
        )


def _session_names_for_minutes(minutes: "pd.Series") -> list[list[str]]:
    names: list[list[str]] = []
    for minute in minutes:
        active = []
        for name, start, end in SESSIONS:
            if (start <= minute < end) if end > start else (minute >= start or minute < end):
                active.append(name)
        names.append(active)
    return names


def _explode_sessions(frame: "pd.DataFrame", time_column: str) -> "pd.DataFrame":
    local = frame[time_column].dt.tz_convert(NY)
    minutes = local.dt.hour * 60 + local.dt.minute
    exploded = frame.copy()
    exploded["session"] = _session_names_for_minutes(minutes)
    exploded = exploded.explode("session")
    return exploded.loc[exploded["session"].notna()].reset_index(drop=True)


def _compute_session_coverage(active: "pd.DataFrame") -> "pd.DataFrame":
    entries = active[["timestamp_utc", "trading_day", "data_condition"]].copy()
    entries["entry_time_utc"] = entries["timestamp_utc"] + pd.Timedelta(minutes=1)
    exploded = _explode_sessions(entries, "entry_time_utc")
    counts = (
        exploded.groupby(["session", "trading_day"], as_index=False)
        .agg(observed_minutes=("entry_time_utc", "nunique"))
    )
    expected = {name: (end - start if end > start else 1440 - start + end) for name, start, end in SESSIONS}
    counts["expected_minutes"] = counts["session"].map(expected)
    counts["coverage"] = counts["observed_minutes"] / counts["expected_minutes"]
    counts["eligible_95pct"] = (counts["coverage"] >= 0.95).astype(int)
    degraded_days = set(active.loc[active["data_condition"].eq("degraded"), "trading_day"])
    counts.loc[counts["trading_day"].isin(degraded_days), "eligible_95pct"] = 0
    return counts


def _compute_forward_mae(active: "pd.DataFrame", horizon: int, coverage: "pd.DataFrame") -> "pd.DataFrame":
    n = len(active)
    if n <= horizon:
        return pd.DataFrame()
    timestamps = active["timestamp_utc"].astype("int64").to_numpy()
    lows = active["low"].to_numpy(float)
    highs = active["high"].to_numpy(float)
    closes = active["close"].to_numpy(float)
    segment = active["segment_id"].to_numpy()
    days = active["trading_day"].to_numpy()
    atr = active["atr14"].to_numpy(float)

    forward_low = np.full(n, np.inf)
    forward_high = np.full(n, -np.inf)
    for offset in range(1, horizon + 1):
        length = n - offset
        forward_low[:length] = np.minimum(forward_low[:length], lows[offset:])
        forward_high[:length] = np.maximum(forward_high[:length], highs[offset:])

    valid_length = n - horizon
    base_index = np.arange(valid_length)
    end_index = base_index + horizon
    valid = (
        (timestamps[end_index] - timestamps[base_index] == horizon * MINUTE_NS)
        & (segment[end_index] == segment[base_index])
        & (days[end_index] == days[base_index])
        & np.isfinite(atr[:valid_length])
        & (atr[:valid_length] > 0)
    )
    idx = base_index[valid]
    result = pd.DataFrame({
        "entry_time_utc": pd.to_datetime(timestamps[idx] + MINUTE_NS, utc=True),
        "trading_day": days[idx],
        "canonical_contract": active["canonical_contract"].to_numpy()[idx],
        "entry_price": closes[idx],
        "atr14_points": atr[idx],
        "long_mae_points": np.maximum(0.0, closes[idx] - forward_low[idx]),
        "short_mae_points": np.maximum(0.0, forward_high[idx] - closes[idx]),
        "horizon_minutes": horizon,
    })
    result["entry_time_ny"] = result["entry_time_utc"].dt.tz_convert(NY)
    result = _explode_sessions(result, "entry_time_utc")
    eligibility = coverage.loc[
        coverage["eligible_95pct"].eq(1), ["session", "trading_day"]
    ].drop_duplicates()
    return result.merge(eligibility, on=["session", "trading_day"], how="inner", validate="many_to_one")


def _quantiles(values) -> dict[str, float]:
    array = np.asarray(values, dtype=float)
    array = array[np.isfinite(array)]
    if not len(array):
        return {"median": math.nan, "p80": math.nan, "p90": math.nan}
    estimates = np.quantile(array, [0.5, 0.8, 0.9], method="linear")
    return dict(zip(("median", "p80", "p90"), estimates, strict=True))


def _metric_values(group: "pd.DataFrame", direction: str, unit: str):
    if direction == "long":
        points = group["long_mae_points"].to_numpy(float)
        entry = group["entry_price"].to_numpy(float)
        atr = group["atr14_points"].to_numpy(float)
    elif direction == "short":
        points = group["short_mae_points"].to_numpy(float)
        entry = group["entry_price"].to_numpy(float)
        atr = group["atr14_points"].to_numpy(float)
    else:
        points = np.concatenate([group["long_mae_points"].to_numpy(float), group["short_mae_points"].to_numpy(float)])
        entry_base = group["entry_price"].to_numpy(float)
        atr_base = group["atr14_points"].to_numpy(float)
        entry = np.concatenate([entry_base, entry_base])
        atr = np.concatenate([atr_base, atr_base])
    if unit == "points":
        return points
    if unit == "basis_points":
        return points / entry * 10_000.0
    if unit == "mae_atr":
        return points / atr
    raise ValueError(unit)


def _stable_seed(seed: int, *parts: object) -> int:
    payload = "|".join([str(seed), *(str(part) for part in parts)])
    return int.from_bytes(hashlib.sha256(payload.encode()).digest()[:8], "big")


def _cluster_bootstrap_quantiles(values, day_labels, probabilities=(0.5, 0.8, 0.9), replications=10_000, seed=20_260_811):
    array = np.asarray(values, dtype=float)
    days = np.asarray(day_labels)
    finite = np.isfinite(array)
    array = array[finite]
    days = days[finite]
    unique_days, day_codes = np.unique(days, return_inverse=True)
    if len(array) == 0 or len(unique_days) < 2:
        return {p: (math.nan, math.nan, math.nan) for p in probabilities}
    n = len(array)
    estimates = np.quantile(array, probabilities, method="linear")
    q10, q90 = np.quantile(array, [0.1, 0.9], method="linear")
    contributions = np.zeros((len(unique_days), len(probabilities)), dtype=float)
    for column, (probability, estimate) in enumerate(zip(probabilities, estimates, strict=True)):
        bandwidth = max((q90 - q10) * n ** (-0.2) * 0.75, 1e-9)
        density = np.mean((array >= estimate - bandwidth) & (array <= estimate + bandwidth)) / (2.0 * bandwidth)
        if not np.isfinite(density) or density <= 0:
            density = 1.0 / max(q90 - q10, 1e-9)
        below = np.bincount(day_codes, weights=(array <= estimate).astype(float), minlength=len(unique_days))
        counts = np.bincount(day_codes, minlength=len(unique_days)).astype(float)
        contributions[:, column] = -(below - probability * counts) / (n * density)
    rng = np.random.default_rng(seed)
    replicates = np.empty((replications, len(probabilities)), dtype=float)
    for start in range(0, replications, 250):
        stop = min(start + 250, replications)
        weights = rng.poisson(1.0, size=(stop - start, len(unique_days))).astype(float)
        replicates[start:stop] = estimates + (weights - 1.0) @ contributions
    return {
        probability: (float(estimates[column]), *map(float, np.quantile(replicates[:, column], [0.025, 0.975])))
        for column, probability in enumerate(probabilities)
    }


def _period_labels(trading_days) -> "pd.DataFrame":
    days = pd.DatetimeIndex(pd.to_datetime(list(trading_days)))
    iso = days.isocalendar()
    return pd.DataFrame({
        "calendar_year": days.year.astype(int),
        "calendar_month_number": days.month.astype(int),
        "calendar_month_name": days.month_name(),
        "iso_year": np.asarray(iso.year, dtype=int),
        "iso_week_of_year": np.asarray(iso.week, dtype=int),
        "iso_week_label": [f"W{value:02d}" for value in np.asarray(iso.week, dtype=int)],
        "iso_year_week": [f"{year}-W{week:02d}" for year, week in zip(np.asarray(iso.year, dtype=int), np.asarray(iso.week, dtype=int), strict=True)],
    })


def _wide_stats(group: "pd.DataFrame", direction: str) -> dict[str, float]:
    output: dict[str, float] = {}
    for unit in ("points", "basis_points", "mae_atr"):
        values = _metric_values(group, direction, unit)
        for metric, value in _quantiles(values).items():
            output[f"{metric}_{unit}"] = value
    return output


def _build_metric_rows(obs: "pd.DataFrame", seed: int, reps: int) -> tuple[list[dict], list[dict]]:
    metrics: list[dict] = []
    cis: list[dict] = []
    for (horizon, session), group in obs.groupby(["horizon_minutes", "session"], sort=True):
        days_count = group["trading_day"].nunique()
        years = pd.DatetimeIndex(pd.to_datetime(group["trading_day"])).year.nunique()
        for direction in ("long", "short", "pooled"):
            day_base = group["trading_day"].to_numpy()
            for unit in ("points", "basis_points", "mae_atr"):
                values = _metric_values(group, direction, unit)
                labels = np.concatenate([day_base, day_base]) if direction == "pooled" else day_base
                row = _decorate({
                    "horizon": int(horizon),
                    "session": session,
                    "direction": direction,
                    "unit": unit,
                    "observations": len(values),
                    "days": int(days_count),
                    "years": int(years),
                    "p50": _quantiles(values)["median"],
                    "p80": _quantiles(values)["p80"],
                    "p90": _quantiles(values)["p90"],
                })
                metrics.append(row)
                if direction == "pooled":
                    intervals = _cluster_bootstrap_quantiles(
                        values, labels, replications=reps, seed=_stable_seed(seed, "session", horizon, session, unit)
                    )
                    for probability, name in ((0.5, "p50"), (0.8, "p80"), (0.9, "p90")):
                        estimate, low, high = intervals[probability]
                        cis.append(_decorate({
                            "horizon": int(horizon),
                            "session": session,
                            "direction": direction,
                            "unit": unit,
                            "metric": name,
                            "estimate": estimate,
                            "low": low,
                            "high": high,
                            "observations": len(values),
                            "days": int(days_count),
                            "years": int(years),
                        }))
    return metrics, cis


def _build_seasonal_rows(obs: "pd.DataFrame", seed: int, reps: int) -> tuple[list[dict], list[dict], list[dict]]:
    frame = pd.concat([obs.reset_index(drop=True), _period_labels(obs["trading_day"])], axis=1)
    seasonal: list[dict] = []
    seasonal_ci: list[dict] = []
    chronological: list[dict] = []
    specs = (
        ("month", "calendar_month_of_trading_day", "calendar_month_name", "calendar_month_number", "calendar_year"),
        ("week", "iso_week_of_year_across_years", "iso_week_label", "iso_week_of_year", "iso_year"),
        ("iso_year_week", "iso_year_week", "iso_year_week", "iso_year_week", "iso_year"),
    )
    for output_type, period_type, label_col, order_col, year_col in specs:
        for (horizon, session, period), group in frame.groupby(["horizon_minutes", "session", label_col], sort=True):
            days_count = group["trading_day"].nunique()
            years = group[year_col].nunique()
            order = str(period) if output_type == "iso_year_week" else int(group[order_col].iloc[0])
            if output_type == "iso_year_week":
                points = _metric_values(group, "pooled", "points")
                atr = _metric_values(group, "pooled", "mae_atr")
                chronological.append(_decorate({
                    "week": str(period),
                    "session": session,
                    "horizon": int(horizon),
                    "days": int(days_count),
                    "years": int(years),
                    "p80Points": _quantiles(points)["p80"],
                    "p80Atr": _quantiles(atr)["p80"],
                }))
                continue
            for direction in ("long", "short", "pooled"):
                stats = _wide_stats(group, direction)
                seasonal.append(_decorate({
                    "periodType": output_type,
                    "period": str(period),
                    "order": int(order),
                    "horizon": int(horizon),
                    "session": session,
                    "direction": direction,
                    "observations": len(group) * (2 if direction == "pooled" else 1),
                    "days": int(days_count),
                    "years": int(years),
                    "sampleBand": "40+" if days_count >= 40 else ("20-39" if days_count >= 20 else "<20"),
                    "firstTradingDay": str(min(group["trading_day"])),
                    "lastTradingDay": str(max(group["trading_day"])),
                    "p50Points": stats["median_points"],
                    "p80Points": stats["p80_points"],
                    "p90Points": stats["p90_points"],
                    "p50Atr": stats["median_mae_atr"],
                    "p80Atr": stats["p80_mae_atr"],
                    "p90Atr": stats["p90_mae_atr"],
                }))
            pooled_days = np.concatenate([group["trading_day"].to_numpy()] * 2)
            for unit in ("mae_atr", "points"):
                values = _metric_values(group, "pooled", unit)
                intervals = _cluster_bootstrap_quantiles(
                    values, pooled_days, replications=reps, seed=_stable_seed(seed, "seasonal", period_type, horizon, session, period, unit)
                )
                for probability, metric in ((0.5, "p50"), (0.8, "p80"), (0.9, "p90")):
                    estimate, low, high = intervals[probability]
                    seasonal_ci.append(_decorate({
                        "periodType": output_type,
                        "period": str(period),
                        "order": int(order),
                        "horizon": int(horizon),
                        "session": session,
                        "direction": "pooled",
                        "unit": unit,
                        "metric": metric,
                        "estimate": estimate,
                        "low": low,
                        "high": high,
                        "observations": len(values),
                        "days": int(days_count),
                        "years": int(years),
                    }))
    seasonal.sort(key=lambda row: (row["periodType"], row["order"], SESSION_ORDER[row["session"]], row["horizon"], row["direction"]))
    seasonal_ci.sort(key=lambda row: (row["periodType"], row["order"], SESSION_ORDER[row["session"]], row["horizon"], row["unit"], row["metric"]))
    chronological.sort(key=lambda row: (row["week"], SESSION_ORDER[row["session"]], row["horizon"]))
    return seasonal, seasonal_ci, chronological


def _build_rolling(obs: "pd.DataFrame") -> list[dict]:
    rows: list[dict] = []
    for (horizon, session), group in obs.groupby(["horizon_minutes", "session"], sort=True):
        pooled = pd.concat([
            group[["trading_day", "long_mae_points", "atr14_points"]].rename(columns={"long_mae_points": "points"}),
            group[["trading_day", "short_mae_points", "atr14_points"]].rename(columns={"short_mae_points": "points"}),
        ], ignore_index=True)
        pooled["trading_day"] = pd.to_datetime(pooled["trading_day"])
        pooled["mae_atr"] = pooled["points"] / pooled["atr14_points"]
        daily = pooled.groupby("trading_day", as_index=False)["mae_atr"].quantile(0.8)
        if len(daily) < 60:
            continue
        for index in range(59, len(daily)):
            if (index - 59) % 5 != 0 and index != len(daily) - 1:
                continue
            value = daily.iloc[index - 59:index + 1]["mae_atr"].quantile(0.8)
            rows.append(_decorate({
                "date": daily.iloc[index]["trading_day"].strftime("%Y-%m-%d"),
                "session": session,
                "horizon": int(horizon),
                "value": float(value),
            }))
    return rows


def _build_cash_open(obs: "pd.DataFrame") -> list[dict]:
    local = obs["entry_time_ny"]
    minute = local.dt.hour * 60 + local.dt.minute
    unique = obs.loc[(minute >= 8 * 60 + 30) & (minute < 11 * 60 + 30)].drop_duplicates(
        ["entry_time_utc", "canonical_contract", "horizon_minutes"]
    ).copy()
    bin_start = (unique["entry_time_ny"].dt.hour * 60 + unique["entry_time_ny"].dt.minute) // 5 * 5
    unique["bin_start_ny"] = bin_start.map(lambda x: f"{x // 60:02d}:{x % 60:02d}")
    rows: list[dict] = []
    for (horizon, bin_name), group in unique.groupby(["horizon_minutes", "bin_start_ny"], sort=True):
        for unit in ("points", "basis_points", "mae_atr"):
            values = _metric_values(group, "pooled", unit)
            stats = _quantiles(values)
            rows.append(_decorate({
                "horizon": int(horizon),
                "time": bin_name,
                "unit": unit,
                "observations": len(values),
                "days": int(group["trading_day"].nunique()),
                "p50": stats["median"],
                "p80": stats["p80"],
                "p90": stats["p90"],
            }))
    return rows


def _load_or_build_primary_active(source: Path) -> "pd.DataFrame":
    _require_analysis_libs()
    active_path = source / "primary_active_nq_series.parquet"
    if active_path.exists():
        active = pd.read_parquet(active_path).sort_values("timestamp_utc").reset_index(drop=True)
    else:
        canonical_path = source / "canonical_outright_contracts.parquet"
        if not canonical_path.exists():
            raise RuntimeError(f"{active_path} or {canonical_path} is required to generate {SUPPORTED_HORIZONS} minute horizons")
        from analysis_nq_long_history.core import (
            aggregate_contract_volume,
            build_roll_selections,
            construct_active_series,
            wilder_atr_by_segment,
        )

        outright = pd.read_parquet(canonical_path).sort_values("timestamp_utc").reset_index(drop=True)
        outright["timestamp_utc"] = pd.to_datetime(outright["timestamp_utc"], utc=True)
        outright["timestamp_ny"] = pd.to_datetime(outright["timestamp_ny"], utc=True).dt.tz_convert(NY)
        outright["trading_day"] = pd.to_datetime(outright["trading_day"]).dt.date
        outright["mapping_start"] = pd.to_datetime(outright["mapping_start"]).dt.date
        outright["mapping_end_exclusive"] = pd.to_datetime(outright["mapping_end_exclusive"]).dt.date
        outright["expiry_date"] = pd.to_datetime(outright["expiry_date"]).dt.date
        daily_volume = aggregate_contract_volume(outright)
        selections = build_roll_selections(daily_volume, "confirmed_volume_crossover")
        active = construct_active_series(outright, selections)
        active["atr14"] = wilder_atr_by_segment(
            active["high"], active["low"], active["close"], active["segment_id"]
        )
        active[
            ["timestamp_utc", "timestamp_ny", "trading_day", "instrument_id", "canonical_contract", "raw_symbol", "open", "high", "low", "close", "volume", "data_condition", "atr14", "segment_id"]
        ].to_parquet(active_path, index=False, compression="zstd")
    return active


def build_horizon_extract(source: Path, seed: int, reps: int) -> dict[str, list[dict]]:
    active = _load_or_build_primary_active(source)
    active["timestamp_utc"] = pd.to_datetime(active["timestamp_utc"], utc=True)
    active["trading_day"] = pd.to_datetime(active["trading_day"]).dt.date
    coverage = _compute_session_coverage(active)
    obs = pd.concat([_compute_forward_mae(active, horizon, coverage) for horizon in SUPPORTED_HORIZONS], ignore_index=True)
    session_metrics, session_ci = _build_metric_rows(obs, seed, reps)
    seasonal, seasonal_ci, chronological = _build_seasonal_rows(obs, seed, reps)
    return {
        "seasonal": seasonal,
        "seasonalCI": seasonal_ci,
        "sessionMetrics": session_metrics,
        "sessionCI": session_ci,
        "chronological": chronological,
        "rolling": _build_rolling(obs),
        "cashOpen": _build_cash_open(obs),
    }


def verify_outputs(source: Path) -> tuple[str, dict[str, str]]:
    manifest_path = source / "generated_output_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {row["path"]: row["sha256"] for row in manifest["files"]}
    checks: dict[str, str] = {}
    for filename in sorted(SELECTED_FILES - {"generated_output_manifest.json", "source_manifest.json"}):
        if filename not in expected:
            raise RuntimeError(f"{filename} is absent from generated_output_manifest.json")
        actual = sha256(source / filename)
        if actual != expected[filename]:
            raise RuntimeError(f"Hash mismatch for {filename}")
        checks[filename] = actual
    return sha256(manifest_path), checks


def json_ready(value):
    if np is not None:
        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            as_float = float(value)
            return as_float if math.isfinite(as_float) else None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def build(source: Path, bootstrap_reps: int | None = None, previous_payload: dict | None = None) -> dict:
    manifest_path = source / "generated_output_manifest.json"
    has_controlled_csvs = manifest_path.exists()
    if has_controlled_csvs:
        manifest_hash, verified = verify_outputs(source)
        output_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest_hash = sha256(source / "source_manifest.json") if (source / "source_manifest.json").exists() else ""
        verified = {}
        output_manifest = previous_payload.get("meta", {}) if previous_payload else {}
    source_manifest = json.loads((source / "source_manifest.json").read_text(encoding="utf-8"))
    raw_dbn = next(row for row in source_manifest["files"] if row["source_rank"] == 1 and row["path"].endswith(".dbn"))

    seasonal = []
    if has_controlled_csvs:
        for row in read_csv(source / "stop_loss_volatility_reference.csv"):
            seasonal.append({
                "sourceId": row["source_id"],
                "dataInstrument": "NQ",
                "sourceRank": 1,
                "fallbackReason": "",
                "reconciliationStatus": "primary long-history source; MNQ/US100 fallback not used",
                "periodType": "month" if row["period_type"].startswith("calendar") else "week",
                "period": row["period"],
                "order": number(row["period_order"], True),
                "horizon": number(row["horizon_minutes"], True),
                "session": row["session"],
                "direction": row["direction"],
                "observations": number(row["observations"], True),
                "days": number(row["eligible_trading_days"], True),
                "years": number(row["years_represented"], True),
                "sampleBand": row["sample_days_band"],
                "p50Points": number(row["median_points"]),
                "p80Points": number(row["p80_points"]),
                "p90Points": number(row["p90_points"]),
                "p50Atr": number(row["median_mae_atr"]),
                "p80Atr": number(row["p80_mae_atr"]),
                "p90Atr": number(row["p90_mae_atr"]),
            })

    seasonal_ci = []
    if has_controlled_csvs:
        for row in read_csv(source / "seasonal_bootstrap_confidence_intervals.csv"):
            if row["metric"] not in {"p50", "p80", "p90"}:
                continue
            seasonal_ci.append({
                "sourceId": row["source_id"],
                "periodType": "month" if row["period_type"].startswith("calendar") else "week",
                "period": row["period"],
                "order": number(row["period_order"], True),
                "horizon": number(row["horizon_minutes"], True),
                "session": row["session"],
                "direction": row["direction"],
                "unit": row["unit"],
                "metric": row["metric"],
                "estimate": number(row["estimate"]),
                "low": number(row["ci_95_low"]),
                "high": number(row["ci_95_high"]),
                "observations": number(row["observations"], True),
                "days": number(row["eligible_trading_days"], True),
            })

    session_metrics = []
    if has_controlled_csvs:
        for row in read_csv(source / "atr_mae_metrics.csv"):
            if row["source_id"] != "NQ_long_history" or row["roll_rule"] != "confirmed_volume_crossover" or number(row["horizon_minutes"], True) not in SUPPORTED_HORIZONS:
                continue
            session_metrics.append({
                "sourceId": row["source_id"],
                "dataInstrument": "NQ",
                "sourceRank": 1,
                "horizon": number(row["horizon_minutes"], True),
                "session": row["session"],
                "direction": row["direction"],
                "unit": row["unit"],
                "observations": number(row["observations"], True),
                "days": number(row["eligible_trading_days"], True),
                "p50": number(row["median"]),
                "p80": number(row["p80"]),
                "p90": number(row["p90"]),
            })

    session_ci = []
    if has_controlled_csvs:
        for row in read_csv(source / "bootstrap_confidence_intervals.csv"):
            if row["source_id"] != "NQ_long_history" or row["roll_rule"] != "confirmed_volume_crossover" or number(row["horizon_minutes"], True) not in SUPPORTED_HORIZONS or row["direction"] != "pooled" or row["metric"] not in {"p50", "p80", "p90"}:
                continue
            session_ci.append({
                "sourceId": row["source_id"],
                "horizon": number(row["horizon_minutes"], True),
                "session": row["session"],
                "unit": row["unit"],
                "metric": row["metric"],
                "estimate": number(row["estimate"]),
                "low": number(row["ci_95_low"]),
                "high": number(row["ci_95_high"]),
            })

    chronological = []
    if has_controlled_csvs:
        for row in read_csv(source / "iso_year_week_splits.csv"):
            if number(row["horizon_minutes"], True) not in SUPPORTED_HORIZONS or row["direction"] != "pooled":
                continue
            chronological.append({
                "horizon": number(row["horizon_minutes"], True),
                "week": row["period"],
                "session": row["session"],
                "days": number(row["eligible_trading_days"], True),
                "p80Points": number(row["p80_points"]),
                "p80Atr": number(row["p80_mae_atr"]),
            })

    rolling_groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    if has_controlled_csvs:
        for row in read_csv(source / "rolling_20_60_session_stability.csv"):
            if number(row["horizon_minutes"], True) in SUPPORTED_HORIZONS and row["window_sessions"] == "60" and row["metric"] == "daily_p80_mae_atr":
                rolling_groups[(row["session"], row["metric"], row["horizon_minutes"])].append(row)
    rolling = []
    for rows in rolling_groups.values():
        for index, row in enumerate(rows):
            if index % 5 == 0 or index == len(rows) - 1:
                rolling.append({
                    "horizon": number(row["horizon_minutes"], True),
                    "date": row["end_trading_day"][:10],
                    "session": row["session"],
                    "value": number(row["value"]),
                })

    cash_open = [{
        "horizon": number(row["horizon_minutes"], True),
        "time": row["bin_start_ny"],
        "unit": row["unit"],
        "observations": number(row["observations"], True),
        "days": number(row["eligible_trading_days"], True),
        "p50": number(row["median"]),
        "p80": number(row["p80"]),
        "p90": number(row["p90"]),
    } for row in read_csv(source / "cash_open_5m_bins.csv")] if has_controlled_csvs else []

    # A complete controlled pipeline run is authoritative. Recompute directly
    # from the primary series only while a run is still incomplete.
    if not has_controlled_csvs:
        horizon_extract = build_horizon_extract(
            source,
            seed=output_manifest.get("seed", 20_260_811),
            reps=bootstrap_reps or output_manifest.get("bootstrap_replications", 10_000),
        )
        seasonal = horizon_extract["seasonal"]
        seasonal_ci = horizon_extract["seasonalCI"]
        session_metrics = horizon_extract["sessionMetrics"]
        session_ci = horizon_extract["sessionCI"]
        chronological = horizon_extract["chronological"]
        rolling = horizon_extract["rolling"]
        cash_open = horizon_extract["cashOpen"]

    if has_controlled_csvs:
        execution = [{
            "metric": row["metric"],
            "probability": number(row["probability"]),
            "estimate": number(row["estimate"]),
            "low": number(row["ci_95_low"]),
            "high": number(row["ci_95_high"]),
            "unit": row["unit"],
        } for row in read_csv(source / "execution_bootstrap_confidence_intervals.csv")]

        risk_compatibility = [{
            "quantity": number(row["actual_mnq_qty"], True),
            "records": number(row["losing_execution_records"], True),
            "maximumStop": number(row["maximum_stop_points_under_150"]),
            "medianDistance": number(row["median_losing_distance_points"]),
            "p90Distance": number(row["p90_losing_distance_points"]),
            "compatibilityRate": number(row["compatibility_rate"]),
        } for row in read_csv(source / "risk_150_compatibility.csv") if row["actual_mnq_qty"].isdigit()]

        thesis = [{
            "gapMinutes": number(row["gap_minutes"], True),
            "groups": number(row["thesis_groups"], True),
            "losingGroups": number(row["losing_thesis_groups"], True),
            "medianNetPnl": number(row["median_net_pnl"]),
            "p90MinimumObservedRisk": number(row["p90_minimum_observed_idea_risk"]),
            "maxCumulativeQuantity": number(row["max_cumulative_round_trip_qty"], True),
            "maxLiveSize": number(row["max_live_size"], True),
        } for row in read_csv(source / "thesis_grouping_summary.csv")]

        account_days = [{
            "account": row["account"],
            "day": row["trading_day"],
            "records": number(row["matched_execution_records"], True),
            "netPnl": number(row["final_net_pnl"]),
            "worstRealizedPnl": number(row["worst_intraday_realized_pnl"]),
            "maxLiveContracts": number(row["maximum_live_contracts"], True),
        } for row in read_csv(source / "account_day_summary.csv")]

        after_loss = [{
            "metric": row["metric"],
            "days": number(row["account_days_with_observation"], True),
            "sumPnl": number(row["sum_pnl"]),
            "meanPnl": number(row["mean_pnl"]),
            "medianPnl": number(row["median_pnl"]),
            "positiveFraction": number(row["positive_fraction"]),
        } for row in read_csv(source / "performance_after_loss_summary.csv")]

        overlap = []
        for row in read_csv(source / "nq_mnq_overlap_comparison.csv"):
            if row["horizon_minutes"] == "5" and row["direction"] == "pooled" and row["unit"] in {"points", "mae_atr"}:
                overlap.append({
                    "session": row["session"],
                    "unit": row["unit"],
                    "days": number(row["eligible_trading_days_nq"], True),
                    "nqP80": number(row["p80_nq"]),
                    "mnqP80": number(row["p80_mnq"]),
                    "ratio": number(row["p80_nq_to_mnq_ratio"]),
                })

        claims = [{
            "id": row["claim_id"],
            "classification": row["classification"],
            "claim": row["claim"],
            "source": row["source"],
            "sample": row["sample_size"],
            "method": row["methodology"],
        } for row in read_csv(source / "claim_evidence_register.csv")]

        quality = [{
            "id": row["register_id"],
            "scope": row["scope"],
            "metric": row["metric"],
            "value": row["value"],
            "status": row["status"],
            "notes": row["notes"],
        } for row in read_csv(source / "data_quality_register.csv")]
    elif previous_payload:
        execution = previous_payload.get("execution", [])
        risk_compatibility = previous_payload.get("riskCompatibility", [])
        thesis = previous_payload.get("thesis", [])
        account_days = previous_payload.get("accountDays", [])
        after_loss = previous_payload.get("afterLoss", [])
        overlap = previous_payload.get("overlap", [])
        claims = previous_payload.get("claims", [])
        quality = previous_payload.get("quality", [])
    else:
        raise RuntimeError("Controlled CSVs are missing and no previous dashboard JSON is available for auxiliary sections.")

    generated_at = output_manifest.get("generated_at_utc") or output_manifest.get("generatedAt") or output_manifest.get("analysisGeneratedAt")
    if not generated_at:
        generated_at = pd.Timestamp.now(tz=timezone.utc).isoformat() if pd is not None else ""
    overlap_days = [row["days"] for row in overlap if row.get("days") is not None]
    overlap_ratios = [row["ratio"] for row in overlap if row.get("ratio") is not None]
    fallback_comparability = {
        "pair": "NQ/MNQ",
        "validationHorizonMinutes": 5,
        "commonDaysMinimum": min(overlap_days) if overlap_days else 0,
        "commonDaysMaximum": max(overlap_days) if overlap_days else 0,
        "p80RatioMinimum": min(overlap_ratios) if overlap_ratios else None,
        "p80RatioMaximum": max(overlap_ratios) if overlap_ratios else None,
        "status": "limited overlap validation; fallback must remain explicitly labelled",
        "us100Status": "no controlled US100 source supplied",
    }

    return {
        "meta": {
            "generatedAt": generated_at,
            "analysisGeneratedAt": generated_at,
            "analysisManifestSha256": manifest_hash,
            "rawDbnSha256": raw_dbn["sha256"],
            "primaryActiveSeriesSha256": sha256(source / "primary_active_nq_series.parquet"),
            "records": 6_486_332,
            "firstTimestamp": "2010-06-06",
            "lastTimestamp": "2026-08-11",
            "timezone": "America/New_York",
            "bootstrapReplications": bootstrap_reps or 10_000,
            "seed": 20_260_811,
            "verifiedFiles": len(verified),
            "disclaimer": "Historical market-noise context only. This does not define a strategy stop, forecast, trading signal or optimal position size.",
            "supportedHorizons": sorted(SUPPORTED_HORIZONS),
            "defaultHorizon": 5,
            "dataSourceFallback": DATA_SOURCE_FALLBACK,
            "fallbackComparability": fallback_comparability,
            "activeDataSource": _source_metadata(),
            "tradingInstruments": {
                "MNQ": {"dollarsPerPoint": 2, "defaultCostPerSide": 0.5, "defaultRoundTripCost": 1.0},
                "NQ": {"dollarsPerPoint": 20, "defaultCostPerSide": 1.75, "defaultRoundTripCost": 3.5},
            },
        },
        "seasonal": seasonal,
        "seasonalCI": seasonal_ci,
        "sessionMetrics": session_metrics,
        "sessionCI": session_ci,
        "chronological": chronological,
        "rolling": rolling,
        "cashOpen": cash_open,
        "execution": execution,
        "riskCompatibility": risk_compatibility,
        "thesis": thesis,
        "accountDays": account_days,
        "afterLoss": after_loss,
        "overlap": overlap,
        "claims": claims,
        "quality": quality,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    workspace = Path(__file__).resolve().parents[2]
    horizon_source = workspace / "nq_long_history_outputs_horizons"
    default_source = horizon_source if (horizon_source / "generated_output_manifest.json").exists() else workspace / "nq_long_history_outputs"
    parser.add_argument("--source", type=Path, default=default_source)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data" / "dashboard-data.json")
    parser.add_argument("--bootstrap-reps", type=int, default=None)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    previous_payload = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else None
    payload = build(args.source.resolve(), bootstrap_reps=args.bootstrap_reps, previous_payload=previous_payload)
    args.output.write_text(json.dumps(json_ready(payload), separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
