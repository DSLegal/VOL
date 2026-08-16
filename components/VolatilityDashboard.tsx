"use client";

import { useEffect, useMemo, useState } from "react";
import { SUPPORTED_HORIZONS, TRADING_INSTRUMENTS, calculatePlannedRisk, resolveHoldingHorizon, selectDataSource } from "./dashboard-math.mjs";

type View = "planner" | "patterns" | "method";
type Side = "long" | "short";
type TradingInstrument = "MNQ" | "NQ";
type Metric = "p50" | "p80" | "p90";

type SeasonalRow = {
  sourceId: string;
  dataInstrument: "NQ" | "MNQ" | "US100";
  sourceRank: number;
  periodType: "month" | "week";
  period: string;
  order: number;
  horizon: number;
  session: string;
  direction: "long" | "short" | "pooled";
  observations: number;
  days: number;
  p50Points: number;
  p80Points: number;
  p90Points: number;
};

type DashboardData = {
  meta: {
    records: number;
    firstTimestamp: string;
    lastTimestamp: string;
    timezone: string;
    bootstrapReplications: number;
    seed: number;
    verifiedFiles: number;
    disclaimer: string;
    analysisManifestSha256: string;
    rawDbnSha256: string;
    supportedHorizons?: number[];
    defaultHorizon?: number;
    activeDataSource?: { dataInstrument: string; sourceId: string };
    dataSourceFallback?: Array<{ instrument: string; sourceId: string; rank: number; status: string; available: boolean; notes: string; provider?: string; validated?: boolean; comparabilityApproved?: boolean }>;
    fallbackComparability?: { pair: string; validationHorizonMinutes: number; commonDaysMinimum: number; commonDaysMaximum: number; status: string; us100Status: string };
    tradingInstruments?: Record<TradingInstrument, { dollarsPerPoint: number; defaultCostPerSide: number }>;
  };
  seasonal: SeasonalRow[];
  seasonalCI: Array<{ periodType: "month" | "week"; period: string; horizon: number; session: string; direction?: string; unit: "points" | "mae_atr"; metric: Metric; estimate: number; low: number; high: number; observations?: number; days: number }>;
  sessionCI?: Array<{ horizon: number; session: string; unit: "points" | "mae_atr" | "basis_points"; metric: Metric; estimate: number; low: number; high: number }>;
  sessionMetrics?: Array<{ horizon: number; session: string; direction: string; unit: "points" | "mae_atr" | "basis_points"; days: number; p50: number; p80: number; p90: number }>;
  claims?: Array<{ id: string; classification: string; claim: string; source: string; sample: string; method: string }>;
  quality?: Array<{ id: string; scope: string; metric: string; value: string; status: string; notes: string }>;
};

const NAV: Array<{ id: View; label: string }> = [
  { id: "planner", label: "Trade Planner" },
  { id: "patterns", label: "Historical Patterns" },
  { id: "method", label: "Data & Method" },
];

const SESSIONS = ["Asia KZ", "London KZ", "Pre-Market OR", "08:30 OR", "NY AM OR", "NY AM SB", "NY Lunch", "NY PM KZ", "NY 1st DR"];
const SESSION_LABELS: Record<string, string> = {
  "Asia KZ": "Asia window · 20:00–00:00 New York",
  "London KZ": "London window · 02:00–05:00 New York",
  "Pre-Market OR": "Pre-market opening range · 07:00–07:30 New York",
  "08:30 OR": "08:30 opening range · 08:30–09:30 New York",
  "NY AM OR": "New York morning opening range · 09:30–10:00 New York",
  "NY AM SB": "New York morning session · 10:00–11:00 New York",
  "NY Lunch": "New York lunch · 11:30–13:30 New York",
  "NY PM KZ": "New York afternoon · 13:30–16:00 New York",
  "NY 1st DR": "New York first dealing range · 09:30–10:30 New York",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const currentNewYorkMonth = () => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "America/New_York" }).format(new Date());
const fmt = (value: number, digits = 2) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const parseInput = (value: string) => value.trim() === "" ? null : Number(value);
const isPositive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0;
const isNonNegative = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0;
const isQuarterPoint = (value: number | null) => value !== null && Number.isFinite(value) && Math.abs(value * 4 - Math.round(value * 4)) < 0.000001;
const nearestTick = (value: number | null) => value === null || !Number.isFinite(value) ? "" : fmt(Math.round(value * 4) / 4, 2);

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" className={value === option.value ? "active" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

function Field({ label, hint, error, children }: { label: React.ReactNode; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="planner-field"><span>{label}</span>{children}{error ? <small className="field-error" role="alert">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}

function preferredRows(rows: SeasonalRow[]) {
  const preferred = new Map<string, SeasonalRow>();
  for (const row of rows) {
    const key = `${row.periodType}|${row.period}|${row.session}|${row.horizon}|${row.direction}`;
    const current = preferred.get(key);
    if (!current || row.sourceRank < current.sourceRank) preferred.set(key, row);
  }
  return [...preferred.values()];
}

function QuantileScale({ row, invalidationDistance }: { row: SeasonalRow; invalidationDistance: number }) {
  const max = Math.max(row.p90Points * 1.15, invalidationDistance * 1.12, 1);
  const pct = (value: number) => `${Math.min(100, Math.max(0, value / max * 100))}%`;
  return <div className="scale-card" aria-label="Historical adverse movement comparison">
    <div className="scale-track">
      {([{ label: "P50", value: row.p50Points }, { label: "P80", value: row.p80Points }, { label: "P90", value: row.p90Points }] as const).map(point => <span key={point.label} className="scale-marker" style={{ left: pct(point.value) }}><b>{point.label}</b><em>{fmt(point.value, 1)} pts</em></span>)}
      <span className="trade-marker" style={{ left: pct(invalidationDistance) }}><b>Your invalidation</b><em>{fmt(invalidationDistance, 1)} pts</em></span>
    </div>
    <div className="scale-axis"><span>0 pts</span><span>{fmt(max, 1)} pts</span></div>
  </div>;
}

type ConfidenceReference = { estimate: number; low: number; high: number; days?: number; scope: "context" | "broader" };

function QuantileCard({ q, value, observations, ci }: { q: 50 | 80 | 90; value: number; observations: number; ci: ConfidenceReference | null }) {
  const atOrBelow = Math.round(observations * q / 100);
  const above = Math.max(0, observations - atOrBelow);
  const text = q === 50 ? "Half of matching observations stayed within this distance; half moved farther." : q === 80 ? "Eight in ten stayed within this distance; two in ten moved farther." : "Nine in ten stayed within this distance; one in ten moved farther.";
  return <article className="quantile-card">
    <span>{q}% historical reference</span>
    <strong>{fmt(value, 1)} pts</strong>
    <small>{text}</small>
    <em>{ci?.scope === "context" ? `Context-specific 95% uncertainty interval ${fmt(ci.low, 1)} to ${fmt(ci.high, 1)} points. ${atOrBelow.toLocaleString("en-GB")} at or below; ${above.toLocaleString("en-GB")} above. Sample ${ci.days} days.` : ci ? `This directional month slice has no context-specific interval. The broader all-month, pooled-direction ${q}% estimate is ${fmt(ci.estimate, 1)} points with a 95% interval of ${fmt(ci.low, 1)} to ${fmt(ci.high, 1)}. ${atOrBelow.toLocaleString("en-GB")} selected observations were at or below; ${above.toLocaleString("en-GB")} were above.` : `No confidence interval was produced for this selected context. ${atOrBelow.toLocaleString("en-GB")} at or below; ${above.toLocaleString("en-GB")} above.`}</em>
  </article>;
}

export default function VolatilityDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [researchData, setResearchData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [researchError, setResearchError] = useState("");
  const [view, setView] = useState<View>("planner");
  const [instrument, setInstrument] = useState<TradingInstrument>("MNQ");
  const [side, setSide] = useState<Side>("long");
  const [entry, setEntry] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [quantity, setQuantity] = useState("");
  const [riskLimit, setRiskLimit] = useState("");
  const [existingRisk, setExistingRisk] = useState("");
  const [session, setSession] = useState("NY AM OR");
  const [period, setPeriod] = useState(currentNewYorkMonth);
  const [holdingTime, setHoldingTime] = useState("5");
  const [confirmedHorizon, setConfirmedHorizon] = useState<number | null>(5);
  const [mnqCost, setMnqCost] = useState("0.5");
  const [nqCost, setNqCost] = useState("1.75");
  const [slippagePoints, setSlippagePoints] = useState("0");

  useEffect(() => {
    fetch("./data/planner-data.json")
      .then(response => {
        if (response.ok) return response.json();
        return fetch("./data/dashboard-data.json").then(fallback => {
          if (!fallback.ok) throw new Error(`Data returned ${fallback.status}`);
          return fallback.json();
        });
      })
      .then(setData)
      .catch(error => setLoadError(error instanceof Error ? error.message : "Unable to load data"));
  }, []);

  useEffect(() => {
    if (view === "planner" || researchData || researchError) return;
    fetch("./data/dashboard-data.json")
      .then(response => { if (!response.ok) throw new Error(`Research data returned ${response.status}`); return response.json(); })
      .then(setResearchData)
      .catch(error => setResearchError(error instanceof Error ? error.message : "Unable to load research data"));
  }, [view, researchData, researchError]);

  const rows = useMemo(() => preferredRows(data?.seasonal ?? []), [data]);
  const availableHorizons = useMemo(() => {
    const horizons = [...new Set(rows.map(row => row.horizon))].sort((a, b) => a - b);
    return horizons.length ? horizons : [...SUPPORTED_HORIZONS];
  }, [rows]);
  const horizonResolution = resolveHoldingHorizon(parseInput(holdingTime) ?? Number.NaN, availableHorizons, confirmedHorizon ?? undefined);
  const tieRequired = horizonResolution.status === "tie";
  const outsideRange = horizonResolution.status === "outside-range";
  const outsideRangeConfirmed = outsideRange && confirmedHorizon === horizonResolution.resolvedHorizon;
  const resolvedHorizon = outsideRange && !outsideRangeConfirmed ? null : horizonResolution.resolvedHorizon ?? data?.meta.defaultHorizon ?? 5;
  const evidence = resolvedHorizon ? rows.find(row => row.periodType === "month" && row.period === period && row.session === session && row.horizon === resolvedHorizon && row.direction === side) ?? null : null;
  const ciFor = (metric: Metric): ConfidenceReference | null => {
    const contextual = data?.seasonalCI.find(row => row.periodType === "month" && row.period === period && row.session === session && row.horizon === resolvedHorizon && (row.direction ?? "pooled") === side && row.unit === "points" && row.metric === metric);
    if (contextual) return { ...contextual, scope: "context" };
    const broader = data?.sessionCI?.find(row => row.session === session && row.horizon === resolvedHorizon && row.unit === "points" && row.metric === metric);
    return broader ? { ...broader, scope: "broader" } : null;
  };

  const entryValue = parseInput(entry);
  const invalidationValue = parseInput(invalidation);
  const quantityValue = parseInput(quantity);
  const riskLimitValue = parseInput(riskLimit);
  const existingRiskValue = existingRisk.trim() === "" ? 0 : parseInput(existingRisk);
  const costValue = parseInput(instrument === "MNQ" ? mnqCost : nqCost);
  const slippageValue = slippagePoints.trim() === "" ? 0 : parseInput(slippagePoints);
  const distance = entryValue !== null && invalidationValue !== null ? side === "long" ? entryValue - invalidationValue : invalidationValue - entryValue : null;
  const instrumentConfig = data?.meta.tradingInstruments?.[instrument] ?? TRADING_INSTRUMENTS[instrument];
  const errors = {
    entry: !isPositive(entryValue) ? "Enter a positive entry price." : !isQuarterPoint(entryValue) ? `Use 0.25-point increments. Nearest valid tick: ${nearestTick(entryValue)}.` : "",
    invalidation: !isPositive(invalidationValue) ? "Enter a positive invalidation price." : !isQuarterPoint(invalidationValue) ? `Use 0.25-point increments. Nearest valid tick: ${nearestTick(invalidationValue)}.` : distance !== null && distance <= 0 ? side === "long" ? "For a long, invalidation must be below entry." : "For a short, invalidation must be above entry." : "",
    quantity: !isPositive(quantityValue) || !Number.isInteger(quantityValue) ? "Enter the intended whole number of contracts." : "",
    riskLimit: !isPositive(riskLimitValue) ? "Enter the trade-idea risk limit." : "",
    existingRisk: !isNonNegative(existingRiskValue) ? "Use zero or a positive amount." : "",
    cost: !isNonNegative(costValue) ? "Use zero or a positive cost." : "",
    slippage: !isNonNegative(slippageValue) ? "Use zero or a positive point amount." : !isQuarterPoint(slippageValue) ? `Use 0.25-point increments. Nearest valid tick: ${nearestTick(slippageValue)}.` : "",
    holding: !isPositive(parseInput(holdingTime)) ? "Enter a positive holding time." : tieRequired ? "Choose one of the tied horizons before results are shown." : outsideRange && !outsideRangeConfirmed ? "Holding time is outside the controlled 1-30 minute range; choose a listed horizon to continue." : "",
  };
  const source = data?.meta.dataSourceFallback ? selectDataSource(data.meta.dataSourceFallback) : null;
  const evidenceSourceValid = Boolean(source && evidence && source.instrument === evidence.dataInstrument && source.sourceId === evidence.sourceId);
  const validInputs = Boolean(data && evidenceSourceValid && resolvedHorizon && distance && distance > 0 && !Object.values(errors).some(Boolean));
  const risk = validInputs ? calculatePlannedRisk({
    stopPoints: distance ?? 0,
    dollarsPerPoint: instrumentConfig.dollarsPerPoint,
    costPerSide: costValue ?? 0,
    slippagePoints: slippageValue ?? 0,
    quantity: quantityValue ?? 0,
    riskLimit: riskLimitValue ?? 0,
    existingRisk: existingRiskValue ?? 0,
  }) : null;
  const research = researchData ?? data;
  const researchLoading = view !== "planner" && !researchData && !researchError;

  if (loadError) return <main className="load-state"><h1>Dashboard data did not load.</h1><p>{loadError}</p><button type="button" onClick={() => location.reload()}>Try again</button></main>;
  if (!data) return <main className="load-state"><h1>Loading the risk planner</h1><p>Loading the controlled historical extract.</p></main>;

  return <div className="app-shell">
    <header className="topbar">
      <button type="button" className="brand" onClick={() => setView("planner")}><span>VOL</span><strong>VOL NQ/MNQ Risk Planner</strong></button>
      <nav aria-label="Dashboard destinations">{NAV.map(item => <button key={item.id} type="button" className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
    </header>

    {view === "planner" && <main className="planner-page">
      <section className="intro-band">
        <div><p className="eyebrow">NQ / MNQ Risk Planner</p><h1>Check the risk of the trade you already defined.</h1><p>Enter your own entry, invalidation and intended quantity. The planner estimates financial exposure first, then compares the distance with historical NQ adverse movement.</p></div>
        <aside><strong>No signal. No stop recommendation. No quantity recommendation.</strong><span>Actual loss can exceed this estimate when fills, slippage, gaps, platform behaviour or liquidity differ from assumptions.</span></aside>
      </section>
      <section className="planner-grid">
        <form className="planner-panel" onSubmit={event => event.preventDefault()}>
          <div className="panel-title"><span>1</span><div><h2>Your trade</h2><p>Start with the price that proves the idea wrong.</p></div></div>
          <Toggle value={instrument} label="Trading instrument" onChange={setInstrument} options={[{ value: "MNQ", label: "MNQ" }, { value: "NQ", label: "NQ" }]} />
          <Toggle value={side} label="Direction" onChange={setSide} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
          <div className="form-grid">
            <Field label="Entry price" error={entry ? errors.entry : ""}><input type="number" min="0.25" required value={entry} inputMode="decimal" step="0.25" onChange={event => setEntry(event.target.value)} /></Field>
            <Field label="Invalidation price" error={invalidation ? errors.invalidation : ""}><input type="number" min="0.25" required value={invalidation} inputMode="decimal" step="0.25" onChange={event => setInvalidation(event.target.value)} /></Field>
            <Field label="Intended quantity" error={quantity ? errors.quantity : ""}><input type="number" min="1" required value={quantity} inputMode="numeric" step="1" onChange={event => setQuantity(event.target.value)} /></Field>
            <Field label="Trade-idea risk limit" error={riskLimit ? errors.riskLimit : ""}><input type="number" min="0.01" required value={riskLimit} inputMode="decimal" step="0.01" onChange={event => setRiskLimit(event.target.value)} /></Field>
            <Field label="Existing same-idea risk" hint="Optional. Use zero when there is no related open risk." error={existingRisk ? errors.existingRisk : ""}><input type="number" min="0" value={existingRisk} inputMode="decimal" step="0.01" onChange={event => setExistingRisk(event.target.value)} /></Field>
            <Field label={`${instrument} cost per side`} hint="Editable assumption. MNQ starts at $0.50; NQ starts at $1.75." error={errors.cost}><input type="number" min="0" value={instrument === "MNQ" ? mnqCost : nqCost} inputMode="decimal" step="0.01" onChange={event => instrument === "MNQ" ? setMnqCost(event.target.value) : setNqCost(event.target.value)} /></Field>
            <Field label="Assumed adverse slippage" hint="Added to distance before dollar exposure is calculated." error={errors.slippage}><input type="number" min="0" value={slippagePoints} inputMode="decimal" step="0.25" onChange={event => setSlippagePoints(event.target.value)} /></Field>
            <Field label="Planned entry session"><select value={session} onChange={event => setSession(event.target.value)}>{SESSIONS.map(item => <option key={item} value={item}>{SESSION_LABELS[item]}</option>)}</select></Field>
            <Field label="Planned entry month"><select value={period} onChange={event => setPeriod(event.target.value)}>{MONTHS.map(item => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Forward adverse-movement horizon" hint="Choose approximately how long the position normally remains exposed." error={errors.holding}><input value={holdingTime} inputMode="decimal" onChange={event => { setHoldingTime(event.target.value); setConfirmedHorizon(null); }} /></Field>
          </div>
          <div className={`horizon-note ${tieRequired || outsideRange ? "tie" : ""}`}><span>No horizon defines the correct invalidation.</span>{horizonResolution.message && <span>{horizonResolution.message}</span>}{tieRequired && <span>Two horizons are equally close. Choose which comparison to display.</span>}{outsideRange && <span>Results are withheld instead of extrapolated beyond the controlled data. Confirm the nearest available reference to continue.</span>}<div aria-label="Available forward adverse-movement horizons">{availableHorizons.map(value => { const confirmationRequired = tieRequired || outsideRange; const enabledForConfirmation = horizonResolution.candidates.includes(value); return <button key={value} type="button" disabled={confirmationRequired && !enabledForConfirmation} className={resolvedHorizon === value ? "active" : ""} aria-pressed={resolvedHorizon === value} onClick={() => { setConfirmedHorizon(value); if (!confirmationRequired) setHoldingTime(String(value)); }}>{value} min</button>; })}</div></div>
        </form>
        <section className="result-stack" aria-live="polite">
          {!validInputs && <article className="planner-panel empty-result"><h2>No personalized result yet.</h2><p>{evidence && !evidenceSourceValid ? "The selected movement source is not validated for use, so the result is withheld." : "Complete valid entry, invalidation, intended quantity, risk limit, holding time and assumptions before trade-specific calculations appear."}</p></article>}
          {risk && evidence && resolvedHorizon && <><article className="planner-panel risk-first"><div className="panel-title"><span>2</span><div><h2>Estimated loss if filled at the assumed execution price</h2><p>Calculated from your inputs and editable assumptions.</p></div></div><div className="risk-metrics"><div><span>Distance to invalidation</span><strong>{fmt(distance ?? 0, 2)} pts</strong></div><div><span>Estimated loss per contract</span><strong>{money(risk.riskPerContract)}</strong></div><div><span>Estimated loss for intended quantity</span><strong>{money(risk.plannedRisk)}</strong></div><div><span>Combined trade-idea risk</span><strong>{money(risk.combinedRisk)}</strong></div></div><div className={`budget-line ${risk.withinLimit ? "under" : "over"}`}><strong>{risk.withinLimit ? `${money(risk.differenceFromLimit)} below your entered limit` : `${money(Math.abs(risk.differenceFromLimit))} above your entered limit`}</strong><span>{instrument}: ${fmt(instrumentConfig.dollarsPerPoint, 2)} per point, ${fmt(costValue ?? 0, 2)} per side. Do not move invalidation solely to make the arithmetic fit.</span></div></article><article className="planner-panel evidence-panel"><div className="panel-title"><span>3</span><div><h2>Historical adverse movement</h2><p>NQ data comparison after financial risk is known.</p></div></div><p className="context-copy">Selected context: {period}, {SESSION_LABELS[session]}, {side}, {resolvedHorizon} minutes. Sample: {fmt(evidence.observations, 0)} observations across {fmt(evidence.days, 0)} trading days. Movement history source: {evidence.dataInstrument} ({evidence.sourceId}). Dollar-risk calculation: {instrument}. Data dates {data.meta.firstTimestamp} to {data.meta.lastTimestamp}.</p><QuantileScale row={evidence} invalidationDistance={distance ?? 0} /><div className="quantile-grid"><QuantileCard q={50} value={evidence.p50Points} observations={evidence.observations} ci={ciFor("p50")} /><QuantileCard q={80} value={evidence.p80Points} observations={evidence.observations} ci={ciFor("p80")} /><QuantileCard q={90} value={evidence.p90Points} observations={evidence.observations} ci={ciFor("p90")} /></div><p className="context-copy">This shows historical movement against comparable positions. It does not predict direction, profit potential, stop-hit probability, trade outcome, or the next market move.</p></article></>}
        </section>
      </section>
    </main>}

    {view === "patterns" && <main className="planner-page"><section className="intro-band compact"><div><p className="eyebrow">Historical Patterns</p><h1>Research view for context, not entries.</h1><p>Compare NQ adverse movement by session and selected horizon. Research is separate from trade-specific financial exposure.</p></div></section>{researchLoading && <p className="context-copy">Loading the full research extract...</p>}{researchError && <p className="context-copy">Research extract did not load: {researchError}</p>}<section className="patterns-grid">{SESSIONS.map(name => { const row = (research?.sessionMetrics ?? []).find(item => item.session === name && item.horizon === (resolvedHorizon ?? 5) && item.direction === "pooled" && item.unit === "points"); return <article key={name} className="pattern-card"><span>{SESSION_LABELS[name]}</span><strong>{row ? `${fmt(row.p80, 1)} pts` : "No data"}</strong><small>{row ? `P80, ${fmt(row.days, 0)} days, ${resolvedHorizon ?? 5} minutes` : "Unavailable in controlled extract"}</small></article>; })}</section></main>}

    {view === "method" && <main className="planner-page"><section className="intro-band compact"><div><p className="eyebrow">Data & Method</p><h1>Every result shows its evidence path.</h1><p>{data.meta.disclaimer}</p></div></section>{researchLoading && <p className="context-copy">Loading the full research extract...</p>}{researchError && <p className="context-copy">Research extract did not load: {researchError}</p>}<section className="method-grid"><article><span>Active source</span><strong>{source?.instrument ?? data.meta.activeDataSource?.dataInstrument ?? "NQ"}</strong><p>{source?.sourceId ?? data.meta.activeDataSource?.sourceId}</p></article><article><span>Coverage</span><strong>{data.meta.firstTimestamp} to {data.meta.lastTimestamp}</strong><p>{fmt(data.meta.records, 0)} market records, {data.meta.timezone}</p></article><article><span>Horizons</span><strong>{availableHorizons.join(", ")} min</strong><p>Five minutes is the initial short-term reference.</p></article><article><span>Fallback policy</span><strong>NQ to MNQ to US100</strong><p>No silent blending. Invalid or unvalidated fallback results are withheld.</p></article></section><section className="method-list"><h2>Source hierarchy</h2>{(data.meta.dataSourceFallback ?? []).map(item => <div key={item.instrument}><strong>{item.instrument}</strong><span>{item.status}</span><p>{item.notes}</p></div>)}<h2>Key evidence claims</h2>{(research?.claims ?? []).slice(0, 10).map(item => <details key={item.id}><summary>{item.id}: {item.classification}</summary><p>{item.claim}</p><small>{item.source} | {item.method}</small></details>)}</section><footer className="receipt-footer"><span>Analysis SHA-256</span><code>{data.meta.analysisManifestSha256}</code><span>Raw DBN SHA-256</span><code>{data.meta.rawDbnSha256}</code></footer></main>}
  </div>;
}
