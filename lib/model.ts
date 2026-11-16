// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor that pass the watchlist's own product test: no
// bridge, liquid-staking, restaking or CEX product, no versioned pool, no wrapped or staked
// name, no exchange-prefixed name. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol); live-token protocols are kept apart and shown
// with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   M_cat  = median mcap/TVL of live-token peers in the same category (n >= 3),
//            else a sibling category's median, else the global median
//   sizeF  = clamp((tvl_usd / 1e8) ^ -0.478, 0.2, 4.0)
//   G      = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   A      = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied = max(1, round(tvl_usd x M_cat x sizeF x G x A))
//
// The constants are this entry's, stated in the dashboard and changeable nowhere else. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  size_ref: number;
  size_exp: number;
  size_min: number;
  size_max: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_min_n: number;
}

export const MODEL: ModelConstants = {
  size_ref: 1e8,
  size_exp: -0.478,
  size_min: 0.2,
  size_max: 4.0,
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.5,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_min_n: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_multiplier: number;
    age_days: number | null;
    peer_source: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_multiplier: number;
  peer_source: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One peer-multiple entry: a category's live-token median, with its sample size. */
export interface PeerEntry {
  category: string;
  n: number;
  median: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  multiples: PeerEntry[];
  global_multiple: { n: number; median: number };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to 4 decimal places, for the values the dashboard shows. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product: the name carries one of those words whole. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's own product: the name begins with one of these names. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(\s|$)/;
/** Categories the watchlist's product test keeps out of the board. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and it passes the watchlist's own product test. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** A sibling category: the closest product family, used only when the category itself has too few live peers. */
const SIBLING: Record<string, string> = {
  'Risk Curators': 'Onchain Capital Allocator',
  'Onchain Capital Allocator': 'Risk Curators',
  'Restaking': 'Liquid Restaking',
  'Collateral Markets': 'Lending',
  'CeDeFi': 'CEX',
  'Stablecoin Wrapper': 'CDP',
  'Governance Incentives': 'Yield',
  'Chain': 'Dexs',
  'Payments': 'Dexs',
};

/** The peer table, computed from the snapshot at runtime: per-category medians plus the global one. */
export interface PeerTable {
  byCategory: Map<string, { n: number; median: number }>;
  global: { n: number; median: number };
}

export function peerTable(snapshot: Snapshot): PeerTable {
  const byCategory = new Map<string, number[]>();
  const globalValues: number[] = [];
  for (const p of snapshot.protocols) {
    // mcap_usd > 0, not just non-null: the snapshot carries -1 as a "no market cap" sentinel.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    globalValues.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category);
      if (list === undefined) byCategory.set(p.category, [ratio]);
      else list.push(ratio);
    }
  }
  const table = new Map<string, { n: number; median: number }>();
  for (const [category, values] of byCategory) table.set(category, { n: values.length, median: median(values) });
  return { byCategory: table, global: { n: globalValues.length, median: median(globalValues) } };
}

/** A category's peer multiple: its own median (n >= 3), a sibling's, else the global median. */
export function peerMultipleFor(category: string | null, table: PeerTable, model: ModelConstants = MODEL): { multiple: number; source: string } {
  if (category !== null) {
    const own = table.byCategory.get(category);
    if (own !== undefined && own.n >= model.peer_min_n) return { multiple: own.median, source: `${category} n=${own.n}` };
    const sibling = SIBLING[category];
    if (sibling !== undefined) {
      const sib = table.byCategory.get(sibling);
      if (sib !== undefined && sib.n >= model.peer_min_n) return { multiple: sib.median, source: `sibling ${sibling} n=${sib.n}` };
    }
  }
  return { multiple: table.global.median, source: `global n=${table.global.n}` };
}

/** The four factors behind one protocol's implied value, each computed from the snapshot alone. */
export interface ImpliedValue {
  implied: number;
  multiple: number;
  peerSource: string;
  sizeFactor: number;
  growthMultiplier: number;
  growthPct: number;
  maturityMultiplier: number;
  ageDays: number | null;
}

/** Score one protocol. The peers come from the snapshot, never from a stored constant. */
export function impliedValue(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  table: PeerTable,
  model: ModelConstants = MODEL,
): ImpliedValue {
  const { multiple, source } = peerMultipleFor(p.category, table, model);
  const sizeFactor = clamp(Math.pow(p.tvl_usd / model.size_ref, model.size_exp), model.size_min, model.size_max);
  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, model.growth_floor, model.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(snapshot.as_of, p.listed_at);
  const ageForFactor = age === null ? model.unknown_age_days : age;
  const maturityMultiplier = model.maturity_floor + (Math.min(ageForFactor, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * sizeFactor * growthMultiplier * maturityMultiplier));
  return { implied, multiple, peerSource: source, sizeFactor, growthMultiplier, growthPct, maturityMultiplier, ageDays: age };
}

/** The first chain, else the one the protocol calls home; the farm plan only ever acts on one chain. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** The capital a farm plan starts with: $250 for the largest, $150, $100, then $50 for the smallest. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** The hold days a farm plan asks for: 60 days for the youngest, 45, then 30 for the oldest. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A gas tier: the chain sets what one transaction costs, and every step reuses that one number. */
function gasTx(chain: string): string {
  if (chain === 'Ethereum') return '$3 to $12';
  if (chain === 'Bitcoin') return '$2 to $8';
  if (GAS_MID_CHAINS.has(chain)) return '$0.50';
  return '$0.20';
}

/** What the first transaction costs on a chain: cheap chains are under $1, mid chains $0.20 to $1.00. */
function firstTxCost(chain: string): string {
  if (chain === 'Ethereum') return 'about $3 to $12 of gas for the first transaction on Ethereum';
  if (chain === 'Bitcoin') return 'about $2 to $8 of gas for the first transaction on Bitcoin';
  if (GAS_MID_CHAINS.has(chain)) return `about $0.20 to $1.00 of gas for the first transaction on ${chain}`;
  return `under $1 of gas for the first transaction on ${chain}`;
}

const GAS_MID_CHAINS = new Set([
  'Binance', 'Avalanche', 'Tron', 'Sui', 'Aptos', 'Algorand', 'Stellar', 'Ripple',
  'Flare', 'Bittensor', 'Hyperliquid L1', 'CORE', 'Qubic', 'Mezo',
]);

/** One farm family: how a category's farm opens, what it does second, and how much the second step holds. */
interface FarmFamily {
  primary: string;
  secondary: string;
  secondaryCapital: number;
  weekly?: string;
  plural?: boolean;
}

/** The fourteen families, by what the farm actually does on the protocol. */
const FAMILIES: Record<string, FarmFamily> = {
  lending: {
    primary: 'Supply ${capital} of USDC to {name} on {chain} and keep the position open.',
    secondary: 'Borrow about $10 against the supply and repay it a week later, so both sides of the market are used.',
    secondaryCapital: 10,
  },
  dex: {
    primary: "Provide ${capital} of liquidity to {name}'s main pool on {chain} and keep the position open.",
    secondary: 'Swap $10 through {name} on {chain} once a week.',
    secondaryCapital: 10,
  },
  yield: {
    primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
    secondary: 'Deposit a further $25 into a second {name} vault or strategy on {chain}.',
    secondaryCapital: 25,
  },
  curators: {
    primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
    secondary: 'Deposit a further $50 into a second {name} vault on {chain} so more than one position is counted.',
    secondaryCapital: 50,
    weekly: 'adding $10 to a vault or voting on a proposal',
    plural: true,
  },
  rwa: {
    primary: "Mint ${capital} of the protocol's yield asset on {chain} and hold it.",
    secondary: 'Buy a further $25 of the yield asset on {chain} in a second purchase.',
    secondaryCapital: 25,
  },
  basis: {
    primary: 'Deposit ${capital} into {article} {name} basis vault on {chain} and keep the position.',
    secondary: 'Deposit a further $25 into a second {name} vault on {chain} so more than one position is counted.',
    secondaryCapital: 25,
    weekly: 'adding $10 to the vault or rebalancing the hedge',
  },
  derivatives: {
    primary: 'Deposit ${capital} of USDC as margin on {name} and open one small position.',
    secondary: 'Close and reopen a $10 position once a week.',
    secondaryCapital: 10,
  },
  restaking: {
    primary: "Restake ${capital} of the chain's staking asset through {name} and keep the receipt.",
    secondary: 'Delegate $25 to a second operator through {name}.',
    secondaryCapital: 25,
  },
  insurance: {
    primary: 'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
    secondary: 'Top up $25 of cover before the policy lapses.',
    secondaryCapital: 25,
  },
  payments: {
    primary: 'Fund ${capital} into {name} on {chain} and make one payment.',
    secondary: 'Make one $10 payment a week through {name}.',
    secondaryCapital: 10,
  },
  governance: {
    primary: 'Stake ${capital} through {name} on {chain} and vote on one proposal.',
    secondary: 'Vote on a second proposal the following week.',
    secondaryCapital: 0,
  },
  cedefi: {
    primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
    secondary: 'Deposit $50 more into a second {name} product on {chain}.',
    secondaryCapital: 50,
  },
  chain: {
    primary: 'Bridge ${capital} of USDC to {chain} through its official bridge and use it in one app on {chain}.',
    secondary: 'Make one $10 swap or transaction a week on {chain}.',
    secondaryCapital: 10,
  },
  default: {
    primary: 'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
    secondary: 'Make one $10 qualifying action a week on {name}.',
    secondaryCapital: 10,
  },
};

/** Which family a category farms in; an unlisted category farms as a plain deposit. */
const FAMILY_OF: Record<string, string> = {
  Lending: 'lending',
  CDP: 'lending',
  'Collateral Markets': 'lending',
  'Uncollateralized Lending': 'lending',
  Dexs: 'dex',
  'Liquidity Manager': 'dex',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  'Leveraged Farming': 'yield',
  Farm: 'yield',
  'Risk Curators': 'curators',
  'Onchain Capital Allocator': 'curators',
  RWA: 'rwa',
  'Anchor BTC': 'rwa',
  'Decentralized BTC': 'rwa',
  'Dual-Token Stablecoin': 'rwa',
  'Stablecoin Wrapper': 'rwa',
  'Basis Trading': 'basis',
  Derivatives: 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  'Prediction Market': 'derivatives',
  Indexes: 'derivatives',
  Restaking: 'restaking',
  Insurance: 'insurance',
  Payments: 'payments',
  'Crypto Card Issuer': 'payments',
  'Governance Incentives': 'governance',
  CeDeFi: 'cedefi',
  Chain: 'chain',
};

function familyFor(category: string | null): FarmFamily {
  const key = category !== null ? FAMILY_OF[category] : undefined;
  return FAMILIES[key ?? 'default'] ?? FAMILIES['default']!;
}

/** "a" or "an" before a protocol name, by its first letter — the spec's examples use both. */
function article(name: string): string {
  return /^[AEIOUaeiou]/.test(name) ? 'an' : 'a';
}

/** Fill a farm template's {name}, {capital}, {chain} and {article} placeholders. */
function fill(template: string, name: string, capital: number, chain: string): string {
  return template.split('{name}').join(name).split('{capital}').join(String(capital)).split('{chain}').join(chain).split('{article}').join(article(name));
}

/** Double a gas amount string, keeping each figure's decimal places: $0.20 → $0.40, $3 to $12 → $6 to $24. */
function gasDouble(tx: string): string {
  return tx.replace(/\$(\d+(?:\.\d+)?)/g, (_match, amount: string) => {
    const doubled = parseFloat(amount) * 2;
    return `$${amount.includes('.') ? doubled.toFixed(2) : String(doubled)}`;
  });
}

/** Seven concrete steps to farm one protocol, with the dollars and the days named. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyFor(p.category);
  const tx = gasTx(chain);
  const total = capital + family.secondaryCapital;
  const weekly = family.weekly ?? 'adding $10 to the position, claiming rewards, or voting on a proposal';
  const positionWord = family.plural === true ? 'positions' : 'position';
  const secondaryCost = family.secondaryCapital > 0
    ? `$${family.secondaryCapital} of capital and about ${tx} of gas`
    : `about ${tx} of gas`;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: firstTxCost(chain),
      time: '5 minutes',
    },
    {
      text: fill(family.primary, p.name, capital, chain),
      cost: `$${capital} of capital and about ${tx} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: fill(family.secondary, p.name, 0, chain),
      cost: secondaryCost,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as ${weekly}.`,
      cost: `about ${tx} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the ${positionWord} for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${total} stays in the ${positionWord}`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      // Curators hold two vaults, so exiting pays for two withdrawals; every other family exits once.
      cost: family.plural === true
        ? `about ${gasDouble(tx)} of gas to withdraw from both vaults`
        : `about ${tx} of gas to withdraw`,
      time: '10 minutes',
    },
  ];
}

/** One farm step as the one string board.json carries: action, then its cost and time. */
export function farmStepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The board: every watchlist slug, plus every early protocol that passes the product test. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = peerTable(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!isRankable(p)) continue;
    chosen.set(p.slug, p);
  }
  const rows: BoardRow[] = [...chosen.values()].map((p) => {
    const value = impliedValue(p, snapshot, table, model);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: value.ageDays,
      implied_value_usd: value.implied,
      model: {
        base_multiple: round4(value.multiple),
        growth_pct: value.growthPct,
        growth_multiplier: round4(value.growthMultiplier),
        maturity_multiplier: round4(value.maturityMultiplier),
        size_multiplier: round4(value.sizeFactor),
        age_days: value.ageDays,
        peer_source: value.peerSource,
      },
      farm_steps: farmSteps(p, value.ageDays).map(farmStepText),
    };
  });
  rows.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd ||
    b.tvl_usd - a.tvl_usd ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((row, index) => { row.rank = index + 1; });
  return rows;
}

/** The live-token view: the largest live-token protocols by market cap, with the market's own figures. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return [...snapshot.protocols]
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) =>
      b.mcap_usd! - a.mcap_usd! ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The dashboard's compact view of a board row: the farm plan is generated in the page, not duplicated. */
function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    size_multiplier: row.model.size_multiplier,
    peer_source: row.model.peer_source,
  };
}

/** The dashboard's data: the board, the live set, and the model the page itself runs. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL, boardRows?: BoardRow[]): RadarData {
  const table = peerTable(snapshot);
  const multiples: PeerEntry[] = [...table.byCategory.entries()]
    .map(([category, value]) => ({ category, n: value.n, median: value.median }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const rows = boardRows ?? buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: rows.length - snapshot.watchlist.length,
    live_size: live.length,
    rows: rows.map(radarRow),
    live,
    multiples,
    global_multiple: table.global,
  };
}

/** Check a parsed snapshot is the one this model scores: the right shape, the right fields, the right watchlist. */
export function parseSnapshot(data: unknown): Snapshot {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SnapshotError('snapshot root must be an object');
  }
  const root = data as Record<string, unknown>;
  if (typeof root.as_of !== 'string' || root.as_of.length === 0) {
    throw new SnapshotError('snapshot as_of must be a non-empty string');
  }
  if (typeof root.source !== 'string' || root.source.length === 0) {
    throw new SnapshotError('snapshot source must be a non-empty string');
  }
  if (typeof root.floor_usd !== 'number' || !Number.isFinite(root.floor_usd) || root.floor_usd <= 0) {
    throw new SnapshotError('snapshot floor_usd must be a positive number');
  }
  if (!Array.isArray(root.protocols)) throw new SnapshotError('snapshot protocols must be an array');
  if (!Array.isArray(root.watchlist)) throw new SnapshotError('snapshot watchlist must be an array');
  const slugs = new Set<string>();
  for (const [index, item] of root.protocols.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new SnapshotError(`protocol ${index} must be an object`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new SnapshotError(`protocol ${index} slug must be a non-empty string`);
    if (slugs.has(p.slug)) throw new SnapshotError(`protocol ${p.slug} is listed twice`);
    slugs.add(p.slug);
    for (const field of ['name'] as const) {
      if (typeof p[field] !== 'string' || (p[field] as string).length === 0) {
        throw new SnapshotError(`protocol ${p.slug} ${field} must be a non-empty string`);
      }
    }
    if (p.category !== null && typeof p.category !== 'string') throw new SnapshotError(`protocol ${p.slug} category must be a string or null`);
    if (!Array.isArray(p.chains) || !p.chains.every((c) => typeof c === 'string')) {
      throw new SnapshotError(`protocol ${p.slug} chains must be an array of strings`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`protocol ${p.slug} tvl_usd must be a non-negative number`);
    }
    if (p.change_7d !== null && typeof p.change_7d !== 'number') throw new SnapshotError(`protocol ${p.slug} change_7d must be a number or null`);
    if (p.mcap_usd !== null && typeof p.mcap_usd !== 'number') throw new SnapshotError(`protocol ${p.slug} mcap_usd must be a number or null`);
    if (p.listed_at !== null && typeof p.listed_at !== 'string') throw new SnapshotError(`protocol ${p.slug} listed_at must be a string or null`);
    if (p.gecko_id !== null && typeof p.gecko_id !== 'string') throw new SnapshotError(`protocol ${p.slug} gecko_id must be a string or null`);
    if (p.symbol !== null && typeof p.symbol !== 'string') throw new SnapshotError(`protocol ${p.slug} symbol must be a string or null`);
  }
  for (const [index, item] of root.watchlist.entries()) {
    if (typeof item !== 'string' || item.length === 0) throw new SnapshotError(`watchlist ${index} must be a non-empty string`);
    if (!slugs.has(item)) throw new SnapshotError(`watchlist slug ${item} is not in the snapshot`);
  }
  return {
    as_of: root.as_of,
    source: root.source,
    floor_usd: root.floor_usd,
    protocols: root.protocols as SnapshotProtocol[],
    watchlist: root.watchlist as string[],
  };
}

/** What is wrong with a board, in the order it was checked; empty when the board is sound. */
export function boardIssue(snapshot: Snapshot, rows: BoardRow[]): string | null {
  const seenSlugs = new Set<string>();
  for (const row of rows) {
    if (seenSlugs.has(row.slug)) return `slug ${row.slug} is on the board twice`;
    seenSlugs.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!rows.some((r) => r.slug === slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const ranks = new Set<number>();
  for (const row of rows) {
    if (row.rank < 1 || row.rank > rows.length) return `row ${row.slug} has rank ${row.rank} outside 1..${rows.length}`;
    if (ranks.has(row.rank)) return `rank ${row.rank} is used twice`;
    ranks.add(row.rank);
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      return `row ${rows[i]!.slug} implied value rises above the row above it`;
    }
  }
  const values = new Set<number>();
  for (const row of rows) {
    if (values.has(row.implied_value_usd)) return `row ${row.slug} repeats an implied value`;
    values.add(row.implied_value_usd);
    if (row.implied_value_usd < 1 || !Number.isInteger(row.implied_value_usd)) {
      return `row ${row.slug} implied value is not a positive whole dollar amount`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, not 3..12`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `row ${row.slug} has a farm step outside 20..600 characters`;
    }
  }
  return null;
}

/** The dashboard's data as the script it loads: `window.RADAR = {...}`. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
