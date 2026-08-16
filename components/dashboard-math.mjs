export const SUPPORTED_HORIZONS = Object.freeze([1, 3, 5, 10, 15, 30]);

/**
 * Return every supported horizon tied for the shortest distance from the
 * trader's typical holding time.
 * @param {number} minutes
 * @returns {number[]}
 */
export function nearestHorizons(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return [];
  const distances = SUPPORTED_HORIZONS.map(value => ({ value, distance: Math.abs(value - minutes) }));
  const nearest = Math.min(...distances.map(item => item.distance));
  return distances.filter(item => item.distance === nearest).map(item => item.value);
}

/**
 * Mechanical whole-contract arithmetic. This deliberately does not recommend
 * a position size; it only translates user-provided inputs.
 * @param {{stopPoints:number, dollarsPerPoint:number, costPerSide:number, riskBudget:number}} input
 */
export function calculateContractRisk({ stopPoints, dollarsPerPoint, costPerSide, riskBudget }) {
  const values = [stopPoints, dollarsPerPoint, costPerSide, riskBudget];
  if (!values.every(Number.isFinite) || stopPoints <= 0 || dollarsPerPoint <= 0 || costPerSide < 0 || riskBudget < 0) {
    return { roundTripCost: 0, riskPerContract: 0, wholeContracts: 0, usedRisk: 0, unallocatedRisk: Math.max(0, Number.isFinite(riskBudget) ? riskBudget : 0) };
  }
  const roundTripCost = costPerSide * 2;
  const riskPerContract = stopPoints * dollarsPerPoint + roundTripCost;
  const wholeContracts = Math.max(0, Math.floor(riskBudget / riskPerContract));
  const usedRisk = wholeContracts * riskPerContract;
  return { roundTripCost, riskPerContract, wholeContracts, usedRisk, unallocatedRisk: riskBudget - usedRisk };
}

/**
 * Select the first available source by explicit rank. Results from different
 * instruments are never blended.
 * @param {Array<{instrument:string, rank:number, available:boolean}>} sources
 */
export function selectDataSource(sources) {
  return [...sources].filter(source => source.available).sort((a, b) => a.rank - b.rank)[0] ?? null;
}
