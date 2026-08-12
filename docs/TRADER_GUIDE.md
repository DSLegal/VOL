# Trader guide: what the volatility report is saying

## The simple idea

A stop-loss should normally sit where the trade idea is proven wrong. But a technically valid stop can still be so close that ordinary market movement reaches it repeatedly.

This dashboard provides a second lens: after you define the stop from market structure, compare that distance with the amount of adverse movement that has historically occurred in the same session, month or week-of-year.

It is a comparison tool, not an automatic stop generator.

## What P50, P80 and P90 mean

The report measures maximum adverse excursion: the furthest price moved against a hypothetical entry during the next five or ten minutes.

- P50 is the middle historical observation. Half of measured excursions were smaller and half were larger.
- P80 is a wider-noise reference. Eighty per cent of measured excursions were at or below it, while twenty per cent were larger.
- P90 is tail context. Ten per cent of measured excursions were larger.

These levels do not say where price will move next. They describe the distribution of what happened in the measured history.

## Why there are both points and ATR-normalised results

Raw points answer: “How many NQ points did price move?” This is intuitive for placing an actual stop.

ATR-normalised results answer: “How large was that move compared with the normal movement of this session?” This matters because NQ’s price and point ranges changed substantially between 2010 and 2026. A 10-point move in an earlier period does not represent the same market condition as a 10-point move today.

Use points for the final distance comparison. Use ATR-normalised results to compare different years, months, weeks and sessions more fairly.

## Headline findings

In the headline five-minute, pooled-direction NY AM OR slice:

- March had a raw monthly P80 of 27.0 NQ points, based on 298 eligible trading days.
- October had the highest monthly ATR-normalised P80 at 2.458 times session ATR.
- February had the lowest at 2.390 times session ATR.
- The monthly confidence intervals overlap substantially. The small difference between October and February should not be treated as a reliable calendar trading edge.

Across ISO week numbers:

- Week 40 had the highest headline ATR-normalised P80 at 2.614, with a 95% confidence interval of 2.492 to 2.735 and 71 eligible days.
- Week 27 had the lowest at 2.243, with a 95% confidence interval of 2.140 to 2.344 and 71 eligible days.
- Week 53 has limited history and deserves extra caution.

The main practical finding is not that one month or week is “best.” It is that volatility changes across sessions and regimes, while many calendar differences remain uncertain.

## A sensible dashboard workflow

1. Define the price structure that invalidates the trade idea.
2. Measure the stop distance in NQ/MNQ points.
3. Select the matching session, entry horizon, direction and calendar period.
4. Compare the independent stop with P50, P80 and P90 historical adverse excursion.
5. Check the rolling regime view. If recent normalised volatility has shifted, give less weight to the all-years seasonal pool.
6. Translate the stop to MNQ risk only after the distance has been defined.

For MNQ, the dashboard uses:

`risk per contract = ($2 × stop distance in points) + round-trip cost`

`whole contracts = floor(risk budget ÷ risk per contract)`

This is arithmetic, not a recommendation.

## How to read uncertainty and sample size

The number of trading days is more important than the number of one-minute rows because nearby rows from the same day are related. Confidence intervals therefore resample whole trading days rather than pretending every row is independent.

Treat comparisons cautiously when:

- a period has fewer than 40 eligible days;
- confidence intervals overlap;
- a result relies on the short 17-day NQ/MNQ contract overlap;
- execution results contain copied or closely related accounts;
- a rolling window overlaps heavily with the previous point.

## What this analysis cannot tell you

It cannot identify the correct stop for a setup, predict whether a trade will win, prove a calendar edge, reconstruct an unrecorded stop order or determine an optimal position size. Slippage, liquidity, news, entry quality and the trader’s actual invalidation logic remain outside the historical noise measurement.
