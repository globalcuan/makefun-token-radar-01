// radar-2 estimates pre-token value from snapshot-only live-token category medians.
// Momentum, listing age, and chain reach adjust TVL times the category multiple.
// Categories with fewer than three live peers use the clamped global median.
export const MODEL_VERSION = 'radar-2';

export const MODEL = {
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.5,
  maturity_floor: 0.6,
  maturity_days: 1095,
  maturity_range: 0.4,
  unknown_age_days: 365,
  category_method: 'Median live-token mcap/TVL by category (at least 3 peers), clamped to 0.05–3; otherwise global median.'
};

const finite = (value: any) => typeof value === 'number' && Number.isFinite(value);

export function parseSnapshot(raw: any) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof raw.as_of !== 'string' ||
    !Array.isArray(raw.protocols) ||
    !Array.isArray(raw.watchlist) ||
    !finite(raw.floor_usd)
  ) {
    throw new Error('Invalid snapshot shape');
  }

  const protocols = raw.protocols.map((protocol: any) => {
    if (
      !protocol ||
      typeof protocol.slug !== 'string' ||
      typeof protocol.name !== 'string' ||
      !Array.isArray(protocol.chains) ||
      !finite(protocol.tvl_usd)
    ) {
      throw new Error('Invalid protocol row');
    }

    for (const key of ['change_7d', 'mcap_usd']) {
      if (protocol[key] !== null && protocol[key] !== undefined && !finite(protocol[key])) {
        throw new Error('Invalid numeric field: ' + key);
      }
    }

    return {
      ...protocol,
      category: protocol.category ?? null,
      change_7d: protocol.change_7d ?? null,
      mcap_usd: protocol.mcap_usd ?? null,
      listed_at: protocol.listed_at ?? null,
      gecko_id: protocol.gecko_id ?? null,
      symbol: protocol.symbol ?? null
    };
  });

  return {
    as_of: raw.as_of,
    source: raw.source ?? '',
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist
  };
}

const median = (values: number[]) => {
  values.sort((left, right) => left - right);
  const count = values.length;
  if (count % 2) return values[(count - 1) / 2];
  return (values[count / 2 - 1] + values[count / 2]) / 2;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const ageAt = (listed: any, asOf: string): number | null => {
  if (!listed) return null;
  const days = (Date.parse(asOf) - Date.parse(listed)) / 86400000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
};

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

const farmPlanTemplates: Record<string, string[]> = {
  dexes: [
    'Swap a small amount in a core pool',
    'Add liquidity to a deep pool',
    'Return later to make a second swap',
    'Check the app for points and vote if eligible'
  ],
  lending: [
    'Supply a small amount of collateral',
    'Borrow a modest amount and repay it',
    'Repeat a supply action next week',
    'Check governance and vote if eligible'
  ],
  bridge: [
    'Bridge a small asset amount to a supported chain',
    'Use the received funds in a supported app',
    'Bridge back after confirming settlement',
    'Check for a bridge task or campaign'
  ],
  'liquid staking': [
    'Stake a small amount of the chain asset',
    'Use the receipt token in a supported app',
    'Add or remove a small stake later',
    'Check governance and vote if eligible'
  ],
  derivatives: [
    'Deposit a small margin balance',
    'Open and close a low-risk test position',
    'Repeat a small trade on another day',
    'Check the protocol task board'
  ],
  yield: [
    'Deposit a small amount into a vault',
    'Claim or compound once if available',
    'Make a second deposit action next week',
    'Check governance and vote if eligible'
  ],
  nft: [
    'Mint or list a low-cost item',
    'Complete a collection or marketplace action',
    'Return to trade or list another item',
    'Check community tasks and vote if eligible'
  ],
  gaming: [
    'Complete the first playable task',
    'Complete a second in-game activity',
    'Return on another day for a daily task',
    'Check the game task board'
  ],
  infrastructure: [
    'Complete an available testnet task',
    'Run a supported test transaction',
    'Repeat a documented task on another day',
    'Record the transaction and check task status'
  ],
  default: [
    'Connect a wallet and complete the core app action',
    'Make a small supported transaction',
    'Return next week for another action',
    'Check governance or testnet tasks'
  ]
};

function getFarmPlanKey(category: any) {
  const value = String(category || '').toLowerCase();
  if (/dex|exchange|swap/.test(value)) return 'dexes';
  if (/lend|credit/.test(value)) return 'lending';
  if (/bridge/.test(value)) return 'bridge';
  if (/liquid staking|staking/.test(value)) return 'liquid staking';
  if (/derivative|perpetual/.test(value)) return 'derivatives';
  if (/yield|farm|vault/.test(value)) return 'yield';
  if (/nft|collectible/.test(value)) return 'nft';
  if (/gaming|game/.test(value)) return 'gaming';
  if (/infrastructure|oracle|developer|data/.test(value)) return 'infrastructure';
  return 'default';
}

function farm(protocol: any) {
  const plan = farmPlanTemplates[getFarmPlanKey(protocol.category)].slice();
  const offset = hash(protocol.slug) % plan.length;
  const orderedPlan = plan.slice(offset).concat(plan.slice(0, offset));

  return orderedPlan.map((text, index) => ({
    text,
    cost: index === 0
      ? 'gas only, about $1-5'
      : index === 1
        ? 'capital at risk: market exposure'
        : 'gas only, about $1-5',
    time: index === 2 ? 'weekly, 5 min' : '10 min'
  }));
}

function categoryMedians(live: any[], globalMedian: number) {
  const valuesByCategory = new Map<string, number[]>();
  live.forEach((protocol: any) => {
    if (!protocol.category) return;
    const values = valuesByCategory.get(protocol.category) || [];
    values.push(protocol.mcap_usd / protocol.tvl_usd);
    valuesByCategory.set(protocol.category, values);
  });

  const multiples = new Map<string, number>();
  valuesByCategory.forEach((values, name) => {
    const multiple = values.length >= 3 ? clamp(median(values), 0.05, 3) : globalMedian;
    multiples.set(name, multiple);
  });
  return multiples;
}

function momentum(change7d: number | null) {
  const growth = clamp(change7d ?? 0, -60, 120);
  return 1 + growth / 100 * 0.5;
}

function maturity(age: number | null) {
  return 0.6 + Math.min(age ?? 365, 1095) / 1095 * 0.4;
}

function reach(chains: any[]) {
  return Math.min(1.25, 1 + 0.05 * Math.max(0, chains.length - 1));
}

function score(protocol: any, snapshot: any, multiples: Map<string, number>, globalMedian: number) {
  const age = ageAt(protocol.listed_at, snapshot.as_of);
  const multiple = protocol.category ? multiples.get(protocol.category) ?? globalMedian : globalMedian;
  const momentumValue = momentum(protocol.change_7d);
  const maturityValue = maturity(age);
  const reachValue = reach(protocol.chains);
  const value = Math.max(1, Math.round(protocol.tvl_usd * multiple * momentumValue * maturityValue * reachValue));

  return { age, multiple, momentum: momentumValue, maturity: maturityValue, reach: reachValue, value };
}

export function build(snapshot: any) {
  const live = snapshot.protocols.filter((protocol: any) => protocol.mcap_usd !== null && protocol.tvl_usd > 0);
  const ratios = live
    .map((protocol: any) => protocol.mcap_usd / protocol.tvl_usd)
    .filter(finite);
  const globalMedian = clamp(ratios.length ? median(ratios) : 0.5, 0.05, 3);
  const multiples = categoryMedians(live, globalMedian);

  const preToken = snapshot.protocols.filter((protocol: any) =>
    protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null);
  const watchlist = new Set(snapshot.watchlist);
  const selected = preToken.filter((protocol: any) => watchlist.has(protocol.slug));
  const early = preToken
    .filter((protocol: any) => !watchlist.has(protocol.slug) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((left: any, right: any) => right.tvl_usd - left.tvl_usd || left.slug.localeCompare(right.slug))
    .slice(0, 160);

  const rows = selected.concat(early)
    .map((protocol: any) => {
      const result = score(protocol, snapshot, multiples, globalMedian);
      return {
        ...protocol,
        token_status: 'pre-token',
        age_days: result.age,
        implied_value_usd: result.value,
        model_breakdown: {
          category_multiple: result.multiple,
          momentum: result.momentum,
          maturity: result.maturity,
          reach: result.reach
        },
        farm_steps: farm(protocol)
      };
    })
    .sort((left: any, right: any) => right.implied_value_usd - left.implied_value_usd || left.slug.localeCompare(right.slug))
    .map((protocol: any, index: number) => ({ ...protocol, rank: index + 1 }));

  const radar = early.map((protocol: any) => ({
    ...protocol,
    age_days: ageAt(protocol.listed_at, snapshot.as_of)
  }));
  const liveRows = live
    .slice()
    .sort((left: any, right: any) => right.mcap_usd - left.mcap_usd || left.slug.localeCompare(right.slug))
    .slice(0, 24);

  return {
    rows,
    radar,
    live: liveRows,
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      watchlist_size: selected.length,
      early_size: early.length,
      board_size: rows.length,
      live_size: liveRows.length,
      model_version: MODEL_VERSION,
      model: MODEL
    }
  };
}

export function boardIssue(board: any, watchlist: string[]) {
  if (!Array.isArray(board) || board.some((row: any, index: number) => row.rank !== index + 1)) {
    return 'Ranks must be contiguous from 1';
  }

  for (const slug of watchlist) {
    if (!board.some((row: any) => row.slug === slug && row.token_status === 'pre-token')) {
      return 'Missing watchlist pre-token: ' + slug;
    }
  }

  for (let index = 1; index < board.length; index++) {
    const previous = board[index - 1];
    const current = board[index];
    if (
      previous.implied_value_usd < current.implied_value_usd ||
      (previous.implied_value_usd === current.implied_value_usd && previous.slug.localeCompare(current.slug) > 0)
    ) {
      return 'Board order is invalid';
    }
  }
  return null;
}

export function dataScript(board: any[], radar: any[], live: any[], meta: any) {
  const data = { ...meta, rows: board, radar, live };
  return 'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n' +
    'window.RADAR = window.RADAR_DATA;\n';
}
