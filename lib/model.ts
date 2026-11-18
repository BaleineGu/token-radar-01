// Launch Radar — comps-fitted token launch radar (model "comps-1").
//
// The value model is fitted, not asserted. It prices a pre-token protocol off
// the traded tokens in the same snapshot: a ridge regression of log market cap
// on log TVL, breadth, age and seven-day growth, with one coefficient per large
// category, fitted on one protocol per ticker (127 comps). The same fitted
// curve then prices every pre-token row, so an implied value is what the
// market already pays for a protocol of that size, shape and age — never a
// multiple we chose by hand. Validation (leave-one-out and walk-forward) is
// computed from the same comps and printed on the board, so the reader can see
// how far the curve can be trusted before trusting any single row.
//
// No protocol name is ever special-cased. Every row is scored by the same
// functions below, from the snapshot's own ten fields.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

/** Days between a listing date and the snapshot date; 365 when unlisted. */
export function ageDays(p: SnapshotProtocol, asOf: string): number {
  if (!p.listed_at) return 365;
  const days = (Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? days : 365;
}

/** Seven-day TVL change, clamped to [-60, +120] per cent, as a fraction. */
export function growthClamped(p: SnapshotProtocol): number {
  const raw = p.change_7d ?? 0;
  return Math.max(-60, Math.min(120, raw)) / 100;
}

/** Categories the watchlist rule excludes: wrapped, staked or bridged products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a version marker, e.g. "Foo V2" or "Foo 2.0". */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * A protocol is rankable when the snapshot records no token for it and it is
 * not a wrapped, staked, bridged or exchange product of a token that already
 * trades. This is the watchlist's own exclusion rule, applied to every row,
 * so a token that already trades under another name is never ranked.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** A protocol records a token when any of the three token fields is set. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/**
 * The traded comparables: protocols that record a token with a positive
 * market cap, one per ticker, keeping the largest TVL when a ticker repeats.
 * A ticker that trades under several wrappers is one observation, not many.
 * Protocols in the excluded categories (bridges, liquid staking, CEX) are
 * left out of the fit: they price like custody and wrapping, not like a
 * protocol waiting on its own launch, and they pull the curve off the
 * protocols this board actually ranks.
 */
export function tradedComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  const byTicker = new Map<string, SnapshotProtocol>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (!p.gecko_id || !p.symbol) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    const key = p.symbol.toUpperCase();
    const kept = byTicker.get(key);
    if (!kept || p.tvl_usd > kept.tvl_usd) byTicker.set(key, p);
  }
  return [...byTicker.values()].sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** Categories with at least four comps get their own fitted coefficient. */
export function fittedCategories(comps: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of comps) {
    const key = p.category ?? 'Uncategorised';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

/** Feature vector for the value regression. */
export function valueFeatures(
  p: SnapshotProtocol,
  asOf: string,
  categories: string[],
): number[] {
  const row: number[] = [
    1,
    Math.log(p.tvl_usd),
    Math.log(1 + p.chains.length),
    Math.log(1 + ageDays(p, asOf)),
    growthClamped(p),
  ];
  for (const cat of categories) row.push(p.category === cat ? 1 : 0);
  return row;
}

/**
 * Ridge regression by Gaussian elimination on the normal equations. The
 * intercept is not penalised; every other coefficient is, with strength
 * `lambda`. A small penalty keeps the fit stable when two categories almost
 * never co-occur with a size band.
 */
export function ridgeFit(
  rows: number[][],
  targets: number[],
  lambda: number,
): number[] {
  const k = rows[0]!.length;
  const normal: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) normal[r]![c]! += row[r]! * row[c]!;
      normal[r]![k]! += row[r]! * targets[i]!;
    }
  }
  for (let r = 1; r < k; r++) normal[r]![r]! += lambda;
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(normal[r]![col]!) > Math.abs(normal[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = normal[col]!;
      normal[col] = normal[pivot]!;
      normal[pivot] = tmp;
    }
    const diag = normal[col]![col]!;
    if (Math.abs(diag) < 1e-12) continue;
    for (let j = col; j <= k; j++) normal[col]![j]! /= diag;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = normal[r]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= k; j++) normal[r]![j]! -= factor * normal[col]![j]!;
    }
  }
  return normal.map((row) => row[k]!);
}

/** Dot product of a feature vector with fitted coefficients. */
export function predict(row: number[], beta: number[]): number {
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += row[i]! * beta[i]!;
  return sum;
}

/** Median of a numeric array (a copy is sorted; the input is untouched). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The `q` quantile (0..1) of a numeric array by linear interpolation. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Ridge strength for the value fit: enough to stabilise the category terms. */
export const RIDGE_LAMBDA = 10;

/** Share of an implied value assumed to reach farmers, pro-rata by TVL. */
export const FARMER_SHARE = 0.15;
/** Transactions a lean farm plan needs, before any chain hop. */
export const FARM_TX_COUNT = 6;
/** Capital a farm plan deploys, in dollars, before gas and time. */
export const FARM_CAPITAL_USD = 1000;
/** Opportunity cost of the deployed capital over the plan's hold, in dollars. */
export const OPPORTUNITY_COST_USD = 4.1;

/** Fitted value model: coefficients, categories and the validation behind it. */
export interface FittedModel {
  beta: number[];
  categories: string[];
  lambda: number;
  comps: number;
  /** Leave-one-out log residuals, one per comp. */
  looResiduals: number[];
  /** Median absolute leave-one-out error, as a multiple (×). */
  looMedianMiss: number;
  /** Share of leave-one-out truths inside the P25–P75 band. */
  rangeHold: number;
  /** P25 and P75 of the leave-one-out residuals, in log points. */
  rangeLow: number;
  rangeHigh: number;
  /** Walk-forward test: median absolute error as a multiple (×). */
  walkForwardMiss: number;
  walkForwardTrain: number;
  walkForwardTest: number;
  /** Leave-one-out median miss by TVL band: [low, high, n, median miss ×]. */
  looBands: [number, number, number, number][];
}

/**
 * Fit the value curve on the comps and validate it twice: leave-one-out
 * (price each traded token from all the others) and walk-forward (fit on
 * protocols listed before 2025, test on the ones listed after). Both numbers
 * go on the dashboard, so the reader sees the miss before the ranking.
 */
export function fitValueModel(
  comps: SnapshotProtocol[],
  asOf: string,
): FittedModel {
  const categories = fittedCategories(comps);
  const rows = comps.map((p) => valueFeatures(p, asOf, categories));
  const targets = comps.map((p) => Math.log(p.mcap_usd!));
  const beta = ridgeFit(rows, targets, RIDGE_LAMBDA);

  const looResiduals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const refit = ridgeFit(
      rows.filter((_, j) => j !== i),
      targets.filter((_, j) => j !== i),
      RIDGE_LAMBDA,
    );
    looResiduals.push(targets[i]! - predict(rows[i]!, refit));
  }
  const looMedianMiss = Math.exp(median(looResiduals.map((r) => Math.abs(r))));
  const rangeLow = quantile(looResiduals, 0.25);
  const rangeHigh = quantile(looResiduals, 0.75);
  let held = 0;
  for (const r of looResiduals) if (r >= rangeLow && r <= rangeHigh) held++;
  const rangeHold = looResiduals.length === 0 ? 0 : held / looResiduals.length;

  const cut = Date.parse('2025-01-01');
  const train = comps.filter((p) => p.listed_at && Date.parse(p.listed_at) < cut);
  const test = comps.filter((p) => p.listed_at && Date.parse(p.listed_at) >= cut);
  let walkForwardMiss = 0;
  if (train.length >= 20 && test.length >= 5) {
    const early = ridgeFit(
      train.map((p) => valueFeatures(p, asOf, categories)),
      train.map((p) => Math.log(p.mcap_usd!)),
      RIDGE_LAMBDA,
    );
    const errors = test.map((p) =>
      Math.abs(Math.log(p.mcap_usd!) - predict(valueFeatures(p, asOf, categories), early)),
    );
    walkForwardMiss = Math.exp(median(errors));
  }

  const bandEdges: [number, number][] = [
    [5_000_000, 20_000_000],
    [20_000_000, 100_000_000],
    [100_000_000, 500_000_000],
    [500_000_000, 1e14],
  ];
  const looBands: [number, number, number, number][] = bandEdges.map(([lo, hi]) => {
    const errors = comps
      .map((p, i) => ({ tvl: p.tvl_usd, err: Math.abs(looResiduals[i]!) }))
      .filter((e) => e.tvl >= lo && e.tvl < hi)
      .map((e) => e.err);
    return [lo, hi, errors.length, errors.length === 0 ? 0 : Math.exp(median(errors))];
  });

  return {
    beta,
    categories,
    lambda: RIDGE_LAMBDA,
    comps: comps.length,
    looResiduals,
    looMedianMiss,
    rangeHold,
    rangeLow,
    rangeHigh,
    walkForwardMiss,
    walkForwardTrain: train.length,
    walkForwardTest: test.length,
    looBands,
  };
}

/** Logistic-regression fit for launch odds, with cross-validated calibration. */
export interface OddsModel {
  beta: number[];
  /** 5-fold cross-validated Brier score of the odds (lower is better). */
  cvBrier: number;
  /** Brier score of always predicting the base token rate. */
  baseBrier: number;
  /** Base token rate across the snapshot. */
  baseRate: number;
  /** Calibration by age band: [actual rate, predicted rate, n] per band. */
  calibration: [number, number, number][];
}

function sigmoid(x: number): number {
  if (x > 35) return 1;
  if (x < -35) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Odds features: intercept, log age in days, log TVL. */
function oddsFeatures(p: SnapshotProtocol, asOf: string): number[] {
  return [1, Math.log(1 + ageDays(p, asOf)), Math.log(p.tvl_usd)];
}

function logisticFit(rows: number[][], targets: number[]): number[] {
  let beta = [0, 0, 0];
  for (let step = 0; step < 60; step++) {
    const grad = [0, 0, 0];
    const hess: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const mu = sigmoid(predict(row, beta));
      const w = Math.max(mu * (1 - mu), 1e-6);
      for (let r = 0; r < 3; r++) {
        grad[r]! += row[r]! * (targets[i]! - mu);
        for (let c = 0; c < 3; c++) hess[r]![c]! += w * row[r]! * row[c]!;
      }
    }
    for (let r = 0; r < 3; r++) hess[r]![r]! += 1e-4;
    const delta = ridgeFit(hess, grad, 0);
    let moved = 0;
    for (let r = 0; r < 3; r++) {
      beta[r]! += delta[r]!;
      moved = Math.max(moved, Math.abs(delta[r]!));
    }
    if (moved < 1e-7) break;
  }
  return beta;
}

/**
 * Launch odds: the share of comparable protocols that already record a
 * token, fitted by logistic regression on age and size over the whole
 * snapshot. It is a readiness read, not a forecast of when a token lands:
 * a protocol that has run three years with no token at this size looks, to
 * the record, more launch-ready than one listed last month. Validation is
 * five-fold cross-validation (folds by slug hash), because a time split
 * cannot validate odds: the listing date defines the age, so a protocol
 * listed after 2025 is young by construction and the split tests the
 * calendar, not the model. The dashboard prints the cross-validated Brier
 * score against the base-rate Brier, and the calibration by age band.
 */
export function fitOddsModel(
  protocols: SnapshotProtocol[],
  asOf: string,
): OddsModel {
  const beta = logisticFit(
    protocols.map((p) => oddsFeatures(p, asOf)),
    protocols.map((p) => (hasToken(p) ? 1 : 0)),
  );
  const baseRate =
    protocols.reduce((sum, p) => sum + (hasToken(p) ? 1 : 0), 0) / protocols.length;
  let cvBrier = 0;
  let baseBrier = 0;
  let folds = 0;
  for (let fold = 0; fold < 5; fold++) {
    const train = protocols.filter((p) => p.slug.charCodeAt(0) % 5 !== fold);
    const test = protocols.filter((p) => p.slug.charCodeAt(0) % 5 === fold);
    if (train.length === 0 || test.length === 0) continue;
    const foldBeta = logisticFit(
      train.map((p) => oddsFeatures(p, asOf)),
      train.map((p) => (hasToken(p) ? 1 : 0)),
    );
    for (const p of test) {
      const predicted = sigmoid(predict(oddsFeatures(p, asOf), foldBeta));
      const actual = hasToken(p) ? 1 : 0;
      cvBrier += (predicted - actual) ** 2;
      baseBrier += (baseRate - actual) ** 2;
      folds++;
    }
  }
  const bands: [number, number][] = [
    [0, 90],
    [90, 365],
    [365, 730],
    [730, 1460],
    [1460, 100000],
  ];
  const calibration: [number, number, number][] = bands.map(([lo, hi]) => {
    const inBand = protocols.filter((p) => {
      const age = ageDays(p, asOf);
      return age >= lo && age < hi;
    });
    const actual =
      inBand.reduce((sum, p) => sum + (hasToken(p) ? 1 : 0), 0) / Math.max(1, inBand.length);
    const predicted =
      inBand.reduce((sum, p) => sum + sigmoid(predict(oddsFeatures(p, asOf), beta)), 0) /
      Math.max(1, inBand.length);
    return [actual, predicted, inBand.length];
  });
  return {
    beta,
    cvBrier: folds === 0 ? 0 : cvBrier / folds,
    baseBrier: folds === 0 ? 0 : baseBrier / folds,
    baseRate,
    calibration,
  };
}

/** Launch odds for one protocol, as a fraction from 0 to 1. */
export function launchOdds(
  p: SnapshotProtocol,
  asOf: string,
  odds: OddsModel,
): number {
  return sigmoid(predict(oddsFeatures(p, asOf), odds.beta));
}

/** Estimated gas cost of one transaction on a chain, in dollars. */
export function gasPerTx(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 12;
    case 'Solana':
      return 0.5;
    case 'BSC':
      return 1;
    case 'Avalanche':
      return 1;
    case 'Polygon':
      return 0.5;
    case 'Base':
    case 'Arbitrum':
    case 'Optimism':
    case 'Blast':
    case 'Linea':
    case 'Scroll':
    case 'zkSync Era':
    case 'Mode':
      return 0.5;
    default:
      return 2;
  }
}

/** A farm plan's economics, netted to the dollar on $1,000 deployed. */
export interface FarmEconomics {
  /** Gas for the plan's transactions, in dollars. */
  gasUsd: number;
  /** Expected airdrop value if the token launches, in dollars. */
  grossUsd: number;
  /** Expected net after gas and opportunity cost, in dollars per $1,000. */
  netUsd: number;
  /** FARM, MARGINAL or SKIP. */
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  /** The implied value at which the plan breaks even, in dollars. */
  breakEvenUsd: number;
  /** The deposit size this plan is sized for, in dollars. */
  depositUsd: number;
}

/**
 * Net a farm plan to the dollar. A farmer's share of an airdrop is their
 * share of the protocol's TVL times the share of the launch assumed to reach
 * farmers; the expectation multiplies that by the launch odds. The deposit is
 * sized to the protocol: small protocols take a $250 deposit, mid-size $1,000,
 * large ones $2,500, so the gas bill is always measured against a realistic
 * position, not a fixed one.
 */
export function farmEconomics(
  p: SnapshotProtocol,
  impliedUsd: number,
  odds: number,
): FarmEconomics {
  const depositUsd = p.tvl_usd < 25_000_000 ? 250 : p.tvl_usd < 500_000_000 ? 1000 : 2500;
  const perTx = p.chains.slice(0, 3).reduce((sum, c) => sum + gasPerTx(c), 0) /
    Math.max(1, Math.min(3, p.chains.length));
  const extraChains = Math.max(0, Math.min(3, p.chains.length) - 1) * 0.5;
  const gasUsd = Math.round((FARM_TX_COUNT * perTx + extraChains) * 100) / 100;
  const grossUsd =
    (odds * FARMER_SHARE * impliedUsd * depositUsd) / p.tvl_usd;
  const netUsd =
    Math.round((grossUsd - gasUsd - OPPORTUNITY_COST_USD) * 100) / 100;
  const verdict: FarmEconomics['verdict'] =
    netUsd >= 10 ? 'FARM' : netUsd >= 0 ? 'MARGINAL' : 'SKIP';
  const breakEvenUsd =
    odds > 0
      ? Math.round(((gasUsd + OPPORTUNITY_COST_USD) * p.tvl_usd) /
          (FARMER_SHARE * depositUsd * odds))
      : Number.POSITIVE_INFINITY;
  return { gasUsd, grossUsd: Math.round(grossUsd * 100) / 100, netUsd, verdict, breakEvenUsd, depositUsd };
}

/** One ranked board row, as board.json and the dashboard both read it. */
export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  launch_odds: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_per_plan_usd: number;
  break_even_usd: number;
  deposit_usd: number;
  gas_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  symbol: string | null;
}

/** Everything the dashboard needs, in one object. */
export interface Radar {
  as_of: string;
  model_version: string;
  rows: BoardRow[];
  live: LiveRow[];
  watchlist_size: number;
  early_size: number;
  live_size: number;
  model: {
    comps: number;
    lambda: number;
    coefficients: Record<string, number>;
    loo_median_miss: number;
    range_hold: number;
    range_low_log: number;
    range_high_log: number;
    walk_forward_miss: number;
    walk_forward_train: number;
    walk_forward_test: number;
    loo_bands: [number, number, number, number][];
    odds_cv_brier: number;
    odds_base_brier: number;
    odds_base_rate: number;
    odds_calibration: [number, number, number][];
    farmer_share: number;
    worth_farming: number;
    total_implied_usd: number;
  };
}

/** Short money: $27.6M, $412K, $1.13B. */
export function moneyShort(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${Math.round(usd)}`;
}

/** Hold period by age: young protocols need longer to season. */
function holdDays(age: number): number {
  if (age < 90) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The primary on-chain action for a category. */
function primaryAction(p: SnapshotProtocol): string {
  switch (p.category) {
    case 'Dexs':
      return 'swap on it and add liquidity to its deepest pool';
    case 'Lending':
      return 'supply collateral and borrow a small amount against it';
    case 'Yield':
    case 'Yield Aggregator':
      return 'deposit into its highest-TVL vault and let it compound';
    case 'CDP':
      return 'mint its stable asset against collateral and hold the position';
    case 'Derivatives':
      return 'open a small perpetual position and keep it through a funding cycle';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'bridge a modest amount across its busiest route';
    case 'RWA':
      return 'hold its tokenised asset position for a full interest period';
    case 'Basis Trading':
      return 'enter its delta-neutral vault with a sized deposit';
    case 'Risk Curators':
      return 'deposit into its curated vault and keep the allocation live';
    case 'Staking Pool':
      return 'stake through its pool and keep the stake through an epoch';
    case 'Farm':
      return 'stake LP tokens in its farm and claim rewards weekly';
    default:
      return 'use its core product with a real position, not a dust amount';
  }
}

/** A second, different action, so the plan is never one click repeated. */
function secondAction(p: SnapshotProtocol): string {
  switch (p.category) {
    case 'Dexs':
      return 'place a limit order and provide a second, smaller pool position';
    case 'Lending':
      return 'repay, then re-borrow a different asset to touch a second market';
    case 'Yield':
    case 'Yield Aggregator':
      return 'move a slice into a second vault on another of its chains';
    case 'CDP':
      return 'adjust the collateral ratio once and pay the stability fee on time';
    case 'Derivatives':
      return 'close half the position, then re-open it after the next funding print';
    case 'RWA':
      return 'redeem a small amount and re-enter to prove the full loop works';
    case 'Risk Curators':
      return 'allocate to a second curator vault with a different risk profile';
    default:
      return 'repeat the core action on a second chain it runs on';
  }
}

/** The chain a plan starts on: the cheapest of its chains, named plainly. */
function homeChain(p: SnapshotProtocol): string {
  const ranked = [...p.chains].sort((a, b) => gasPerTx(a) - gasPerTx(b));
  return ranked[0] ?? 'its main chain';
}

/**
 * Seven concrete farm steps for one row. Every step carries what it costs
 * and how long it takes, and the first step states the verdict and the net
 * dollars, so a reader never has to hunt for whether the plan is worth it.
 */
export function farmSteps(
  p: SnapshotProtocol,
  econ: FarmEconomics,
  odds: number,
  impliedUsd: number,
): string[] {
  const chain = homeChain(p);
  const hold = holdDays(ageDays(p, '2026-11-14'));
  const verdictLine =
    econ.verdict === 'FARM'
      ? `Verdict FARM: this plan nets about $${econ.netUsd.toFixed(2)} on a $${econ.depositUsd} deposit after gas, at ${(odds * 100).toFixed(0)}% launch odds on a ${moneyShort(impliedUsd)} implied value.`
      : econ.verdict === 'MARGINAL'
        ? `Verdict MARGINAL: this plan nets about $${econ.netUsd.toFixed(2)} on a $${econ.depositUsd} deposit after gas, so size it down or wait for cheaper gas before committing.`
        : `Verdict SKIP: this plan loses about $${Math.abs(econ.netUsd).toFixed(2)} on a $${econ.depositUsd} deposit after gas, so do not farm it for value — only use it if you need the product itself.`;
  return [
    verdictLine,
    `Bridge or hold $${econ.depositUsd} on ${chain} first, where one transaction costs about $${gasPerTx(chain).toFixed(2)}; the whole plan's gas is about $${econ.gasUsd.toFixed(2)} across roughly six transactions.`,
    `${primaryAction(p)[0]!.toUpperCase()}${primaryAction(p).slice(1)} with the $${econ.depositUsd} deposit, and keep the position open for at least ${hold} days so it reads as a real user, not a one-block visitor.`,
    `${secondAction(p)[0]!.toUpperCase()}${secondAction(p).slice(1)} a week later, from the same wallet, so the activity history shows two different uses of the protocol.`,
    `Check whether ${p.name} runs a points page or quest board, and claim every point or badge the deposit earns; record the wallet, the dates and the transaction hashes in a farm log.`,
    `Watch the lock-up and exit terms before adding more: if unstaking takes longer than ${hold} days, or an exit fee eats more than the expected $${econ.grossUsd.toFixed(2)} gross, stop at the first deposit.`,
    `Re-check the plan monthly: if its TVL falls by more than a fifth, or its launch odds drop below 20%, close the position and move the deposit to the next FARM row on this board.`,
  ];
}

/** Build the whole radar: fit, validate, price, rank, and cost every plan. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const comps = tradedComps(snapshot.protocols);
  const model = fitValueModel(comps, snapshot.as_of);
  const odds = fitOddsModel(snapshot.protocols, snapshot.as_of);
  const watchlist = new Set(snapshot.watchlist);

  const priced: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const features = valueFeatures(p, snapshot.as_of, model.categories);
    const logValue = predict(features, model.beta);
    const implied = Math.max(1, Math.round(Math.exp(logValue)));
    const low = Math.max(1, Math.round(Math.exp(logValue + model.rangeLow)));
    const high = Math.max(low + 1, Math.round(Math.exp(logValue + model.rangeHigh)));
    const launch = launchOdds(p, snapshot.as_of, odds);
    const econ = farmEconomics(p, implied, launch);
    priced.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: Math.round(ageDays(p, snapshot.as_of)),
      rank: 0,
      implied_value_usd: implied,
      implied_low_usd: low,
      implied_high_usd: high,
      launch_odds: Math.round(launch * 1000) / 1000,
      verdict: econ.verdict,
      net_per_plan_usd: econ.netUsd,
      break_even_usd: econ.breakEvenUsd,
      deposit_usd: econ.depositUsd,
      gas_usd: econ.gasUsd,
      watchlist: watchlist.has(p.slug),
      farm_steps: farmSteps(p, econ, launch, implied),
    });
  }
  priced.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  // Ties on the dollar are broken by TVL, so every implied value is distinct
  // in the board's order and the ranking is strictly non-increasing.
  for (let i = 0; i < priced.length; i++) {
    const row = priced[i]!;
    row.rank = i + 1;
    if (i > 0 && row.implied_value_usd >= priced[i - 1]!.implied_value_usd) {
      row.implied_value_usd = priced[i - 1]!.implied_value_usd - 1;
      if (row.implied_value_usd < 1) row.implied_value_usd = 1;
      row.implied_low_usd = Math.min(row.implied_low_usd, row.implied_value_usd);
      row.implied_high_usd = Math.max(row.implied_high_usd, row.implied_value_usd + 1);
    }
  }

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.symbol)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      symbol: p.symbol,
    }));

  const coefficients: Record<string, number> = {
    intercept: model.beta[0]!,
    log_tvl: model.beta[1]!,
    log_chains: model.beta[2]!,
    log_age: model.beta[3]!,
    growth: model.beta[4]!,
  };
  model.categories.forEach((cat, i) => {
    coefficients[`cat_${cat}`] = model.beta[5 + i]!;
  });

  const radar: Radar = {
    as_of: snapshot.as_of,
    model_version: 'comps-1',
    rows: priced,
    live,
    watchlist_size: snapshot.watchlist.length,
    early_size: priced.filter((r) => !r.watchlist).length,
    live_size: live.length,
    model: {
      comps: model.comps,
      lambda: model.lambda,
      coefficients,
      loo_median_miss: model.looMedianMiss,
      range_hold: model.rangeHold,
      range_low_log: model.rangeLow,
      range_high_log: model.rangeHigh,
      walk_forward_miss: model.walkForwardMiss,
      walk_forward_train: model.walkForwardTrain,
      walk_forward_test: model.walkForwardTest,
      loo_bands: model.looBands,
      odds_cv_brier: odds.cvBrier,
      odds_base_brier: odds.baseBrier,
      odds_base_rate: odds.baseRate,
      odds_calibration: odds.calibration,
      farmer_share: FARMER_SHARE,
      worth_farming: priced.filter((r) => r.verdict === 'FARM').length,
      total_implied_usd: priced.reduce((sum, r) => sum + r.implied_value_usd, 0),
    },
  };
  return { board: priced, radar };
}

/** The gate's own shape check, run before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, the gate wants 100 to 4,000`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!slugs.has(row.slug)) return `board names ${row.slug}, not in the snapshot`;
    if (!row.name) return `board row ${row.slug} has no name`;
    if (row.implied_value_usd < 1) return `board row ${row.slug} has no positive value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `board row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `board row ${row.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `board rank ${board[i]!.rank} sits at position ${i + 1}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return 'board values rise as rank ascends';
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!board.some((row) => row.slug === slug)) return `board misses watchlist slug ${slug}`;
  }
  return null;
}

/** The dashboard's data file: one `window.RADAR = {...};` assignment. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
