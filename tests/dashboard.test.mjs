import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { calculateContractRisk, nearestHorizons, selectDataSource, SUPPORTED_HORIZONS } from "../components/dashboard-math.mjs";

test("holding-time mapping preserves nearest-horizon ties", () => {
  assert.deepEqual(SUPPORTED_HORIZONS, [1, 3, 5, 10, 15, 30]);
  assert.deepEqual(nearestHorizons(2), [1, 3]);
  assert.deepEqual(nearestHorizons(4), [3, 5]);
  assert.deepEqual(nearestHorizons(8), [10]);
  assert.deepEqual(nearestHorizons(22.5), [15, 30]);
  assert.deepEqual(nearestHorizons(0), []);
});

test("NQ and MNQ arithmetic uses per-side costs and correct multipliers", () => {
  assert.deepEqual(calculateContractRisk({ stopPoints: 18, dollarsPerPoint: 2, costPerSide: 0.5, riskBudget: 150 }), {
    roundTripCost: 1, riskPerContract: 37, wholeContracts: 4, usedRisk: 148, unallocatedRisk: 2,
  });
  assert.deepEqual(calculateContractRisk({ stopPoints: 18, dollarsPerPoint: 20, costPerSide: 1.75, riskBudget: 500 }), {
    roundTripCost: 3.5, riskPerContract: 363.5, wholeContracts: 1, usedRisk: 363.5, unallocatedRisk: 136.5,
  });
});

test("data-source selection follows NQ then MNQ then US100 without blending", () => {
  const sources = [
    { instrument: "US100", rank: 3, available: true },
    { instrument: "MNQ", rank: 2, available: true },
    { instrument: "NQ", rank: 1, available: false },
  ];
  assert.equal(selectDataSource(sources)?.instrument, "MNQ");
  assert.equal(selectDataSource(sources.filter(source => source.instrument === "US100"))?.instrument, "US100");
  assert.equal(selectDataSource(sources.map(source => ({ ...source, available: false }))), null);
});

test("vinext server renders the finished dashboard shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Historical Volatility Stop-Loss Lab/);
  assert.match(html, /Preparing the volatility lab/);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview/);
});

test("static GitHub Pages build contains the app and controlled data", async () => {
  const [html, dataText, assetFiles] = await Promise.all([
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/data/dashboard-data.json", import.meta.url), "utf8"),
    stat(new URL("../github-pages/assets", import.meta.url)),
  ]);
  assert.match(html, /Historical Volatility Stop-Loss Lab/);
  assert.equal(assetFiles.isDirectory(), true);
  const data = JSON.parse(dataText);
  assert.equal(data.meta.records, 6_486_332);
  assert.equal(data.meta.bootstrapReplications, 10_000);
  assert.ok(data.seasonal.length > 3_000);
  assert.ok(data.chronological.length > 7_000);
  assert.ok(data.claims.length > 10);
  assert.deepEqual(data.meta.supportedHorizons, [1, 3, 5, 10, 15, 30]);
  assert.equal(data.meta.defaultHorizon, 5);
  assert.equal(data.meta.tradingInstruments.MNQ.defaultCostPerSide, 0.5);
  assert.equal(data.meta.tradingInstruments.NQ.defaultCostPerSide, 1.75);
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
  assert.match(source, /Choose approximately how long the position normally remains exposed/);
  assert.match(source, /Historical horizons provide comparison windows\. No horizon defines the correct stop/);
  assert.match(source, /Nearest available horizon/);
  assert.match(source, /MNQ.*0\.5/s);
  assert.match(source, /NQ.*1\.75/s);
});

test("local static server rejects malformed encoded URLs", async () => {
  const { spawn } = await import("node:child_process");
  const port = 3199;
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
    const response = await fetch(`http://127.0.0.1:${port}/%`);
    assert.equal(response.status, 400);
  } finally {
    child.kill();
  }
});
