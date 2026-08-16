import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  calculatePlannedRisk,
  deriveInvalidationDistance,
  getNewYorkPlannerContext,
  isQuarterPoint,
  isQuoteStale,
  nearestHorizons,
  resolveHoldingHorizon,
  selectDataSource,
  SUPPORTED_HORIZONS,
  TRADING_INSTRUMENTS,
} from "../components/dashboard-math.mjs";

test("New York planner context selects only active controlled windows", () => {
  assert.deepEqual(getNewYorkPlannerContext(new Date("2026-08-17T13:45:00Z")), {
    month: "August",
    session: "NY AM OR",
    sessionValue: "NY AM OR",
    newYorkTime: "Mon 09:45",
  });
  assert.equal(getNewYorkPlannerContext(new Date("2026-08-17T14:15:00Z")).session, "NY AM SB");
  assert.equal(getNewYorkPlannerContext(new Date("2026-08-17T00:30:00Z")).session, "Asia KZ");
  assert.equal(getNewYorkPlannerContext(new Date("2026-08-16T20:45:00Z")).sessionValue, "Outside research windows");
  assert.equal(isQuoteStale("2026-08-17T13:30:00Z", new Date("2026-08-17T13:45:00Z")), false);
  assert.equal(isQuoteStale("2026-08-17T12:00:00Z", new Date("2026-08-17T13:45:00Z")), true);
  assert.equal(isQuoteStale("invalid", new Date("2026-08-17T13:45:00Z")), true);
});

test("holding-time mapping preserves nearest-horizon ties", () => {
  assert.deepEqual(SUPPORTED_HORIZONS, [1, 3, 5, 10, 15, 30]);
  assert.deepEqual(nearestHorizons(2), [1, 3]);
  assert.deepEqual(nearestHorizons(4), [3, 5]);
  assert.deepEqual(nearestHorizons(8), [10]);
  assert.deepEqual(nearestHorizons(22.5), [15, 30]);
  assert.deepEqual(nearestHorizons(0), []);
  assert.equal(resolveHoldingHorizon(60).status, "outside-range");
  assert.deepEqual(resolveHoldingHorizon(22.5).candidates, [15, 30]);
  assert.equal(resolveHoldingHorizon(22.5).resolvedHorizon, null);
  assert.equal(resolveHoldingHorizon(22.5, SUPPORTED_HORIZONS, 30).resolvedHorizon, 30);
});

test("entry and invalidation validation derives distance without rounding", () => {
  assert.equal(isQuarterPoint(17500.25), true);
  assert.equal(isQuarterPoint(17500.1), false);
  assert.deepEqual(deriveInvalidationDistance({ side: "long", entry: 17500, invalidation: 17482 }), { ok: true, distance: 18, message: "" });
  assert.deepEqual(deriveInvalidationDistance({ side: "short", entry: 17500, invalidation: 17518 }), { ok: true, distance: 18, message: "" });
  assert.equal(deriveInvalidationDistance({ side: "long", entry: 17500, invalidation: 17501 }).ok, false);
  assert.equal(deriveInvalidationDistance({ side: "short", entry: 17500, invalidation: 17499 }).ok, false);
});

test("NQ and MNQ arithmetic uses intended quantity, per-side costs and slippage", () => {
  assert.deepEqual(TRADING_INSTRUMENTS.MNQ, { dollarsPerPoint: 2, defaultCostPerSide: 0.5 });
  assert.deepEqual(TRADING_INSTRUMENTS.NQ, { dollarsPerPoint: 20, defaultCostPerSide: 1.75 });
  assert.deepEqual(calculatePlannedRisk({ stopPoints: 18, dollarsPerPoint: 2, costPerSide: 0.5, slippagePoints: 0.5, quantity: 3, riskLimit: 150, existingRisk: 20 }), {
    roundTripCost: 1,
    riskPerContract: 38,
    plannedRisk: 114,
    combinedRisk: 134,
    differenceFromLimit: 16,
    withinLimit: true,
  });
  assert.deepEqual(calculatePlannedRisk({ stopPoints: 18, dollarsPerPoint: 20, costPerSide: 1.75, slippagePoints: 0, quantity: 2, riskLimit: 500, existingRisk: 0 }), {
    roundTripCost: 3.5,
    riskPerContract: 363.5,
    plannedRisk: 727,
    combinedRisk: 727,
    differenceFromLimit: -227,
    withinLimit: false,
  });
});

test("data-source selection withholds unvalidated fallbacks and never blends", () => {
  const sources = [
    { instrument: "US100", rank: 3, available: true, status: "validated comparability approved", sourceId: "US100", provider: "" },
    { instrument: "MNQ", rank: 2, available: true, status: "limited overlap validation only" },
    { instrument: "NQ", rank: 1, available: false, status: "available" },
  ];
  assert.equal(selectDataSource(sources), null);
  assert.equal(selectDataSource(sources.filter(source => source.instrument === "US100")), null);
  assert.equal(selectDataSource([{ instrument: "MNQ", rank: 2, available: true, status: "validated comparability approved" }])?.instrument, "MNQ");
  assert.equal(selectDataSource([{ instrument: "MNQ", rank: 2, available: true, comparabilityApproved: true }])?.instrument, "MNQ");
  assert.equal(selectDataSource([{ instrument: "NQ", rank: 1, available: true, status: "available" }, ...sources])?.instrument, "NQ");
  assert.equal(selectDataSource(sources.filter(source => source.instrument === "US100")), null);
  assert.equal(selectDataSource([{ instrument: "US100", rank: 3, available: true, status: "validated comparability approved", sourceId: "US100_CFD_TwelveData", provider: "Twelve Data" }])?.instrument, "US100");
  assert.equal(selectDataSource(sources.map(source => ({ ...source, available: false }))), null);
});

test("vinext build emits the production app package", async () => {
  const [serverEntry, serverConfig, serverAssets, ssrAssets] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/vinext-server.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/vinext-client-assets.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/ssr/vinext-client-assets.js", import.meta.url), "utf8"),
  ]);
  assert.match(serverEntry, /fetch/);
  assert.match(JSON.parse(serverConfig).prerenderSecret, /^[a-f0-9]{64}$/);
  assert.match(serverAssets, /VolatilityDashboard/);
  assert.match(ssrAssets, /VolatilityDashboard/);
});

test("static GitHub Pages build contains the app and split controlled data", async () => {
  const [html, dataText, plannerText, assetFiles] = await Promise.all([
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/data/dashboard-data.json", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/data/planner-data.json", import.meta.url), "utf8"),
    stat(new URL("../github-pages/assets", import.meta.url)),
  ]);
  assert.match(html, /VOL NQ\/MNQ Risk Planner/);
  assert.equal(assetFiles.isDirectory(), true);
  const data = JSON.parse(dataText);
  const planner = JSON.parse(plannerText);
  assert.equal(data.meta.records, 6_486_332);
  assert.equal(data.meta.bootstrapReplications, 10_000);
  assert.ok(data.chronological.length > 7_000);
  assert.deepEqual(data.meta.supportedHorizons, [1, 3, 5, 10, 15, 30]);
  assert.deepEqual(planner.meta.supportedHorizons, [1, 3, 5, 10, 15, 30]);
  assert.ok(planner.seasonal.every(row => row.periodType === "month"));
  assert.ok(planner.seasonalCI.every(row => row.periodType === "month" && row.unit === "points"));
  assert.deepEqual([...new Set(planner.sessionCI.map(row => row.metric))].sort(), ["p50", "p80", "p90"]);
  assert.deepEqual([...new Set(planner.sessionCI.map(row => row.horizon))].sort((a, b) => a - b), [1, 3, 5, 10, 15, 30]);
  assert.ok(plannerText.length < dataText.length / 10);
  assert.equal(planner.meta.tradingInstruments.MNQ.defaultCostPerSide, 0.5);
  assert.equal(planner.meta.tradingInstruments.NQ.defaultCostPerSide, 1.75);
});

test("expanded horizon data and evidence remain present", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/dashboard-data.json", import.meta.url), "utf8"));
  const horizons = [...new Set(data.seasonal.map(row => row.horizon))].sort((a, b) => a - b);
  assert.deepEqual(horizons, [1, 3, 5, 10, 15, 30]);
  const march = data.seasonal.find(row => row.periodType === "month" && row.period === "March" && row.session === "NY AM OR" && row.horizon === 5 && row.direction === "pooled");
  const oneMinute = data.seasonal.find(row => row.periodType === "month" && row.period === "March" && row.session === "NY AM OR" && row.horizon === 1 && row.direction === "pooled");
  const thirtyMinute = data.seasonal.find(row => row.periodType === "month" && row.period === "March" && row.session === "NY AM OR" && row.horizon === 30 && row.direction === "pooled");
  const marchP50Ci = data.seasonalCI.find(row => row.periodType === "month" && row.period === "March" && row.session === "NY AM OR" && row.horizon === 5 && row.unit === "points" && row.metric === "p50");
  assert.equal(march.p80Points, 27);
  assert.equal(march.days, 298);
  assert.ok(oneMinute.p80Points < march.p80Points);
  assert.ok(thirtyMinute.p80Points > march.p80Points);
  assert.equal(march.dataInstrument, "NQ");
  assert.equal(march.sourceRank, 1);
  assert.ok(marchP50Ci.low > 0);
  assert.ok(marchP50Ci.high >= marchP50Ci.low);
});

test("dashboard source includes the trader-facing controls and warnings", async () => {
  const source = await readFile(new URL("../components/VolatilityDashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /Forward adverse-movement horizon/);
  assert.match(source, /planner-data\.json/);
  assert.match(source, /quote-feed\/nq-quote\.json/);
  assert.match(source, /Auto-update is on/);
  assert.match(source, /getNewYorkPlannerContext/);
  assert.match(source, /Choose approximately how long the position normally remains exposed/);
  assert.match(source, /No personalized result yet/);
  assert.match(source, /Actual loss can exceed this estimate/);
  assert.match(source, /Intended quantity/);
  assert.match(source, /MNQ.*0\.5/s);
  assert.match(source, /NQ.*1\.75/s);
  assert.doesNotMatch(source, /Maximum contracts|Arithmetic capacity|recommended size|safe stop|normal pullback|breathing room|Wider pullback|Extreme pullback|Will your stop survive/);
});

test("local static server handles GitHub Pages base-path assets and rejects malformed encoded URLs", async () => {
  const { spawn } = await import("node:child_process");
  const port = 3199;
  const assets = await readdir(new URL("../github-pages/assets", import.meta.url));
  const jsAsset = assets.find(file => file.endsWith(".js"));
  assert.ok(jsAsset);
  const child = spawn(process.execPath, ["scripts/serve-static.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 8_000);
    child.stdout.on("data", data => {
      if (String(data).includes(`:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", code => reject(new Error(`server exited with ${code}`)));
  });
  try {
    const [basePage, baseAsset, malformed] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/VOL/`),
      fetch(`http://127.0.0.1:${port}/VOL/assets/${jsAsset}`),
      fetch(`http://127.0.0.1:${port}/%`),
    ]);
    assert.equal(basePage.status, 200);
    assert.match(await basePage.text(), /VOL NQ\/MNQ Risk Planner/);
    assert.equal(baseAsset.status, 200);
    assert.match(baseAsset.headers.get("content-type") ?? "", /javascript/);
    assert.equal(malformed.status, 400);
  } finally {
    child.kill();
  }
});
