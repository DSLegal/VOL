import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const axePath = require.resolve("axe-core/axe.min.js");
const port = 3299;
const baseUrl = `http://127.0.0.1:${port}`;

async function launchInstalledBrowser() {
  const channels = process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Try the next installed browser family.
    }
  }

  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const executablePath = candidates.find(existsSync);
  if (!executablePath) throw new Error("A local Chrome or Edge installation is required for production browser tests.");
  return chromium.launch({ executablePath, headless: true });
}

async function startServer() {
  const child = spawn(process.execPath, ["scripts/serve-static.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("production preview did not start")), 10_000);
    child.stdout.on("data", data => {
      if (String(data).includes(`:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", code => reject(new Error(`production preview exited with ${code}`)));
  });
  return child;
}

test("production planner works on desktop/mobile and handles data failure", { timeout: 90_000 }, async () => {
  const server = await startServer();
  const browser = await launchInstalledBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.route("**/nq-quote.json*", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        instrument: "NQ",
        symbol: "NQ=F",
        contract: "Nasdaq 100 Sep 26",
        price: 20000.25,
        asOf: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        provider: "Yahoo Finance",
        providerUrl: "https://finance.yahoo.com/quote/NQ=F/",
        exchange: "CME",
        indicative: true,
      }),
    }));
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await assert.doesNotReject(() => page.getByRole("heading", { name: "No personalized result yet." }).waitFor());
    assert.equal(await page.getByLabel("Entry price").inputValue(), "20000.25");
    await assert.doesNotReject(() => page.getByText(/Auto-update is on/).waitFor());
    await page.getByLabel("Planned entry session").selectOption("NY AM OR");
    assert.equal(await page.getByText("Maximum contracts").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    await page.getByLabel("Entry price").fill("20000");
    await page.getByLabel("Invalidation price").fill("19990");
    await page.getByLabel("Intended quantity").fill("2");
    await page.getByLabel("Trade-idea risk limit").fill("100");
    await assert.doesNotReject(() => page.getByText("US$21.00", { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText("US$42.00", { exact: true }).first().waitFor());
    await assert.doesNotReject(() => page.getByText(/Movement history source: NQ/).waitFor());
    await assert.doesNotReject(() => page.getByText(/broader all-month, pooled-direction 80% estimate/).waitFor());

    await page.getByRole("textbox", { name: /Forward adverse-movement horizon/ }).fill("4");
    await assert.doesNotReject(() => page.getByText("Two horizons are equally close.").waitFor());
    await assert.doesNotReject(() => page.getByRole("heading", { name: "No personalized result yet." }).waitFor());
    await page.getByRole("button", { name: "3 min", exact: true }).click();
    await assert.doesNotReject(() => page.getByText(/Selected context:.*3 minutes/).waitFor());

    await page.getByRole("textbox", { name: /Forward adverse-movement horizon/ }).fill("60");
    await assert.doesNotReject(() => page.getByText(/outside the controlled 1-30 minute range/).first().waitFor());
    await assert.doesNotReject(() => page.getByRole("heading", { name: "No personalized result yet." }).waitFor());
    await page.getByRole("button", { name: "30 min", exact: true }).click();
    await assert.doesNotReject(() => page.getByText(/Selected context:.*30 minutes/).waitFor());

    await page.getByRole("button", { name: "Historical Patterns" }).click();
    await assert.doesNotReject(() => page.getByText(/P80, .* days, 30 minutes/).first().waitFor({ timeout: 15_000 }));
    await page.getByRole("button", { name: "Data & Method" }).click();
    await assert.doesNotReject(() => page.getByRole("heading", { name: "Source hierarchy" }).waitFor());

    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("button", { name: "Trade Planner" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const undersizedButtons = await page.locator("button:visible").evaluateAll(buttons => buttons.filter(button => {
      const rect = button.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    }).map(button => ({ text: button.textContent, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    assert.deepEqual(undersizedButtons, []);

    await page.addScriptTag({ path: axePath });
    const seriousViolations = await page.evaluate(async () => {
      const result = await globalThis.axe.run(document, { resultTypes: ["violations"] });
      return result.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical").map(violation => violation.id);
    });
    assert.deepEqual(seriousViolations, []);
    await context.close();

    const failureContext = await browser.newContext();
    const failurePage = await failureContext.newPage();
    await failurePage.route("**/data/planner-data.json", route => route.fulfill({ status: 200, contentType: "application/json", body: "{" }));
    await failurePage.route("**/data/dashboard-data.json", route => route.abort("failed"));
    await failurePage.goto(baseUrl, { waitUntil: "load" });
    await assert.doesNotReject(() => failurePage.getByRole("heading", { name: "Dashboard data did not load." }).waitFor());
    await failureContext.close();

    const offlineContext = await browser.newContext();
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(baseUrl, { waitUntil: "networkidle" });
    await offlineContext.setOffline(true);
    await offlinePage.getByRole("button", { name: "Historical Patterns" }).click();
    await assert.doesNotReject(() => offlinePage.getByText(/Research extract did not load/).waitFor());
    await offlineContext.close();
  } finally {
    await browser.close();
    server.kill();
  }
});
