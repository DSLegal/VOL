# Trader Guide

## The Simple Idea

Start with your own trade plan. Mark the entry, the price that invalidates the idea, the intended quantity and the amount of risk you are willing to commit to that trade idea.

The planner then does two separate jobs:

- It estimates the dollar loss if the trade reaches the entered invalidation with the execution assumptions shown on screen.
- It compares the invalidation distance with historical NQ adverse movement for the selected month, session, direction and horizon.

It is a comparison tool. It does not choose an invalidation price, choose quantity, provide a signal, predict profit potential, or predict the next market move.

## What P50, P80 and P90 Mean

The report measures maximum adverse excursion: the furthest price moved against a hypothetical entry during the selected forward adverse-movement horizon.

- P50: half of selected historical observations were at or below this distance; half were above.
- P80: eight in ten selected historical observations were at or below this distance; two in ten were above.
- P90: nine in ten selected historical observations were at or below this distance; one in ten was above.

These are historical reference points, not probabilities for the next trade.

The selected directional month slice shows its own observation and trading-day
counts. If the controlled analysis did not produce an interval for that exact
slice, the app identifies the broader all-month, pooled-direction session
estimate and interval separately. It does not relabel that broader interval as
uncertainty around the selected directional result.

## Horizon

The supported forward adverse-movement horizons are 1, 3, 5, 10, 15 and 30 minutes. Five minutes is the initial short-term reference.

Use the horizon that is closest to the time the position normally remains exposed. If a holding time is equally close to two supported horizons, the planner asks you to choose one. It does not interpolate between horizons.

No horizon defines the correct invalidation.

## Financial Risk

The app estimates exposure from the trader's entered plan.

For MNQ:

`estimated loss per contract = ((invalidation distance + assumed slippage) x $2) + editable round-trip cost`

Default MNQ cost is `$0.50` per side.

For NQ:

`estimated loss per contract = ((invalidation distance + assumed slippage) x $20) + editable round-trip cost`

Default NQ cost is `$1.75` per side.

The app then multiplies by the intended quantity and adds existing risk already committed to the same trade idea. It shows the difference from the risk limit you entered. It does not calculate how many contracts to trade.

Actual loss can exceed the estimate because of slippage, thin liquidity, news, gaps, platform behavior or fills beyond the entered invalidation.

## Source Hierarchy

Historical movement source order:

- NQ primary source.
- MNQ fallback only when the fallback is controlled and validated for the context.
- US100 fallback only when the fallback is controlled and validated for the context.

The app does not silently blend sources. Every result names the movement source separately from the trading instrument used for dollar calculations.

## Sensible Workflow

1. Define the chart structure that invalidates the trade idea.
2. Enter NQ or MNQ, side, entry, invalidation, intended quantity and risk limit.
3. Add costs, slippage and any existing risk on the same trade idea.
4. Choose the planned session, month and forward adverse-movement horizon.
5. Read the financial risk first.
6. Compare the invalidation distance with P50, P80 and P90 historical references.
7. Decide outside the app whether to keep the plan, reduce quantity, improve entry, or skip the trade.

## What This Analysis Cannot Tell You

It cannot identify the correct invalidation, predict whether a trade will win, prove a calendar edge, reconstruct an unrecorded order, determine an optimal quantity, or account for all execution conditions. Entry quality, liquidity, news, discipline and the trader's own reasoning remain outside the historical measurement.
