# VOL NQ/MNQ Risk Planner

Production dashboard for reviewing an NQ or MNQ trade plan before entry. The trader supplies entry, invalidation, quantity and risk limit. The app estimates financial exposure, then compares the invalidation distance with historical NQ adverse movement.

This is historical context only. It does not provide a signal, choose an invalidation price, recommend quantity, forecast direction, or predict the next trade.

## What a trader can do

- Plan either MNQ or NQ risk using separate contract multipliers and editable per-side costs.
- Start from the latest available indicative NQ front-contract quote; the entry field refreshes automatically while tracking is enabled and remains manually editable.
- Auto-select the planned month and any active controlled session from `America/New_York` time, while allowing a deliberate manual override.
- Enter entry price, invalidation price, intended quantity, existing trade-idea risk, slippage and risk limit.
- Review estimated loss per contract, estimated loss for the intended quantity, combined trade-idea risk and difference from the entered limit.
- Compare the derived invalidation distance with P50, P80 and P90 historical NQ adverse movement.
- Choose a forward adverse-movement horizon of 1, 3, 5, 10, 15 or 30 minutes.
- See horizon-specific sample sizes, uncertainty ranges, period, session, direction, dates and source.
- Keep research views separate from the primary Trade Planner.

## Run locally

Prerequisites: Node.js 22.13 or newer, matching `.node-version`.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

In PowerShell, if `npm.ps1` is blocked by execution policy, use the Windows command shim:

```powershell
npm.cmd ci
npm.cmd run dev
```

The local dev command builds the GitHub Pages static bundle before serving it, so a fresh checkout can run without stale ignored output.

## Automatic planner context

The entry-price default comes from the `quote-feed` branch, which `.github/workflows/nq-quote.yml` refreshes every five minutes from the Yahoo Finance `NQ=F` chart feed. The UI displays the contract, provider timestamp and stale state, and instructs traders to verify the executable price with their broker. This is an indicative convenience value, not a licensed real-time CME feed.

The planned month and session are derived from the current New York clock. If the time falls outside the dashboard's controlled research windows, the app says so instead of assigning an unrelated session. Selecting a session or month manually pauses automatic context selection; the trader can resume it from the session helper.

## Verify

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:github
```

`npm test` runs linting, type-checking, both production builds, domain/data tests,
and a real-browser desktop/mobile/accessibility workflow. The browser test uses
an installed Chrome or Microsoft Edge; both are present on standard GitHub-hosted
runners and ordinary Windows installations.

## Publish with GitHub Pages

The repository includes `.github/workflows/pages.yml`. The workflow runs the quality gates, builds `github-pages/`, uploads the artifact and deploys GitHub Pages.

For this repository, the production URL is:

https://dslegal.github.io/VOL/

## Data

The default planner route loads `public/data/planner-data.json`, a compact month/session/horizon extract. Research screens lazy-load `public/data/dashboard-data.json`.

Data-source hierarchy:

- NQ: primary movement source.
- MNQ: first fallback only when a controlled validation is available.
- US100: final fallback only when a controlled validation is available.

Fallbacks are never silently blended into NQ results. Every result identifies the data source used.

Directional month slices have point estimates and exact sample counts. Where the
controlled analysis did not produce a confidence interval for that exact slice,
the planner labels and shows the broader all-month, pooled-direction session
interval separately rather than presenting it as a context-specific interval.

To regenerate browser data from the controlled analysis outputs:

```bash
npm run data
```

The exporter reads `../nq_long_history_outputs_horizons` when present and falls back to `../nq_long_history_outputs`.

## Project Structure

- `components/VolatilityDashboard.tsx` - interactive planner and research views.
- `components/dashboard-math.mjs` - risk, validation, horizon and source-selection helpers.
- `app/` - vinext/Sites route shell.
- `github/` and `vite.github.config.ts` - static GitHub Pages entry and build.
- `public/data/` - browser-ready data extracts.
- `scripts/` - static server and reproducible data builder.
- `tests/` - quality gates for calculations, data, build output and production copy.
- `docs/TRADER_GUIDE.md` - plain-language trader guidance.
- `.github/workflows/pages.yml` - GitHub Pages deployment.

## Evidence Controls

- Raw NQ DBN records: 6,486,332.
- Coverage: 2010-06-06 through 2026-08-11.
- Trading-day grouping timezone: America/New_York.
- Bootstrap: 10,000 whole-day clustered replications, fixed seed 20260811.
- Degraded session-days are excluded from the relevant calculations.
