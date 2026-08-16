# Historical Volatility Stop-Loss Lab

An interactive, evidence-controlled dashboard for exploring how far NQ moved against a hypothetical entry over the next 1, 3, 5, 10, 15 or 30 minutes. The history is grouped by session, calendar month, ISO week-of-year and chronological regime, then translated into NQ or MNQ risk arithmetic after the trader supplies an independent structural stop.

![Historical Volatility Stop-Loss Lab](public/og.png)

## What a trader can do

- Compare historical P50, P80 and P90 adverse excursion for nine trading sessions.
- Switch between 1, 3, 5, 10, 15 and 30-minute forward adverse-movement horizons, with 5 minutes as the default scalper view.
- Enter a typical holding time and see the nearest available horizon without treating it as trading advice.
- Explore month-of-year and ISO week-of-year volatility in points or ATR-normalised units.
- Check whether a structural stop sits inside or beyond historical noise bands.
- Translate the stop to whole-contract arithmetic using separate NQ and MNQ multipliers and editable per-side costs.
- Inspect rolling regimes, NQ/MNQ overlap, execution descriptions, confidence intervals and the evidence register.

This is historical market-noise context. It does not define a strategy stop, forecast, signal or optimal position size.

## Run locally

Prerequisites: Node.js 22.13 (the version recorded in `.node-version`).

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

The default local command rebuilds the static dashboard before serving it, so a
fresh checkout does not depend on a stale ignored `github-pages` folder. If you
only want to serve an already-built static dashboard, use `npm run preview`. For
full source hot reloading on a machine that permits native Node build modules,
use `npm run dev:vinext`.

The same commands work in PowerShell, Command Prompt, macOS and Linux. If
PowerShell reports that `npm.ps1` cannot run because script execution is
disabled, use the Windows command shim instead: `npm.cmd ci`, followed by
`npm.cmd run dev`. This does not require changing the machine's execution
policy. On a fresh checkout, always install dependencies before starting the
development server.

To verify both the application and the GitHub Pages build:

```bash
npm test
```

The GitHub Pages workflow runs linting, type-checking, tests and a static build
before deployment.

## Publish with GitHub Pages

The repository includes `.github/workflows/pages.yml`. After pushing the project to a GitHub repository:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Push to the `main` branch, or run **Deploy dashboard to GitHub Pages** manually from the Actions tab.

The workflow installs the locked dependencies, creates the static site in `github-pages/`, uploads it and deploys it. Relative asset paths allow the dashboard to run from either a user site or a project repository path.

The published address will normally be `https://<account>.github.io/<repository>/`.

## Data lineage and regeneration

The committed browser dataset is `public/data/dashboard-data.json`. The six-horizon extract is built from `../nq_long_history_outputs_horizons` (falling back to the legacy `../nq_long_history_outputs` location) and verified against `generated_output_manifest.json` before export.

The intended data-source hierarchy is NQ first, MNQ second, then US100. The
current long-history browser extract uses NQ as the primary data instrument and
labels that source explicitly. MNQ overlap data is retained as degraded
cross-check evidence; US100 proxy data is not silently mixed into NQ point
thresholds.

To regenerate it on a machine that has those controlled outputs:

```bash
npm run data
```

The exporter is `scripts/build_dashboard_data.py`. It selects the required rows, compacts the fields and records the analysis-manifest and raw-DBN hashes inside the browser dataset. The GitHub deployment uses the committed JSON so the large private/raw source files are never uploaded.

## Project structure

- `components/VolatilityDashboard.tsx` — shared interactive interface.
- `app/` — vinext/Sites application entry.
- `github/` and `vite.github.config.ts` — static GitHub Pages entry and build.
- `public/data/` — controlled browser data extract.
- `scripts/` — reproducible extract builder.
- `tests/` — application, static-build and headline-finding checks.
- `docs/TRADER_GUIDE.md` — plain-language findings and interpretation.
- `.github/workflows/pages.yml` — GitHub Pages deployment.

## Evidence controls

- Primary data instrument: NQ long-history futures.
- Fallback order: NQ, then MNQ, then US100 proxy when a controlled source is available.
- Raw NQ DBN records: 6,486,332.
- Coverage: 2010-06-06 through 2026-08-11.
- Trading-day grouping timezone: America/New_York.
- Bootstrap: 10,000 whole-day clustered replications, fixed seed 20260811.
- Degraded session-days are excluded from the relevant calculations.
- The dashboard shows sample days and warnings before interpretation.

## Licence

The application code is provided under the MIT licence. Historical data and third-party source files are not relicensed or included.
