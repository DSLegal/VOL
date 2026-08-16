"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateContractRisk, nearestHorizons, SUPPORTED_HORIZONS } from "./dashboard-math.mjs";

type View = "lab" | "seasonality" | "sessions" | "regimes" | "execution" | "evidence";
type PeriodType = "month" | "week";
type Unit = "points" | "mae_atr";

type SeasonalRow = {
  sourceId: string; dataInstrument: "NQ" | "MNQ" | "US100"; sourceRank: number; fallbackReason: string; reconciliationStatus: string;
  periodType: PeriodType; period: string; order: number; horizon: number; session: string;
  direction: string; observations: number; days: number; years: number; sampleBand: string;
  p50Points: number; p80Points: number; p90Points: number; p50Atr: number; p80Atr: number; p90Atr: number;
};
type TradingInstrument = "MNQ" | "NQ";
type QuantileMetric = "p50" | "p80" | "p90";

type Data = {
  meta: { generatedAt: string; analysisGeneratedAt: string; analysisManifestSha256: string; rawDbnSha256: string; records: number; firstTimestamp: string; lastTimestamp: string; timezone: string; bootstrapReplications: number; seed: number; verifiedFiles: number; disclaimer: string; supportedHorizons?: number[]; defaultHorizon?: number; dataSourceFallback?: Array<{ instrument: string; sourceId: string; rank: number; status: string; available: boolean; notes: string }>; tradingInstruments?: Record<TradingInstrument, { dollarsPerPoint: number; defaultCostPerSide: number }> };
  seasonal: SeasonalRow[];
  seasonalCI: Array<{ sourceId?: string; periodType: PeriodType; period: string; order: number; horizon: number; session: string; unit: Unit; metric: QuantileMetric; estimate: number; low: number; high: number; observations: number; days: number }>;
  sessionMetrics: Array<{ sourceId?: string; dataInstrument?: string; horizon: number; session: string; direction: string; unit: Unit | "basis_points"; observations: number; days: number; p50: number; p80: number; p90: number }>;
  sessionCI: Array<{ sourceId?: string; horizon: number; session: string; unit: Unit | "basis_points"; metric: QuantileMetric; estimate: number; low: number; high: number }>;
  chronological: Array<{ week: string; session: string; horizon?: number; days: number; p80Points: number; p80Atr: number }>;
  rolling: Array<{ date: string; session: string; horizon?: number; value: number }>;
  cashOpen: Array<{ horizon: number; time: string; unit: Unit | "basis_points"; observations: number; days: number; p50: number; p80: number; p90: number }>;
  execution: Array<{ metric: string; probability: number; estimate: number; low: number; high: number; unit: string }>;
  riskCompatibility: Array<{ quantity: number; records: number; maximumStop: number; medianDistance: number; p90Distance: number; compatibilityRate: number }>;
  thesis: Array<{ gapMinutes: number; groups: number; losingGroups: number; medianNetPnl: number; p90MinimumObservedRisk: number; maxCumulativeQuantity: number; maxLiveSize: number }>;
  accountDays: Array<{ account: string; day: string; records: number; netPnl: number; worstRealizedPnl: number; maxLiveContracts: number }>;
  afterLoss: Array<{ metric: string; days: number; sumPnl: number; meanPnl: number; medianPnl: number; positiveFraction: number }>;
  overlap: Array<{ session: string; unit: Unit; days: number; nqP80: number; mnqP80: number; ratio: number }>;
  claims: Array<{ id: string; classification: string; claim: string; source: string; sample: string; method: string }>;
  quality: Array<{ id: string; scope: string; metric: string; value: string; status: string; notes: string }>;
};

const NAV: Array<{ id: View; label: string; short: string }> = [
  { id: "lab", label: "Stop Check", short: "Stop" },
  { id: "seasonality", label: "Seasonality", short: "Season" },
  { id: "sessions", label: "Time of Day", short: "Sessions" },
  { id: "regimes", label: "Changing Conditions", short: "History" },
  { id: "execution", label: "Trade Records", short: "Records" },
  { id: "evidence", label: "Research Method", short: "Method" },
];

const SESSION_ORDER = ["Asia KZ", "London KZ", "Pre-Market OR", "08:30 OR", "NY AM OR", "NY AM SB", "NY Lunch", "NY PM KZ", "NY 1st DR"];
const MONTH_SHORT: Record<string, string> = { January: "Jan", February: "Feb", March: "Mar", April: "Apr", May: "May", June: "Jun", July: "Jul", August: "Aug", September: "Sep", October: "Oct", November: "Nov", December: "Dec" };
const HORIZON_OPTIONS = [...SUPPORTED_HORIZONS];
const TRADING_DEFAULTS: Record<TradingInstrument, { dollarsPerPoint: number; defaultCostPerSide: number }> = {
  MNQ: { dollarsPerPoint: 2, defaultCostPerSide: 0.5 },
  NQ: { dollarsPerPoint: 20, defaultCostPerSide: 1.75 },
};

const fmt = (value: number, digits = 2) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const sampleTone = (days: number) => days < 20 ? "thin" : days < 40 ? "watch" : "solid";
const boundedNumber = (value: string, min: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : min;
};
const horizonOptions = HORIZON_OPTIONS.map(value => ({ value: String(value), label: `${value} min` }));

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return <div className="toggle" role="group" aria-label={label}>{options.map(option => <button key={option.value} className={value === option.value ? "active" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function InfoMarker({ title, children, takeaway }: { title: string; children: React.ReactNode; takeaway?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return <span className="info-marker" data-open={open} ref={ref}>
    <button type="button" aria-label={`Explain ${title}`} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(value => !value); }}>i</button>
    <span className="info-popover" id={id} role="note">
      <button type="button" className="info-close" aria-label="Close explanation" onClick={() => setOpen(false)}>×</button>
      <strong>{title}</strong>
      <span>{children}</span>
      {takeaway && <em><b>Trader takeaway:</b> {takeaway}</em>}
    </span>
  </span>;
}

function Select({ label, value, onChange, children }: { label: React.ReactNode; value: string | number; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label>;
}

function LineChart({ points, active, onPick, colour = "var(--lime)", formatValue = (v: number) => fmt(v, 2), compact = false }: {
  points: Array<{ label: string; value: number; detail?: string }>;
  active?: string; onPick?: (label: string) => void; colour?: string; formatValue?: (value: number) => string; compact?: boolean;
}) {
  if (!points.length) return <div className="empty">No matching observations.</div>;
  const width = 920, height = compact ? 190 : 290, left = 48, right = 22, top = 24, bottom = 42;
  const values = points.map(point => point.value);
  const min = Math.min(...values), max = Math.max(...values), padding = Math.max((max - min) * .18, max * .04, .1);
  const yMin = Math.max(0, min - padding), yMax = max + padding;
  const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((yMax - value) / Math.max(.0001, yMax - yMin)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const ticks = [0, .25, .5, .75, 1].map(t => yMin + (yMax - yMin) * t);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  return <div className="chart-wrap">
    <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical volatility line chart">
      <defs><linearGradient id={`area-${points.length}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={colour} stopOpacity=".26"/><stop offset="1" stopColor={colour} stopOpacity="0"/></linearGradient></defs>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid-line"/><text x={left - 10} y={y(tick) + 4} textAnchor="end" className="axis-label">{formatValue(tick)}</text></g>)}
      <path d={`${path} L${x(points.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`} fill={`url(#area-${points.length})`}/>
      <path d={path} fill="none" stroke={colour} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((point, index) => <g key={`${point.label}-${index}`} className={onPick ? "chart-point clickable" : "chart-point"} onClick={() => onPick?.(point.label)} role={onPick ? "button" : undefined} tabIndex={onPick ? 0 : undefined} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onPick?.(point.label); }}>
        <circle cx={x(index)} cy={y(point.value)} r={active === point.label ? 7 : points.length > 100 ? 2.2 : 4} fill={active === point.label ? "var(--paper)" : colour} stroke={active === point.label ? colour : "none"} strokeWidth="3"><title>{point.label}: {formatValue(point.value)}{point.detail ? ` · ${point.detail}` : ""}</title></circle>
        {(index % labelEvery === 0 || index === points.length - 1) && <text x={x(index)} y={height - 15} textAnchor="middle" className="axis-label">{point.label}</text>}
      </g>)}
    </svg>
  </div>;
}

function QuantileBand({ row, structuralStop }: { row: SeasonalRow; structuralStop: number }) {
  const max = Math.max(row.p90Points * 1.18, structuralStop * 1.12, 1);
  const pct = (value: number) => `${Math.min(100, (value / max) * 100)}%`;
  return <div className="tunnel" aria-label="Historical adverse excursion reference bands">
    <div className="tunnel-scale"><span>0</span><span>{fmt(max, 1)} pts</span></div>
    <div className="tunnel-track">
      <div className="tunnel-segment q50" style={{ width: pct(row.p50Points) }} />
      <div className="tunnel-segment q80" style={{ left: pct(row.p50Points), width: `calc(${pct(row.p80Points)} - ${pct(row.p50Points)})` }} />
      <div className="tunnel-segment q90" style={{ left: pct(row.p80Points), width: `calc(${pct(row.p90Points)} - ${pct(row.p80Points)})` }} />
      <div className="stop-marker" style={{ left: pct(structuralStop) }}><span>Your invalidation</span><strong>{fmt(structuralStop, 1)}</strong></div>
      {[{ label: "Typical", value: row.p50Points }, { label: "Wider", value: row.p80Points }, { label: "Extreme", value: row.p90Points }].map(item => <div key={item.label} className="quantile-marker" style={{ left: pct(item.value) }}><span>{item.label}</span><strong>{fmt(item.value, 1)}</strong></div>)}
    </div>
    <div className="tunnel-legend"><span><i className="q50"/>Typical pullback</span><span><i className="q80"/>Wider pullback</span><span><i className="q90"/>Extreme pullback</span></div>
  </div>;
}

function EvidenceNote({ children }: { children: React.ReactNode }) { return <div className="evidence-note"><span>i</span><p>{children}</p></div>; }

function HorizonControl({ horizon, setHorizon }: { horizon: number; setHorizon: (v: number) => void }) {
  return <div className="field"><span>Forward adverse-movement horizon <InfoMarker title="Forward adverse-movement horizon" takeaway="Choose the nearest history window to your usual exposure time.">Choose approximately how long the position normally remains exposed. This compares future adverse movement over that window; it does not define the correct stop.</InfoMarker></span><Toggle value={String(horizon)} onChange={value => setHorizon(Number(value))} label="Forward adverse-movement horizon" options={horizonOptions}/></div>;
}

export default function VolatilityDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("lab");
  const [session, setSession] = useState("NY AM OR");
  const [horizon, setHorizon] = useState(5);
  const [direction, setDirection] = useState("pooled");
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [period, setPeriod] = useState("March");
  const [unit, setUnit] = useState<Unit>("points");
  const [currentAtr, setCurrentAtr] = useState(7.5);
  const [structuralStop, setStructuralStop] = useState(18);
  const [riskBudget, setRiskBudget] = useState(150);
  const [tradingInstrument, setTradingInstrument] = useState<TradingInstrument>("MNQ");
  const [mnqCostPerSide, setMnqCostPerSide] = useState(TRADING_DEFAULTS.MNQ.defaultCostPerSide);
  const [nqCostPerSide, setNqCostPerSide] = useState(TRADING_DEFAULTS.NQ.defaultCostPerSide);
  const [typicalHolding, setTypicalHolding] = useState(5);
  const [yearStart, setYearStart] = useState(2014);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  useEffect(() => {
    fetch("./data/dashboard-data.json")
      .then(response => { if (!response.ok) throw new Error(`Data returned ${response.status}`); return response.json(); })
      .then(setData)
      .catch(error => setLoadError(error instanceof Error ? error.message : "Unable to load data"));
  }, []);

  const availableHorizons = useMemo(() => {
    if (!data) return HORIZON_OPTIONS;
    return [...new Set(data.seasonal.map(row => row.horizon))].sort((a, b) => a - b);
  }, [data]);

  const resolvedHorizon = availableHorizons.includes(horizon)
    ? horizon
    : availableHorizons.length
      ? availableHorizons.reduce((best, value) => Math.abs(value - horizon) < Math.abs(best - horizon) ? value : best, availableHorizons[0])
      : 5;

  const periods = useMemo(() => {
    if (!data) return [];
    const unique = new Map<number, string>();
    data.seasonal.filter(row => row.periodType === periodType).forEach(row => unique.set(row.order, row.period));
    return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  }, [data, periodType]);

  const resolvedPeriod = periods.includes(period) ? period : periods[0] ?? period;
  const reference = useMemo(() => data?.seasonal.find(row => row.periodType === periodType && row.period === resolvedPeriod && row.session === session && row.horizon === resolvedHorizon && row.direction === direction) ?? null, [data, periodType, resolvedPeriod, session, resolvedHorizon, direction]);
  const series = useMemo(() => (data?.seasonal.filter(row => row.periodType === periodType && row.session === session && row.horizon === resolvedHorizon && row.direction === direction).sort((a, b) => a.order - b.order) ?? []), [data, periodType, session, resolvedHorizon, direction]);
  const valueOf = (row: SeasonalRow, q: 50 | 80 | 90) => unit === "mae_atr" ? row[`p${q}Atr`] : row[`p${q}Points`];
  const ciFor = (metric: QuantileMetric) => data?.seasonalCI.find(row => row.periodType === periodType && row.period === resolvedPeriod && row.session === session && row.horizon === resolvedHorizon && row.unit === unit && (row.metric === metric || (!row.metric && metric === "p80"))) ?? null;
  const holdingSuggestions = nearestHorizons(typicalHolding);
  const unavailableHorizons = HORIZON_OPTIONS.filter(value => !availableHorizons.includes(value));

  if (loadError) return <main className="load-state"><div><span className="brand-mark">V</span><h1>The dashboard data did not load.</h1><p>{loadError}</p><button onClick={() => location.reload()}>Try again</button></div></main>;
  if (!data || !reference) return <main className="load-state"><div><span className="brand-mark pulse">V</span><h1>Preparing the volatility lab…</h1><p>Loading the controlled historical extract.</p></div></main>;

  const instrumentConfig = (data.meta.tradingInstruments?.[tradingInstrument] ?? TRADING_DEFAULTS[tradingInstrument]);
  const costPerSide = tradingInstrument === "MNQ" ? mnqCostPerSide : nqCostPerSide;
  const { roundTripCost, riskPerContract, wholeContracts, usedRisk, unallocatedRisk } = calculateContractRisk({ stopPoints: structuralStop, dollarsPerPoint: instrumentConfig.dollarsPerPoint, costPerSide, riskBudget });
  const sourceSummary = `${reference.dataInstrument ?? "NQ"} data · ${reference.sourceId ?? "NQ_long_history"}`;
  const stopReading = structuralStop < reference.p50Points
    ? { tone: "tight", title: "Inside typical movement", body: "In this historical sample, ordinary pullbacks often travelled farther than your invalidation distance. Recheck the entry location and price structure; do not widen the stop automatically." }
    : structuralStop < reference.p80Points
      ? { tone: "balanced", title: "Between typical and wider movement", body: "Your invalidation has more room than the middle historical pullback, but wider movement regularly exceeded it. Decide whether the entry location gives the structure enough room." }
      : structuralStop < reference.p90Points
        ? { tone: "wide", title: "Beyond wider movement", body: "Your invalidation sits beyond the wider historical pullback, although extreme moves still exceeded it. The trade now requires more dollar risk per contract." }
        : { tone: "extreme", title: "Beyond most historical movement", body: "Your invalidation is wider than nine out of ten measured pullbacks in this sample. Confirm that this distance comes from structure rather than from avoiding a loss." };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("lab")}><span className="brand-mark">V</span><span><strong>STOP / ROOM</strong><small>NQ evidence · NQ/MNQ costs</small></span></button>
      <nav aria-label="Dashboard sections">{NAV.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span className="nav-full">{item.label}</span><span className="nav-short">{item.short}</span></button>)}</nav>
      <button className="evidence-trigger" onClick={() => setEvidenceOpen(true)}><span className="status-dot"/>Method</button>
    </header>

    <main>
      {view === "lab" && <section className="page lab-page">
        <div className="page-head">
          <div><p className="eyebrow">Price-action stop check</p><h1>Will your stop survive<br/><em>normal price movement?</em></h1><p className="lead">Mark the price that proves your trade idea wrong. The dashboard compares that distance with horizon-specific NQ adverse-movement history, then translates the already-defined stop into NQ or MNQ arithmetic.</p></div>
          <div className="coverage-stamp"><span>Controlled extract</span><strong>{fmt(data.meta.records, 0)}</strong><small>{sourceSummary} · {data.meta.firstTimestamp.slice(0, 4)}–{data.meta.lastTimestamp.slice(0, 4)}</small></div>
        </div>

        <div className="price-action-flow">
          <article><span>1</span><div><strong>Define invalidation</strong><p>Where is the trade idea objectively wrong?</p></div><label><input aria-label="Price-action invalidation distance" type="number" min="0.25" step="0.25" value={structuralStop} onChange={event => setStructuralStop(boundedNumber(event.target.value, .25))}/><b>points</b></label></article>
          <article><span>2</span><div><strong>Match the context</strong><p>Choose session, side and forward adverse-movement horizon.</p></div></article>
          <article><span>3</span><div><strong>Read the breathing room</strong><p>Compare invalidation with typical, wider and extreme pullbacks.</p></div></article>
        </div>

        <div className={`plain-result ${stopReading.tone}`} role="status" aria-live="polite">
          <div><span>Current reading</span><strong>{stopReading.title}</strong></div>
          <p>{stopReading.body}</p>
          <dl><div><dt>Your invalidation</dt><dd>{fmt(structuralStop, 1)} pts</dd></div><div><dt>Typical pullback</dt><dd>{fmt(reference.p50Points, 1)} pts</dd></div><div><dt>Wider pullback</dt><dd>{fmt(reference.p80Points, 1)} pts</dd></div><div><dt>Extreme pullback</dt><dd>{fmt(reference.p90Points, 1)} pts</dd></div></dl>
        </div>

        <div className="workbench">
          <aside className="control-rail">
            <div className="rail-heading"><span>02</span><div><strong>Match the trade</strong><small>Choose comparable history</small></div></div>
            <Select label={<>Session <InfoMarker title="Trading session" takeaway="Choose the part of the day in which you expect to enter.">Each session is a fixed New York-time window. Markets often move differently in Asia, London, the New York open, lunch and the afternoon.</InfoMarker></>} value={session} onChange={setSession}>{SESSION_ORDER.map(item => <option key={item}>{item}</option>)}</Select>
            <HorizonControl horizon={horizon} setHorizon={setHorizon}/>
            {unavailableHorizons.length > 0 && <p className="field-hint warning">Awaiting regenerated data for {unavailableHorizons.map(value => `${value}m`).join(", ")}. Current extract supports {availableHorizons.map(value => `${value}m`).join(", ")}.</p>}
            <label className="field"><span>Typical holding time <InfoMarker title="Typical holding time" takeaway="This only maps your input to the nearest available historical window.">Enter approximately how many minutes your position normally remains exposed. Ties show both neighboring horizons.</InfoMarker></span><div className="compact-input"><input aria-label="Typical holding time in minutes" type="number" min="1" step="1" value={typicalHolding} onChange={event => setTypicalHolding(boundedNumber(event.target.value, 1))}/><b>min</b></div><small className="field-hint">{holdingSuggestions.length ? `Nearest available horizon: ${holdingSuggestions.map(value => `${value}m`).join(" or ")}` : "Enter a positive holding time."}</small></label>
            <div className="field"><span>Trade side <InfoMarker title="Trade side" takeaway="Use Both for a general view; use Long or Short when direction matters to your setup.">Both combines long and short entries. Long measures downward movement against a long. Short measures upward movement against a short.</InfoMarker></span><Toggle value={direction} onChange={setDirection} label="Trade side" options={[{ value: "pooled", label: "Both" }, { value: "long", label: "Long" }, { value: "short", label: "Short" }]}/></div>
            <div className="field"><span>Seasonal grouping <InfoMarker title="Month or week number" takeaway="Start with month; use week when you want a more detailed seasonal view.">Month pools the same calendar month across all available years. Week pools week numbers W01 to W53 across years.</InfoMarker></span><Toggle value={periodType} onChange={setPeriodType} label="Seasonal grouping" options={[{ value: "month", label: "Month" }, { value: "week", label: "Week no." }]}/></div>
            <Select label={<>{periodType === "month" ? "Month" : "Week of year"} <InfoMarker title="Selected seasonal period" takeaway="Always check the number of trading days before trusting a period.">The selection changes which historical month or week is shown. It does not predict that the current year will behave the same way.</InfoMarker></>} value={resolvedPeriod} onChange={setPeriod}>{periods.map(item => <option key={item}>{item}</option>)}</Select>
            <div className="field"><span>Measurement <InfoMarker title="Source-instrument points or relative range" takeaway="Use points for stop distance. Relative range is an advanced comparison across different years.">Source-instrument points show the actual price distance and remain labelled with the instrument that supplied the data. Relative range adjusts for how large the session normally was at the time.</InfoMarker></span><Toggle value={unit} onChange={setUnit} label="Measurement" options={[{ value: "points", label: `${reference.dataInstrument ?? "NQ"} points` }, { value: "mae_atr", label: "Across years" }]}/></div>
            <button className="plain-link" onClick={() => setEvidenceOpen(true)}>Open research method →</button>
          </aside>

          <div className="lab-canvas">
            <div className="canvas-kicker"><div><span className={`sample-chip ${sampleTone(reference.days)}`}>{reference.days} trading days{reference.days < 20 ? " · weak sample" : reference.days < 40 ? " · use caution" : ""}</span><InfoMarker title="Sample size" takeaway="More days usually make the comparison more dependable.">This is the number of separate eligible trading days behind the selected result. Under 20 days is thin; 20–39 needs care; 40 or more is the stronger sample band used here.</InfoMarker><span>{reference.years} years represented</span><span>cutoff {data.meta.lastTimestamp}</span><span>{sourceSummary}</span></div><span>{session} · {resolvedHorizon}m evidence · {direction}</span></div>
            <div className="quantile-grid">
              {[50, 80, 90].map((q, index) => { const metric = `p${q}` as QuantileMetric; const ci = ciFor(metric); return <article className={`quantile-card q${q}`} key={q}><div><span>{index === 0 ? "Typical pullback" : index === 1 ? "Wider pullback" : "Extreme pullback"} <InfoMarker title={index === 0 ? "Typical pullback (P50)" : index === 1 ? "Wider pullback (P80)" : "Extreme pullback (P90)"} takeaway={q === 50 ? "Use this as the middle, ordinary reference, not a stop suggestion." : q === 80 ? "Two out of ten measured pullbacks were still larger." : "One out of ten measured pullbacks was still larger."}>{q === 50 ? "Half of measured pullbacks were at or below this distance, and half were larger." : q === 80 ? "Eight out of ten measured pullbacks were at or below this distance." : "Nine out of ten measured pullbacks were at or below this distance."}</InfoMarker></span><small>P{q}</small></div><strong>{fmt(valueOf(reference, q as 50 | 80 | 90), unit === "points" ? 1 : 2)}</strong><em>{unit === "points" ? `${reference.dataInstrument ?? "NQ"} points` : "x normal session range"}</em><small className="ci-text">{ci ? `95% CI ${fmt(ci.low, unit === "points" ? 1 : 2)}-${fmt(ci.high, unit === "points" ? 1 : 2)} · n=${ci.days}d` : "95% CI unavailable for this slice"}</small></article>; })}
            </div>
            <p className="source-status"><strong>Source status:</strong> {reference.reconciliationStatus || "Primary NQ source selected."}{reference.fallbackReason ? ` Fallback reason: ${reference.fallbackReason}.` : ""}</p>
            <div className="chart-panel">
              <div className="panel-head"><div><p className="eyebrow">{periodType === "month" ? "Month comparison" : "Week-number comparison"}</p><h2>Wider pullback by {periodType === "month" ? "month" : "week"} <InfoMarker title="How to read this chart" takeaway="Look for broad differences, then check how many days sit behind the result.">Each dot shows the wider historical pullback for the same session and time window. A higher dot means price historically needed more breathing room in that period.</InfoMarker></h2></div><div className="active-value"><span>{resolvedPeriod}</span><strong>{fmt(valueOf(reference, 80), unit === "points" ? 1 : 2)}</strong></div></div>
              <LineChart points={series.map(row => ({ label: periodType === "month" ? MONTH_SHORT[row.period] : row.period, value: valueOf(row, 80), detail: `${row.days} days` }))} active={periodType === "month" ? MONTH_SHORT[resolvedPeriod] : resolvedPeriod} onPick={label => setPeriod(periodType === "month" ? Object.keys(MONTH_SHORT).find(key => MONTH_SHORT[key] === label) ?? resolvedPeriod : label)} formatValue={value => `${fmt(value, unit === "points" ? 1 : 2)}${unit === "mae_atr" ? "×" : ""}`}/>
              <p className="chart-caption">Each point combines the same {periodType === "month" ? "month" : "week number"} across available years. “Wider pullback” means eight out of ten measured moves against entry were at or below this distance. Historical horizons provide comparison windows. No horizon defines the correct stop.</p>
            </div>
          </div>
        </div>

        <section className="decision-zone">
          <div className="section-title"><span>03</span><div><p className="eyebrow">Decision check</p><h2>Review breathing room and contract risk</h2></div></div>
          <div className="decision-grid">
            <article className="decision-card large"><div className="input-row"><label><span>Distance to invalidation <InfoMarker title="Price-action invalidation" takeaway="Enter the distance from entry to the price that proves your trade idea wrong.">This comes from your chart structure. The dashboard compares that distance with history but never chooses or widens it.</InfoMarker></span><div><input aria-label="Distance to invalidation" type="number" min="0.25" step="0.25" value={structuralStop} onChange={event => setStructuralStop(boundedNumber(event.target.value, .25))} /><b>points</b></div></label><label><span>Session ATR input <InfoMarker title="Session ATR input" takeaway="This is optional. Use it only to compare today with different years.">Enter the ATR or other consistent measure you use for the selected session. The tool translates the across-years comparison back into today’s points.</InfoMarker></span><div><input aria-label="Session ATR input" type="number" min="0.25" step="0.25" value={currentAtr} onChange={event => setCurrentAtr(boundedNumber(event.target.value, .25))} /><b>points</b></div></label><div className="context-callout"><span>Plain-English reading</span><strong>{stopReading.title}</strong><small>Adjusted P80 using your ATR input: {fmt(reference.p80Atr * currentAtr, 1)} pts</small></div></div><QuantileBand row={reference} structuralStop={structuralStop}/><EvidenceNote>This compares your price-action invalidation with past pullbacks. Historical horizons provide comparison windows. No horizon defines the correct stop.</EvidenceNote></article>
            <article className="decision-card sizing"><p className="eyebrow">Trading instrument risk translation</p><h3>Arithmetic capacity <InfoMarker title="Contract risk calculation" takeaway="This is a calculator result, not a recommended trade size.">NQ and MNQ share index-point movement but have different dollar multipliers and costs. The calculator adds your stated round-trip cost and uses only whole contracts.</InfoMarker></h3><div className="field"><span>Trading instrument</span><Toggle value={tradingInstrument} onChange={setTradingInstrument} label="Trading instrument" options={[{ value: "MNQ", label: "MNQ" }, { value: "NQ", label: "NQ" }]}/></div><div className="mini-inputs"><label><span>Risk budget <InfoMarker title="Risk budget" takeaway="Enter the maximum amount you have already decided to risk on this trade idea.">This is your own dollar limit before entering the trade. The tool does not decide an appropriate budget.</InfoMarker></span><div><b>$</b><input aria-label="Risk budget" type="number" min="1" value={riskBudget} onChange={event => setRiskBudget(boundedNumber(event.target.value, 1))}/></div></label><label><span>{tradingInstrument} cost per side <InfoMarker title="Cost per side" takeaway="Defaults are editable: MNQ $0.50 per side, NQ $1.75 per side.">This is the estimated commission and fee cost for opening or closing one contract. Round trip is two sides.</InfoMarker></span><div><b>$</b><input aria-label={`${tradingInstrument} cost per side`} type="number" min="0" step=".25" value={costPerSide} onChange={event => tradingInstrument === "MNQ" ? setMnqCostPerSide(boundedNumber(event.target.value, 0)) : setNqCostPerSide(boundedNumber(event.target.value, 0))}/></div></label></div><div className="sizing-result"><span>Arithmetic capacity, not recommended size <InfoMarker title="Maximum whole contracts" takeaway="A result of 0 means the stated stop and cost do not fit inside the stated budget.">The budget is divided by risk per contract, then rounded down because a fraction of one futures contract cannot be traded.</InfoMarker></span><strong>{wholeContracts}</strong><small>{money(usedRisk)} modelled risk · {money(unallocatedRisk)} unallocated</small></div><div className="formula">${fmt(instrumentConfig.dollarsPerPoint, 2)} × {fmt(structuralStop, 2)} points + ${fmt(roundTripCost, 2)} = <strong>${fmt(riskPerContract, 2)}</strong> / {tradingInstrument}</div><p className="fineprint">Data instrument: {sourceSummary}. Trading instrument: {tradingInstrument}. Mechanical arithmetic only; not a size recommendation.</p></article>
          </div>
        </section>
      </section>}

      {view === "seasonality" && (
        <SeasonalityView data={data} session={session} setSession={setSession} horizon={resolvedHorizon} setHorizon={setHorizon} periodType={periodType} setPeriodType={setPeriodType} period={period} setPeriod={setPeriod}/>
      )}
      {view === "sessions" && (
        <SessionsView data={data} horizon={resolvedHorizon} setHorizon={setHorizon}/>
      )}
      {view === "regimes" && (
        <RegimesView data={data} session={session} setSession={setSession} horizon={resolvedHorizon} setHorizon={setHorizon} yearStart={yearStart} setYearStart={setYearStart}/>
      )}
      {view === "execution" && <ExecutionView data={data}/>}
      {view === "evidence" && <EvidenceView data={data}/>}
    </main>

    <footer><div><span className="brand-mark small">V</span><p><strong>Historical Volatility Stop-Loss Lab</strong><br/>Evidence-controlled research interface</p></div><p>{data.meta.disclaimer}</p><button onClick={() => setEvidenceOpen(true)}>Data receipt</button></footer>

    {evidenceOpen && <div className="drawer-backdrop"><button className="backdrop-close" onClick={() => setEvidenceOpen(false)} aria-label="Close evidence receipt"/><aside className="evidence-drawer" aria-modal="true" role="dialog" aria-label="Evidence receipt"><button className="drawer-close" onClick={() => setEvidenceOpen(false)} aria-label="Close">×</button><p className="eyebrow">Evidence receipt</p><h2>Traceable by design</h2><p>This browser dataset was generated from the controlled CSV outputs and checked against their SHA-256 manifest before export.</p><dl><div><dt>Market records</dt><dd>{fmt(data.meta.records, 0)}</dd></div><div><dt>Coverage</dt><dd>{data.meta.firstTimestamp} → {data.meta.lastTimestamp}</dd></div><div><dt>Grouping timezone</dt><dd>{data.meta.timezone}</dd></div><div><dt>Bootstrap</dt><dd>{fmt(data.meta.bootstrapReplications, 0)} replications · seed {data.meta.seed}</dd></div><div><dt>Verified dashboard inputs</dt><dd>{data.meta.verifiedFiles} files</dd></div></dl><div className="hash"><span>Analysis manifest SHA-256</span><code>{data.meta.analysisManifestSha256}</code></div><div className="hash"><span>Raw NQ DBN SHA-256</span><code>{data.meta.rawDbnSha256}</code></div><button className="drawer-action" onClick={() => { setEvidenceOpen(false); setView("evidence"); }}>Open evidence register</button></aside></div>}
  </div>;
}

function PageIntro({ eyebrow, title, body, side }: { eyebrow: string; title: string; body: string; side?: React.ReactNode }) { return <div className="subpage-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>{side}</div>; }

function SeasonalityView({ data, session, setSession, horizon, setHorizon, periodType, setPeriodType, period, setPeriod }: { data: Data; session: string; setSession: (v: string) => void; horizon: number; setHorizon: (v: number) => void; periodType: PeriodType; setPeriodType: (v: PeriodType) => void; period: string; setPeriod: (v: string) => void }) {
  const monthly = data.seasonal.filter(row => row.periodType === "month" && row.horizon === horizon && row.direction === "pooled");
  const monthRows = [...new Set(monthly.map(row => row.period))].map(month => ({ month, cells: SESSION_ORDER.map(name => monthly.find(row => row.period === month && row.session === name)!) })).sort((a, b) => a.cells[0].order - b.cells[0].order);
  const allValues = monthRows.flatMap(row => row.cells.map(cell => cell.p80Atr));
  const min = Math.min(...allValues), max = Math.max(...allValues);
  const heat = (value: number) => { const t = (value - min) / Math.max(.001, max - min); return `color-mix(in srgb, var(--rust) ${Math.round(t * 76)}%, var(--panel-2))`; };
  const weeks = data.seasonal.filter(row => row.periodType === "week" && row.horizon === horizon && row.direction === "pooled" && row.session === session).sort((a, b) => a.order - b.order);
  const selectedWeek = weeks.find(row => row.period === period) ?? weeks[0];
  return <section className="page subpage">
    <PageIntro eyebrow="Seasonal patterns" title="When did pullbacks tend to need more room?" body="Compare the same month or week number across past years. Use this to prepare for changing breathing room, not to predict the next move." side={<div className="head-controls"><Select label="Session" value={session} onChange={setSession}>{SESSION_ORDER.map(item => <option key={item}>{item}</option>)}</Select><HorizonControl horizon={horizon} setHorizon={setHorizon}/></div>}/>
    <div className="story-grid">
      <article className="story-card heatmap-card"><div className="panel-head"><div><p className="eyebrow">Wider pullback relative to normal range</p><h2>Month by time of day <InfoMarker title="How to read the colour map" takeaway="Use colour to spot broad patterns, then click a cell and check its days.">Each cell compares a month and trading session. Warmer cells had wider pullbacks relative to the normal movement of that session.</InfoMarker></h2></div><span className="unit-pill">Comparable across years</span></div><div className="heatmap-scroll"><div className="heatmap" style={{ gridTemplateColumns: `88px repeat(${SESSION_ORDER.length}, minmax(62px,1fr))` }}><span/>{SESSION_ORDER.map(name => <span className="heat-head" key={name}>{name.replace(" ", "\n")}</span>)}{monthRows.flatMap(row => [<button className="month-label" key={`${row.month}-label`} onClick={() => { setPeriodType("month"); setPeriod(row.month); }}>{MONTH_SHORT[row.month]}</button>, ...row.cells.map(cell => <button key={`${row.month}-${cell.session}`} style={{ background: heat(cell.p80Atr) }} className="heat-cell" onClick={() => { setSession(cell.session); setPeriodType("month"); setPeriod(row.month); }}><strong>{fmt(cell.p80Atr, 2)}</strong><span>{cell.days}d</span></button>)])}</div></div><div className="heat-scale"><span>Less room historically</span><i/><span>More room historically</span></div><EvidenceNote>Small colour differences may simply be sample variation. Focus on broad patterns and the number of trading days rather than ranking every cell.</EvidenceNote></article>
      <article className="story-card seasonal-finding"><p className="eyebrow">What stands out</p><h2>Raw points and normalised movement tell different stories.</h2><div className="finding-number"><span>{session} · {horizon}m</span><strong>{fmt(Math.max(...monthly.map(row => row.p80Points)), 1)}<small> pts</small></strong><p>Largest monthly raw P80 in the selected slice. Check the day count before leaning on any period.</p></div><div className="finding-pair"><div><span>Data source</span><strong>{monthly[0]?.dataInstrument ?? "Unavailable"}</strong><small>{monthly[0]?.sourceId ?? "No matching controlled source"}</small></div><div><span>Horizon</span><strong>{horizon} min</strong><small>not a stop rule</small></div></div><p className="caution-copy">Historical horizons provide comparison windows. No horizon defines the correct stop.</p></article>
    </div>
    <article className="story-card wide"><div className="panel-head"><div><p className="eyebrow">{session} · longs and shorts together</p><h2>Pullback by week number <InfoMarker title="Week number of the year" takeaway="Treat isolated spikes cautiously, especially when the selected week has few days.">W01 is the first calendar week of the year. The chart combines the same week number across available years; it is not one continuous year.</InfoMarker></h2></div><Toggle value={periodType} onChange={setPeriodType} label="Season view" options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]}/></div><LineChart points={weeks.map(row => ({ label: row.period, value: row.p80Atr, detail: `${row.days} usable days` }))} active={selectedWeek?.period} onPick={label => { setPeriodType("week"); setPeriod(label); }} formatValue={v => `${fmt(v, 2)}×`}/><div className="selected-strip"><div><span>Week with most breathing room <InfoMarker title="Highest observed week" takeaway="Highest in the old sample does not mean it will be highest this year.">This was the largest wider-pullback value in this historical slice. It describes the sample and is not a forecast.</InfoMarker></span><strong>W40 · 2.614×</strong><small>Likely range 2.492–2.735 · 71 days</small></div><div><span>Week with least breathing room</span><strong>W27 · 2.243×</strong><small>Likely range 2.140–2.344 · 71 days</small></div><div className={selectedWeek && selectedWeek.days < 40 ? "sample-alert" : "sample-ok"}><span>Selected {selectedWeek?.period ?? "week"}</span><strong>{selectedWeek ? `${selectedWeek.days} days` : "—"}</strong><small>{selectedWeek && selectedWeek.days < 20 ? "Few days: use extra caution" : "Number of days shown first"}</small></div></div></article>
  </section>;
}

function SessionsView({ data, horizon, setHorizon }: { data: Data; horizon: number; setHorizon: (v: number) => void }) {
  const rows = SESSION_ORDER.map(session => data.sessionMetrics.find(row => row.horizon === horizon && row.session === session && row.direction === "pooled" && row.unit === "mae_atr")!).filter(Boolean);
  const cis = data.sessionCI.filter(row => row.horizon === horizon && row.unit === "mae_atr" && row.metric === "p80");
  const max = Math.max(...rows.map(row => row.p90), 1);
  const cash = data.cashOpen.filter(row => row.horizon === horizon && row.unit === "mae_atr").map(row => ({ label: row.time, value: row.p80, detail: `${row.days} days` }));
  return <section className="page subpage">
    <PageIntro eyebrow="Time-of-day comparison" title="A trading day does not move at one speed." body="Compare how much breathing room entries historically needed during Asia, London, the New York open, lunch and the afternoon." side={<div className="head-controls"><HorizonControl horizon={horizon} setHorizon={setHorizon}/></div>}/>
    <div className="session-layout"><article className="story-card"><div className="panel-head"><div><p className="eyebrow">P50 / P80 / P90</p><h2>Session breathing-room map <InfoMarker title="Comparing sessions" takeaway="Compare the P80 dots first; use the P50–P90 line to see how wide the full spread is.">Each row puts a session on the same ATR-normalised scale. A dot farther right means a wider adverse move relative to that session’s normal range.</InfoMarker></h2></div><span className="unit-pill">× session ATR</span></div><div className="whiskers">{rows.map(row => { const ci = cis.find(item => item.session === row.session); return <div className="whisker" key={row.session}><div className="whisker-label"><strong>{row.session}</strong><span>{fmt(row.days, 0)} days</span></div><div className="whisker-track"><div className="whisker-tail" style={{ left: `${row.p50 / max * 100}%`, width: `${(row.p90 - row.p50) / max * 100}%` }}/><i className="dot p50" style={{ left: `${row.p50 / max * 100}%` }}><span>P50 {fmt(row.p50, 2)}</span></i><i className="dot p80" style={{ left: `${row.p80 / max * 100}%` }}><span>P80 {fmt(row.p80, 2)}</span></i><i className="dot p90" style={{ left: `${row.p90 / max * 100}%` }}><span>P90 {fmt(row.p90, 2)}</span></i>{ci && <div className="ci-band" style={{ left: `${ci.low / max * 100}%`, width: `${(ci.high - ci.low) / max * 100}%` }}><span>95% CI</span></div>}</div><strong className="row-value">{fmt(row.p80, 2)}×</strong></div>})}</div><div className="axis-row"><span>0</span><span>{fmt(max, 1)}×</span></div><EvidenceNote>The narrow line around each P80 dot is its whole-day clustered 95% confidence interval. Overlapping intervals mean rank order should not be overstated.</EvidenceNote></article><article className="story-card"><div className="panel-head"><div><p className="eyebrow">08:30 onward · New York</p><h2>Cash-open pulse <InfoMarker title="Cash-open pulse" takeaway="Use this to understand when movement tends to expand or contract after 08:30—not when to enter.">Each point asks what the P80 adverse move looked like for a fresh entry snapshot in that five-minute clock bin.</InfoMarker></h2></div><span className="unit-pill">5-minute bins</span></div><LineChart points={cash} compact formatValue={v => `${fmt(v, 2)}×`}/><p className="chart-caption">Independent entry snapshots in each clock-time bin. This is a volatility shape, not a signal to enter.</p><div className="session-note"><span>Why normalise?</span><p>One NQ point in 2012 did not represent the same market scale as one point in 2026. Dividing by session ATR makes long-history comparisons more honest.</p></div></article></div>
    <article className="story-card wide"><div className="panel-head"><div><p className="eyebrow">NQ history applied to MNQ context</p><h2>Contract-overlap cross-check</h2></div><span className="unit-pill">17 common days</span></div><div className="overlap-grid">{data.overlap.filter(row => row.unit === "mae_atr").map(row => <div key={row.session}><span>{row.session}</span><div><i style={{ width: `${Math.min(100, row.nqP80 / 3 * 100)}%` }}/><b>NQ {fmt(row.nqP80, 2)}×</b></div><div><i style={{ width: `${Math.min(100, row.mnqP80 / 3 * 100)}%` }}/><b>MNQ {fmt(row.mnqP80, 2)}×</b></div><small>ratio {fmt(row.ratio, 3)}</small></div>)}</div><p className="chart-caption">A short overlap is a cross-check, not proof of permanent equivalence. Dollar multipliers are never mixed: MNQ uses $2 per point.</p></article>
  </section>;
}

function RegimesView({ data, session, setSession, horizon, setHorizon, yearStart, setYearStart }: { data: Data; session: string; setSession: (v: string) => void; horizon: number; setHorizon: (v: number) => void; yearStart: number; setYearStart: (v: number) => void }) {
  const rolling = data.rolling.filter(row => row.session === session && (row.horizon ?? 5) === horizon && Number(row.date.slice(0, 4)) >= yearStart).map(row => ({ label: row.date.slice(2, 7), value: row.value, detail: row.date }));
  const chronological = data.chronological.filter(row => row.session === session && (row.horizon ?? 5) === horizon && Number(row.week.slice(0, 4)) >= yearStart);
  const yearly = [...new Set(chronological.map(row => row.week.slice(0, 4)))].map(year => { const values = chronological.filter(row => row.week.startsWith(year)).map(row => row.p80Atr); values.sort((a, b) => a - b); return { label: year, value: values[Math.floor(values.length * .5)] ?? 0, detail: `${values.length} weeks` }; });
  return <section className="page subpage">
    <PageIntro eyebrow="Changing market conditions" title="Seasonality is not the whole story." body="See when the market’s normal pullback behaviour changed through time. Old history may deserve less weight when recent conditions look materially different." side={<div className="head-controls"><Select label="Session" value={session} onChange={setSession}>{SESSION_ORDER.map(item => <option key={item}>{item}</option>)}</Select><HorizonControl horizon={horizon} setHorizon={setHorizon}/></div>}/>
    <article className="story-card wide"><div className="panel-head"><div><p className="eyebrow">60 complete sessions · {horizon}-minute horizon</p><h2>Rolling P80 stability <InfoMarker title="Rolling 60-session view" takeaway="A sustained change matters more than one sharp point.">Every point looks back over the latest 60 complete sessions. This shows whether the market’s normalised breathing room gradually changed through time.</InfoMarker></h2></div><span className="unit-pill">× session ATR</span></div><LineChart points={rolling} formatValue={v => `${fmt(v, 2)}×`}/><div className="range-control"><label><span>Show history from</span><strong>{yearStart}</strong><input type="range" min="2010" max="2026" value={yearStart} onChange={event => setYearStart(Number(event.target.value))}/><div><span>2010</span><span>2026</span></div></label></div><EvidenceNote>Rolling windows overlap, so nearby points are related. Read this as a regime trace rather than thousands of independent tests.</EvidenceNote></article>
    <div className="story-grid equal"><article className="story-card"><div className="panel-head"><div><p className="eyebrow">Chronological ISO weeks</p><h2>Median weekly P80 by year</h2></div></div><LineChart points={yearly} compact formatValue={v => `${fmt(v, 2)}×`}/><p className="chart-caption">Each year marker summarises the median of its complete weekly P80 estimates for the selected session.</p></article><article className="story-card regime-copy"><p className="eyebrow">How a trader can use this</p><h2>Ask whether today resembles the pooled past.</h2><ol><li><span>1</span><p><strong>Define invalidation first.</strong> Mark the structure that proves the trade idea wrong.</p></li><li><span>2</span><p><strong>Compare its room.</strong> See whether that distance is ordinary or unusual for the selected session.</p></li><li><span>3</span><p><strong>Check the regime.</strong> If rolling volatility has shifted, pooled seasonal history may deserve less weight.</p></li><li><span>4</span><p><strong>Translate to MNQ.</strong> Size only after stop distance is independently set.</p></li></ol></article></div>
  </section>;
}

function ExecutionView({ data }: { data: Data }) {
  const holding = data.execution.filter(row => row.metric === "holding_seconds_contract_weighted");
  const maxHolding = Math.max(...holding.map(row => row.high));
  const accountMax = Math.max(...data.accountDays.map(row => Math.abs(row.netPnl)), 1);
  return <section className="page subpage">
    <PageIntro eyebrow="Actual trade records" title="Historical price behaviour meets real execution." body="These records show what happened in the supplied trades. They do not reveal every trader decision or prove that any stop was correct."/>
    <div className="story-grid equal"><article className="story-card"><div className="panel-head"><div><p className="eyebrow">Contract-weighted holding time</p><h2>How long positions stayed open</h2></div><span className="unit-pill">seconds</span></div><div className="holding-bars">{holding.map(row => <div key={row.probability}><span>P{Math.round(row.probability * 100)}</span><div><i style={{ width: `${row.estimate / maxHolding * 100}%` }}/><b>{fmt(row.estimate, 0)}s</b><em style={{ left: `${row.low / maxHolding * 100}%`, width: `${(row.high - row.low) / maxHolding * 100}%` }}/></div><small>95% CI {fmt(row.low, 0)}–{fmt(row.high, 0)}</small></div>)}</div><EvidenceNote>Uncertainty is clustered by identical or copied execution event so duplicated accounts are not treated as independent traders.</EvidenceNote></article><article className="story-card"><div className="panel-head"><div><p className="eyebrow">Supplied account-days</p><h2>Net P&amp;L footprint</h2></div><span className="unit-pill">descriptive only</span></div><div className="pnl-bars">{data.accountDays.map(row => <div key={`${row.account}-${row.day}`}><span>A{row.account}<small>{row.day.slice(5)}</small></span><div className="pnl-axis"><i className={row.netPnl >= 0 ? "positive" : "negative"} style={{ width: `${Math.abs(row.netPnl) / accountMax * 48}%` }}/></div><b className={row.netPnl >= 0 ? "positive-text" : "negative-text"}>{money(row.netPnl)}</b></div>)}</div></article></div>
    <article className="story-card wide"><div className="panel-head"><div><p className="eyebrow">$150 historical MNQ compatibility check</p><h2>Recorded losing distance versus quantity <InfoMarker title="Compatibility check" takeaway="Use this to see how quantity squeezes available stop distance, not to copy old exits.">This compares the losing entry-to-exit distance in supplied MNQ records with the largest distance that fit under the historical $150 scenario used in the source report. It does not know where a stop order was placed.</InfoMarker></h2></div><span className="unit-pill">not inferred stops</span></div><div className="risk-table"><div className="risk-row header"><span>MNQ qty</span><span>Modelled max stop</span><span>Median losing distance</span><span>P90 losing distance</span><span>Compatible records</span></div>{data.riskCompatibility.map(row => <div className="risk-row" key={row.quantity}><strong>{row.quantity}</strong><span>{fmt(row.maximumStop, 1)} pts</span><span>{fmt(row.medianDistance, 1)} pts</span><span>{fmt(row.p90Distance, 1)} pts</span><div className="compat"><i style={{ width: `${row.compatibilityRate * 100}%` }}/><b>{Math.round(row.compatibilityRate * 100)}%</b><small>n={row.records}</small></div></div>)}</div><p className="chart-caption">This table is preserved from the execution evidence set as a historical MNQ scenario. Use the Stop Check calculator for current editable NQ or MNQ per-side costs. No stop order is inferred.</p></article>
    <div className="story-grid equal"><article className="story-card"><p className="eyebrow">Thesis grouping sensitivity</p><h2>One idea can appear as many fills.</h2><div className="thesis-grid">{data.thesis.map(row => <div key={row.gapMinutes}><strong>{row.gapMinutes}m gap</strong><span>{row.groups} idea groups</span><span>{row.losingGroups} losing groups</span><span>P90 minimum observed risk {money(row.p90MinimumObservedRisk)}</span></div>)}</div></article><article className="story-card"><p className="eyebrow">After-loss descriptions</p><h2>Small samples, copied behaviour.</h2><div className="after-loss">{data.afterLoss.map(row => <div key={row.metric}><span>{row.metric.replace("P&L after ", "After ")}</span><strong>{money(row.medianPnl)}</strong><small>median · {row.days} account-days · {Math.round(row.positiveFraction * 100)}% positive</small></div>)}</div></article></div>
  </section>;
}

function EvidenceView({ data }: { data: Data }) {
  const [filter, setFilter] = useState("all");
  const classes = ["all", ...new Set(data.claims.map(row => row.classification))];
  const claims = filter === "all" ? data.claims : data.claims.filter(row => row.classification === filter);
  const fallback = data.meta.dataSourceFallback ?? [
    { instrument: "NQ", sourceId: "NQ_long_history", rank: 1, status: "available", available: true, notes: "Primary source for adverse-movement evidence." },
    { instrument: "MNQ", sourceId: "MNQ_U6_overlap", rank: 2, status: "limited overlap validation only", available: false, notes: "First fallback when NQ is unavailable." },
    { instrument: "US100", sourceId: "US100", rank: 3, status: "not available", available: false, notes: "Final fallback when futures data is unavailable." },
  ];
  return <section className="page subpage evidence-page">
    <PageIntro eyebrow="Evidence register" title="Every strong sentence needs a receipt." body="Observed facts, derived calculations and interpretations are deliberately separated. Open any entry to see its source and method. The info markers throughout the dashboard translate technical terms into trader language." side={<div className="receipt-mini"><span>Analysis manifest <InfoMarker title="Analysis manifest" takeaway="Matching hashes show that the dashboard used the intended analysis files.">A manifest is a receipt listing the expected files and their digital fingerprints. The exporter checks those fingerprints before creating the browser data.</InfoMarker></span><code>{data.meta.analysisManifestSha256.slice(0, 16)}…</code><small>{data.meta.verifiedFiles} dashboard inputs rechecked</small></div>}/>
    <div className="method-cards"><article><span>01</span><strong>Observe</strong><p>Count records and reconstruct sessions from controlled source files.</p></article><article><span>02</span><strong>Normalise</strong><p>Express adverse excursion in points, basis points and session ATR.</p></article><article><span>03</span><strong>Uncertainty</strong><p>Resample whole trading days 10,000 times to preserve within-day dependence.</p></article><article><span>04</span><strong>Interpret</strong><p>Describe context without converting it into a strategy rule.</p></article></div>
    <div className="evidence-layout"><aside><p className="eyebrow">Classification</p>{classes.map(item => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All claims" : item}<span>{item === "all" ? data.claims.length : data.claims.filter(row => row.classification === item).length}</span></button>)}<div className="method-note"><strong>Fixed controls</strong><p>New York futures trading-day close-date; degraded session-days excluded; 2026-08-11 analysis cutoff.</p></div></aside><div className="claim-list">{claims.map(row => <details key={row.id}><summary><span>{row.id}</span><div><small>{row.classification}</small><strong>{row.claim}</strong></div><b>+</b></summary><div className="claim-detail"><div><span>Source</span><p>{row.source}</p></div><div><span>Sample</span><p>{row.sample}</p></div><div><span>Method</span><p>{row.method}</p></div></div></details>)}</div></div>
    <article className="story-card wide quality-card"><div className="panel-head"><div><p className="eyebrow">Data-source hierarchy</p><h2>NQ first, fallback only when required</h2></div><span className="unit-pill">instrument source</span></div><div className="quality-grid">{fallback.map(row => <div key={row.instrument}><span>Rank {row.rank} · {row.sourceId}</span><strong>{row.instrument}</strong><p>{row.status}</p><small>{row.notes}</small></div>)}</div><EvidenceNote>Fallbacks are never silently blended. Each result should identify the source instrument and reconciliation status behind its evidence.</EvidenceNote></article>
    <article className="story-card wide quality-card"><div className="panel-head"><div><p className="eyebrow">Data-quality register</p><h2>Known conditions shown, not hidden</h2></div><span className="unit-pill">{data.quality.length} checks</span></div><div className="quality-grid">{data.quality.map(row => <div key={row.id}><span>{row.id} · {row.scope}</span><strong>{row.metric.replaceAll("_", " ")}</strong><p>{row.value}</p><small>{row.notes}</small></div>)}</div></article>
  </section>;
}
