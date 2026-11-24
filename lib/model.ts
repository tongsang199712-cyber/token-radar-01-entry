// Launch Radar's model: one sealed snapshot in, one ranked board out.
//
// The question the board answers: if a protocol that records no token issued one today, at what
// fully diluted value would the market most plausibly price it? The model answers with the
// snapshot's own evidence, in three steps, and never with a hand-kept list of names:
//
//   1. Comparable multiple. Protocols whose token already trades reveal what the market pays
//      per dollar of TVL in each category: the ratio mcap_usd / tvl_usd. The model takes the
//      median ratio of the live-token protocols in the protocol's own category, shrunk toward
//      the all-category median in proportion to how few live samples the category has, and
//      clamped to a sane band. A category with no live sample uses the global median.
//   2. Momentum. Seven-day TVL growth, clamped to [-50, +100] per cent, scales the value by
//      1 + growth/100 x 0.6: a protocol adding TVL is worth more than a shrinking one.
//   3. Track record. A protocol that has run longer with no token has more evidence behind it:
//      a maturity factor rising from 0.55 at listing to 1.00 at four years. An unreported
//      listing date counts as one year.
//
//   implied_value_usd = round( tvl_usd x category_multiple x momentum x maturity )
//
// The board ranks every protocol the snapshot's watchlist names (the floor) and every other
// protocol that passes the same test the watchlist itself applies: it records no token and is
// not a wrapped, staked or bridged product of one that trades (no bridge, liquid staking,
// restaking or exchange category, no versioned or wrapped/staked name, no exchange prefix).
// Protocols whose token already trades are never ranked: the dashboard sets them aside with
// the market's own market cap, which is a fact, not a model.

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

/** The model's constants, stated on the dashboard so a reader can re-run the arithmetic. */
export interface ModelConstants {
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 6,
  multiple_floor: 0.04,
  multiple_cap: 1.2,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.6,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label, named on the dashboard and in board.json. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's "already trading" view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's comparable multiple, derived from the snapshot's live-token protocols. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  raw_median: number;
  samples: number;
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
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
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_samples: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row itself, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  tvl_multiple: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  universe_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories whose products are a wrapped, staked or bridged claim on a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a derivative product, not a launch. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol may be ranked: it records no token and is not a wrapped, staked or bridged
 * product of one that trades. This is the watchlist's own test, applied to the whole snapshot,
 * so the early rows below the floor are held to the same standard as the floor itself.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_NAME.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparable multiples, derived from the snapshot itself: for each category, the median
 * mcap/TVL ratio of its live-token protocols, shrunk toward the global median by the factor
 * samples / (samples + shrink_prior) and clamped to [multiple_floor, multiple_cap].
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalRaw = all.length > 0 ? median(all) : 0.2;
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of [...ratiosByCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const raw = median(ratios);
    const weight = ratios.length / (ratios.length + model.shrink_prior);
    const shrunk = raw * weight + globalRaw * (1 - weight);
    byCategory.set(category, {
      category,
      multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk))),
      raw_median: round4(raw),
      samples: ratios.length,
    });
  }
  return { global: round4(global), byCategory };
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
): { implied: number; momentumMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const momentumMult = 1 + (growth / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * momentumMult * maturityMult));
  return { implied, momentumMult, maturityMult, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on a chain, in dollars: mainnet is dear, rollups and Solana cheap. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$8-15';
  if (c === 'solana') return 'under $0.10';
  if (['arbitrum', 'base', 'optimism', 'zksync era', 'linea', 'scroll', 'mantle', 'blast', 'mode'].includes(c)) return '$0.20-1';
  if (['bsc', 'polygon', 'avalanche', 'fantom', 'gnosis'].includes(c)) return '$0.10-0.50';
  return '$1-3';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC into an open term on ${n} on ${chain}; uncollateralised terms carry credit risk, so start with the shortest term on offer`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, then borrow about 40% of it back and re-supply the borrowed half once`;
  if (c.includes('dex')) return `Provide $${capital} split evenly between the two sides of ${n}'s highest-volume stable or blue-chip pool on ${chain}`;
  if (c.includes('leveraged farm')) return `Open a 2x leveraged farm on ${n}'s main ${chain} pool with $${capital} of equity and set the liquidation alert before you leave it`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into the largest ${n} vault on ${chain} and hold the vault shares in the same wallet`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then put the bridged funds to work in one app on the far side the same day`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the farming wallet`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${n} and trade one small hedged pair (long and short of equal size) so volume counts without directional risk`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take a position in three different markets, sized under $${Math.max(10, Math.round(capital / 10))} each`;
  if (c.includes('basis')) return `Run a delta-neutral basis position on ${n}: $${capital} long spot against an equal short perpetual, on ${chain}`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it; check the issuer's attestation page before you mint`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${n} on ${chain} for the longest term on offer and keep the policy NFT`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold the balance in the farming wallet`;
  if (c.includes('payment') || c.includes('card')) return `Activate a ${n} account, fund $${capital} and route one real payment or card purchase a week through it`;
  if (c.includes('index')) return `Buy $${capital} of the main ${n} index basket on ${chain} and hold it; rebalance only when the index does`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${n}'s shielded pool on ${chain}, hold it shielded, and make one shielded transfer a week`;
  if (c.includes('option')) return `Deposit $${capital} into one ${n} options vault on ${chain} and let it run a full epoch before judging it`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${n}'s main vault on ${chain} and keep the shares; do not chase the highest-APY vault, the largest one is the one snapshots count`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${n}'s chain and use two native apps there in the first week, so the wallet reads as an early chain user`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open in the farming wallet`;
}

/** The category's second surface: one more qualifying action that deepens the footprint. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay and re-borrow once mid-hold so the wallet shows a full lending cycle on ${n}, not a single deposit`;
  if (c.includes('dex')) return `Make two small swaps a week in the same pool on ${n}; steady volume from one wallet counts for more than one large trade`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Split a second, smaller deposit into a different ${n} vault on ${chain} so the wallet appears in two of its vaults`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis')) return `Roll the hedge once a month and keep margin above 60% of the requirement so the position is never force-closed`;
  if (c.includes('bridge')) return `Bridge a small amount back once, then bridge in again: a round trip reads as a real user of ${n}, not a one-way airdrop hop`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or delegate a slice of the receipt once, and vote with it if ${n} opens governance to receipt holders`;
  if (c.includes('rwa') || c.includes('stable')) return `Hold through one full distribution or rebase cycle on ${n} so the balance appears in a periodic holder snapshot`;
  return `Use one second feature of ${n} on ${chain} in the second week (a different market, pool or vault), so the wallet is not a one-action address`;
}

/** A step trimmed into the gate's 20..600 character band. */
function step(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length > 600) return `${t.slice(0, 596)}...`;
  return t;
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, derived from
 * the protocol's own record (category, chains, TVL, age) by the same rules for every row.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.round(hold / 7));
  const chainCount = p.chains.length;
  return [
    step(
      `Set up a fresh wallet for ${p.name} alone and fund it on ${chain} with the position capital plus gas headroom; keep the seed phrase offline and never reuse this wallet for unrelated airdrops. Cost: ${gas} for the funding transaction. Time: 10 minutes.`,
    ),
    step(`${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus ${gas} of gas. Time: 15-20 minutes to set up.`),
    step(`${secondActionFor(p, chain)}. Cost: about ${gas} of gas. Time: 10 minutes.`),
    step(
      `Repeat one qualifying action on ${p.name} every week for ${weeks} weeks (a deposit, a swap, a borrow or a vote, whichever its app counts); consistency across weeks is what points systems and snapshots reward. Cost: about ${gas} of gas a week. Time: 10 minutes a week.`,
    ),
    step(
      `Hold the position for at least ${hold} days${chainCount > 1 ? `, and if ${p.name} counts activity on its other chains (${p.chains.slice(0, 3).join(', ')}), mirror a small position on one of them in week two` : ''}. Cost: the $${capital} stays in the position; no new spend. Time: ${hold} days.`,
    ),
    step(
      `Once a week, check ${p.name}'s own site and official channels for a points or rewards page and claim only from a link the protocol itself publishes; never pay a fee or sign a "claim" prompt from a search result or a direct message. Cost: $0. Time: 5 minutes a week.`,
    ),
    step(
      `Keep a farm log (wallet, dates, transaction hashes, amounts) and plan the exit now: withdraw over 2-3 days once a token or points conversion is announced, or sooner if ${p.name}'s TVL falls by a third in a week. Cost: about ${gas} of gas to unwind. Time: 30 minutes.`,
    ),
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, global } = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const entry = byCategory.get(p.category ?? '(uncategorised)');
    const multiple = entry?.multiple ?? global;
    const { implied, momentumMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, implied, momentumMult, maturityMult, age, multiple, samples: entry?.samples ?? 0 };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      multiple_samples: s.samples,
      momentum_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      tvl_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, byCategory } = categoryMultiples(snapshot, model);
  const multiples = [...byCategory.values()]
    .filter((m) => board.some((r) => (r.category ?? '(uncategorised)') === m.category))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: global,
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    universe_size: snapshot.protocols.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${byRank[i]!.slug} outranks ${byRank[i - 1]!.slug} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
