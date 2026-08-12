import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

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
});

test("headline month and week findings remain present", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/dashboard-data.json", import.meta.url), "utf8"));
  const march = data.seasonal.find(row => row.periodType === "month" && row.period === "March" && row.session === "NY AM OR" && row.horizon === 5 && row.direction === "pooled");
  const w40 = data.seasonal.find(row => row.periodType === "week" && row.period === "W40" && row.session === "NY AM OR" && row.horizon === 5 && row.direction === "pooled");
  assert.equal(march.p80Points, 27);
  assert.equal(march.days, 298);
  assert.equal(w40.p80Atr, 2.614376);
  assert.equal(w40.days, 71);
});
