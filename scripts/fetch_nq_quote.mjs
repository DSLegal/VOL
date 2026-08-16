import { writeFile } from "node:fs/promises";

const outputPath = process.argv[2];
const endpoints = [
  "https://query2.finance.yahoo.com/v8/finance/chart/NQ=F?interval=1m&range=1d",
  "https://query1.finance.yahoo.com/v8/finance/chart/NQ=F?interval=1m&range=1d",
];

async function fetchQuote() {
  const failures = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          "User-Agent": "VOL-NQ-risk-planner/1.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const meta = payload?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      const marketTime = Number(meta?.regularMarketTime);
      if (!Number.isFinite(price) || price <= 0 || Math.abs(price * 4 - Math.round(price * 4)) > 1e-9) {
        throw new Error("provider returned a non-tick-aligned price");
      }
      if (!Number.isFinite(marketTime) || marketTime <= 0) throw new Error("provider returned no market timestamp");
      return {
        schemaVersion: 1,
        instrument: "NQ",
        symbol: String(meta.symbol || "NQ=F"),
        contract: String(meta.shortName || "E-mini Nasdaq-100 front contract"),
        price,
        asOf: new Date(marketTime * 1000).toISOString(),
        fetchedAt: new Date().toISOString(),
        provider: "Yahoo Finance",
        providerUrl: "https://finance.yahoo.com/quote/NQ=F/",
        exchange: String(meta.fullExchangeName || meta.exchangeName || "CME"),
        indicative: true,
      };
    } catch (error) {
      failures.push(`${new URL(endpoint).hostname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to refresh NQ quote: ${failures.join("; ")}`);
}

const quote = await fetchQuote();
const json = `${JSON.stringify(quote, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, json, "utf8");
else process.stdout.write(json);
