export const SUPPORTED_HORIZONS = Object.freeze([1, 3, 5, 10, 15, 30]);

export const TICK_SIZE = 0.25;

export const TRADING_INSTRUMENTS = Object.freeze({
  MNQ: { dollarsPerPoint: 2, defaultCostPerSide: 0.5 },
  NQ: { dollarsPerPoint: 20, defaultCostPerSide: 1.75 },
});

export const OUTSIDE_RESEARCH_SESSION = "Outside research windows";

const NEW_YORK_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Return the controlled research window active at a New York timestamp. */
export function getNewYorkPlannerContext(date = new Date()) {
  const parts = Object.fromEntries(NEW_YORK_PARTS.formatToParts(date).map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday;
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const asiaTradingDay = weekday === "Sun" || ["Mon", "Tue", "Wed", "Thu"].includes(weekday);
  let session = null;

  if (asiaTradingDay && minutes >= 20 * 60) session = "Asia KZ";
  else if (isWeekday && minutes >= 2 * 60 && minutes < 5 * 60) session = "London KZ";
  else if (isWeekday && minutes >= 7 * 60 && minutes < 7 * 60 + 30) session = "Pre-Market OR";
  else if (isWeekday && minutes >= 8 * 60 + 30 && minutes < 9 * 60 + 30) session = "08:30 OR";
  else if (isWeekday && minutes >= 9 * 60 + 30 && minutes < 10 * 60) session = "NY AM OR";
  else if (isWeekday && minutes >= 10 * 60 && minutes < 11 * 60) session = "NY AM SB";
  else if (isWeekday && minutes >= 11 * 60 + 30 && minutes < 13 * 60 + 30) session = "NY Lunch";
  else if (isWeekday && minutes >= 13 * 60 + 30 && minutes < 16 * 60) session = "NY PM KZ";

  return {
    month: parts.month,
    session,
    sessionValue: session ?? OUTSIDE_RESEARCH_SESSION,
    newYorkTime: `${parts.weekday} ${String(parts.hour).padStart(2, "0")}:${parts.minute}`,
  };
}

export function isQuoteStale(asOf, now = new Date(), staleAfterMinutes = 30) {
  const timestamp = new Date(asOf).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > staleAfterMinutes * 60_000;
}

const finiteNumber = value => typeof value === "number" && Number.isFinite(value);

export function isTickAligned(value, tickSize = TICK_SIZE) {
  if (!finiteNumber(value)) return false;
  const ticks = value / tickSize;
  return Math.abs(ticks - Math.round(ticks)) < 1e-9;
}

export const isQuarterPoint = isTickAligned;

export function deriveInvalidationDistance({ side, entry, invalidation }) {
  if (!finiteNumber(entry) || entry <= 0 || !isTickAligned(entry)) {
    return { ok: false, distance: 0, message: "Entry must be a positive 0.25-point price." };
  }
  if (!finiteNumber(invalidation) || invalidation <= 0 || !isTickAligned(invalidation)) {
    return { ok: false, distance: 0, message: "Invalidation must be a positive 0.25-point price." };
  }
  if (side === "long") {
    if (invalidation >= entry) return { ok: false, distance: 0, message: "For a long trade, invalidation must be below entry." };
    return { ok: true, distance: entry - invalidation, message: "" };
  }
  if (side === "short") {
    if (invalidation <= entry) return { ok: false, distance: 0, message: "For a short trade, invalidation must be above entry." };
    return { ok: true, distance: invalidation - entry, message: "" };
  }
  return { ok: false, distance: 0, message: "Choose long or short." };
}

export function nearestHorizons(minutes, availableHorizons = SUPPORTED_HORIZONS) {
  if (!finiteNumber(minutes) || minutes <= 0) return [];
  const horizons = [...availableHorizons].filter(value => finiteNumber(value) && value > 0).sort((a, b) => a - b);
  if (!horizons.length) return [];
  const distances = horizons.map(value => ({ value, distance: Math.abs(value - minutes) }));
  const nearest = Math.min(...distances.map(item => item.distance));
  return distances.filter(item => Math.abs(item.distance - nearest) < 1e-9).map(item => item.value);
}

/**
 * @param {number} minutes
 * @param {readonly number[]} [availableHorizons]
 * @param {number | null} [confirmedHorizon]
 */
export function resolveHoldingHorizon(minutes, availableHorizons = SUPPORTED_HORIZONS, confirmedHorizon = null) {
  const horizons = [...availableHorizons].filter(value => finiteNumber(value) && value > 0).sort((a, b) => a - b);
  if (!finiteNumber(minutes) || minutes <= 0 || !horizons.length) {
    return { status: "invalid", resolvedHorizon: null, candidates: [], message: "Enter a positive holding time." };
  }

  const candidates = nearestHorizons(minutes, horizons);
  const min = horizons[0];
  const max = horizons[horizons.length - 1];
  const outsideRange = minutes < min || minutes > max;

  if (candidates.length > 1 && !candidates.includes(confirmedHorizon)) {
    return {
      status: "tie",
      resolvedHorizon: null,
      candidates,
      message: `Choose ${candidates.map(value => `${value} minutes`).join(" or ")} to confirm the comparison horizon.`,
    };
  }

  const resolvedHorizon = candidates.includes(confirmedHorizon) ? confirmedHorizon : candidates[0];
  return {
    status: outsideRange ? "outside-range" : resolvedHorizon === minutes ? "exact" : "nearest",
    resolvedHorizon,
    candidates,
    message: outsideRange
      ? `Holding time is outside the controlled ${min}-${max} minute range; using the nearest available horizon only after explicit review.`
      : resolvedHorizon === minutes
        ? `${resolvedHorizon} minutes is available in the controlled data.`
        : `Nearest available horizon: ${resolvedHorizon} minutes.`,
  };
}

export function validateTradePlan(input) {
  const errors = [];
  const side = input.side;
  const entryPrice = Number(input.entryPrice);
  const invalidationPrice = Number(input.invalidationPrice);
  const quantity = Number(input.quantity);
  const riskLimit = Number(input.riskLimit);
  const costPerSide = Number(input.costPerSide);
  const slippageValue = Number(input.slippagePoints ?? input.slippageTicks ?? 0);
  const existingRisk = Number(input.existingRisk ?? 0);

  if (side !== "long" && side !== "short") errors.push("Choose long or short.");
  if (!finiteNumber(entryPrice) || entryPrice <= 0) errors.push("Enter a positive entry price.");
  if (!finiteNumber(invalidationPrice) || invalidationPrice <= 0) errors.push("Enter a positive invalidation price.");
  if (finiteNumber(entryPrice) && !isTickAligned(entryPrice)) errors.push("Entry price must use 0.25-point increments.");
  if (finiteNumber(invalidationPrice) && !isTickAligned(invalidationPrice)) errors.push("Invalidation price must use 0.25-point increments.");
  if (side === "long" && finiteNumber(entryPrice) && finiteNumber(invalidationPrice) && invalidationPrice >= entryPrice) {
    errors.push("For a long trade, invalidation must be below entry.");
  }
  if (side === "short" && finiteNumber(entryPrice) && finiteNumber(invalidationPrice) && invalidationPrice <= entryPrice) {
    errors.push("For a short trade, invalidation must be above entry.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) errors.push("Enter an intended whole number of contracts.");
  if (!finiteNumber(riskLimit) || riskLimit <= 0) errors.push("Enter a positive trade-idea risk limit.");
  if (!finiteNumber(costPerSide) || costPerSide < 0) errors.push("Cost per side cannot be negative.");
  if (!finiteNumber(slippageValue) || slippageValue < 0) errors.push("Slippage assumption cannot be negative.");
  if (finiteNumber(slippageValue) && slippageValue > 0 && input.slippagePoints !== undefined && !isTickAligned(slippageValue)) errors.push("Slippage assumption must use 0.25-point increments.");
  if (finiteNumber(slippageValue) && input.slippagePoints === undefined && (!Number.isInteger(slippageValue) || slippageValue < 0)) errors.push("Slippage assumption must be zero or more whole ticks.");
  if (!finiteNumber(existingRisk) || existingRisk < 0) errors.push("Existing same-idea risk cannot be negative.");

  const stopPoints = !finiteNumber(entryPrice) || !finiteNumber(invalidationPrice) ? 0 : Math.abs(entryPrice - invalidationPrice);
  if (stopPoints > 0 && !isTickAligned(stopPoints)) errors.push("Invalidation distance must use 0.25-point increments.");

  return { valid: errors.length === 0, errors, stopPoints };
}

export function calculatePlannedRisk(input) {
  const stopPoints = Number(input.stopPoints);
  const dollarsPerPoint = Number(input.dollarsPerPoint);
  const costPerSide = Number(input.costPerSide);
  const quantity = Number(input.quantity);
  const slippagePoints = input.slippagePoints !== undefined ? Number(input.slippagePoints) : Number(input.slippageTicks ?? 0) * TICK_SIZE;
  const existingRisk = Number(input.existingRisk ?? 0);
  const riskLimit = Number(input.riskLimit);

  if (![stopPoints, dollarsPerPoint, costPerSide, quantity, slippagePoints, existingRisk, riskLimit].every(finiteNumber)) return null;
  if (stopPoints <= 0 || dollarsPerPoint <= 0 || costPerSide < 0 || quantity <= 0 || slippagePoints < 0 || existingRisk < 0 || riskLimit <= 0) return null;

  const roundTripCost = costPerSide * 2;
  const riskPerContract = (stopPoints + slippagePoints) * dollarsPerPoint + roundTripCost;
  const plannedRisk = riskPerContract * quantity;
  const combinedRisk = plannedRisk + existingRisk;
  const differenceFromLimit = riskLimit - combinedRisk;

  return {
    roundTripCost,
    riskPerContract,
    plannedRisk,
    combinedRisk,
    differenceFromLimit,
    withinLimit: differenceFromLimit >= 0,
  };
}

export function calculateContractRisk({ stopPoints, dollarsPerPoint, costPerSide, riskBudget }) {
  const risk = calculatePlannedRisk({
    stopPoints,
    dollarsPerPoint,
    costPerSide,
    riskLimit: riskBudget,
    quantity: 1,
    slippagePoints: 0,
    existingRisk: 0,
  });
  if (!risk) return { roundTripCost: 0, riskPerContract: 0, wholeContracts: 0, usedRisk: 0, unallocatedRisk: Math.max(0, finiteNumber(riskBudget) ? riskBudget : 0) };
  const wholeContracts = Math.max(0, Math.floor(riskBudget / risk.riskPerContract));
  const usedRisk = wholeContracts * risk.riskPerContract;
  return { roundTripCost: risk.roundTripCost, riskPerContract: risk.riskPerContract, wholeContracts, usedRisk, unallocatedRisk: riskBudget - usedRisk };
}

function hasApprovedFallbackValidation(source) {
  const status = String(source.status ?? "").toLowerCase();
  const validationStatus = String(source.validationStatus ?? "").toLowerCase();
  const comparabilityStatus = String(source.comparabilityStatus ?? "").toLowerCase();
  if (/\b(failed|insufficient|invalid|not validated|unvalidated|rejected)\b/.test(status)) return false;
  return source.validated === true
    || source.comparabilityApproved === true
    || validationStatus === "validated"
    || comparabilityStatus === "approved"
    || /\b(validated|comparability[- ]approved|approved comparable|approved fallback)\b/.test(status);
}

function hasNamedUs100Provider(source) {
  const provider = String(source.provider ?? "").trim();
  const sourceId = String(source.sourceId ?? "").trim();
  return provider.length > 0 && sourceId.length > 0 && !/^us100$/i.test(sourceId) && !/generic/i.test(sourceId);
}

export function selectDataSource(sources) {
  const orderedSources = [...sources]
    .filter(source => source.available && !String(source.status ?? "").toLowerCase().includes("not available"))
    .sort((a, b) => a.rank - b.rank);

  for (const source of orderedSources) {
    const instrument = String(source.instrument ?? "").toUpperCase();
    if (instrument === "NQ") return source;
    if (instrument === "MNQ" && hasApprovedFallbackValidation(source)) return source;
    if (instrument === "US100" && hasApprovedFallbackValidation(source) && hasNamedUs100Provider(source)) return source;
  }

  return null;
}
