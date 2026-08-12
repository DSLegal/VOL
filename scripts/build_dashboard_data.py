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
from collections import defaultdict
from pathlib import Path


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


def build(source: Path) -> dict:
    manifest_hash, verified = verify_outputs(source)
    source_manifest = json.loads((source / "source_manifest.json").read_text(encoding="utf-8"))
    output_manifest = json.loads((source / "generated_output_manifest.json").read_text(encoding="utf-8"))
    raw_dbn = next(row for row in source_manifest["files"] if row["source_rank"] == 1 and row["path"].endswith(".dbn"))

    seasonal = []
    for row in read_csv(source / "stop_loss_volatility_reference.csv"):
        seasonal.append({
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
    for row in read_csv(source / "seasonal_bootstrap_confidence_intervals.csv"):
        if row["metric"] != "p80":
            continue
        seasonal_ci.append({
            "periodType": "month" if row["period_type"].startswith("calendar") else "week",
            "period": row["period"],
            "order": number(row["period_order"], True),
            "horizon": number(row["horizon_minutes"], True),
            "session": row["session"],
            "unit": row["unit"],
            "estimate": number(row["estimate"]),
            "low": number(row["ci_95_low"]),
            "high": number(row["ci_95_high"]),
            "observations": number(row["observations"], True),
            "days": number(row["eligible_trading_days"], True),
        })

    session_metrics = []
    for row in read_csv(source / "atr_mae_metrics.csv"):
        if row["source_id"] != "NQ_long_history" or row["roll_rule"] != "confirmed_volume_crossover" or row["horizon_minutes"] not in {"5", "10"}:
            continue
        session_metrics.append({
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
    for row in read_csv(source / "bootstrap_confidence_intervals.csv"):
        if row["source_id"] != "NQ_long_history" or row["roll_rule"] != "confirmed_volume_crossover" or row["horizon_minutes"] not in {"5", "10"} or row["direction"] != "pooled" or row["metric"] != "p80":
            continue
        session_ci.append({
            "horizon": number(row["horizon_minutes"], True),
            "session": row["session"],
            "unit": row["unit"],
            "estimate": number(row["estimate"]),
            "low": number(row["ci_95_low"]),
            "high": number(row["ci_95_high"]),
        })

    chronological = []
    for row in read_csv(source / "iso_year_week_splits.csv"):
        if row["horizon_minutes"] != "5" or row["direction"] != "pooled":
            continue
        chronological.append({
            "week": row["period"],
            "session": row["session"],
            "days": number(row["eligible_trading_days"], True),
            "p80Points": number(row["p80_points"]),
            "p80Atr": number(row["p80_mae_atr"]),
        })

    rolling_groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in read_csv(source / "rolling_20_60_session_stability.csv"):
        if row["horizon_minutes"] == "5" and row["window_sessions"] == "60" and row["metric"] == "daily_p80_mae_atr":
            rolling_groups[(row["session"], row["metric"])].append(row)
    rolling = []
    for rows in rolling_groups.values():
        for index, row in enumerate(rows):
            if index % 5 == 0 or index == len(rows) - 1:
                rolling.append({
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
    } for row in read_csv(source / "cash_open_5m_bins.csv")]

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

    return {
        "meta": {
            "generatedAt": output_manifest["generated_at_utc"],
            "analysisGeneratedAt": output_manifest["generated_at_utc"],
            "analysisManifestSha256": manifest_hash,
            "rawDbnSha256": raw_dbn["sha256"],
            "records": 6_486_332,
            "firstTimestamp": "2010-06-06",
            "lastTimestamp": "2026-08-11",
            "timezone": "America/New_York",
            "bootstrapReplications": 10_000,
            "seed": 20_260_811,
            "verifiedFiles": len(verified),
            "disclaimer": "Historical market-noise context only. This does not define a strategy stop, forecast, trading signal or optimal position size.",
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
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2] / "nq_long_history_outputs")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data" / "dashboard-data.json")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = build(args.source.resolve())
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
