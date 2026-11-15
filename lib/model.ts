// Radar-2 estimates pre-token value from live-token mcap/TVL medians.
// Momentum and maturity adjust TVL times a clamped category or global multiple.
// The gate contract defines exact snapshot, board, radar, and output shapes.
export const MODEL_VERSION = 'radar-2';
export const MODEL = { base_multiple: 0.25, growth_weight: 0.5, growth_floor: -60, growth_cap: 120, maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095, unknown_age_days: 365 };

export class SnapshotError extends Error { constructor(message: string) { super(message); this.name = 'SnapshotError'; } }
const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]) => { const a = xs.slice().sort((x,y)=>x-y), n=a.length; return n%2 ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2; };

export function parseSnapshot(text: string) {
  let raw: any;
  try { raw = JSON.parse(text); } catch (_) { throw new SnapshotError('Invalid snapshot JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SnapshotError('Snapshot must be an object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of) || Number.isNaN(Date.parse(raw.as_of))) throw new SnapshotError('Snapshot as_of must be YYYY-MM-DD');
  if (typeof raw.source !== 'string') throw new SnapshotError('Snapshot source must be a string');
  if (!Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) throw new SnapshotError('Snapshot floor_usd must be a positive safe integer');
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('Snapshot protocols must be an array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((x:any)=>typeof x!=='string')) throw new SnapshotError('Snapshot watchlist must be an array of strings');
  const protocols = raw.protocols.map((p:any, i:number) => {
    if (!p || typeof p !== 'object' || typeof p.slug !== 'string' || !p.slug || typeof p.name !== 'string' || !p.name || !finite(p.tvl_usd)) throw new SnapshotError(`Protocol ${i} must have slug, name, and finite tvl_usd`);
    if (p.category != null && typeof p.category !== 'string') throw new SnapshotError(`Protocol ${p.slug} category must be a string or null`);
    if (p.chains != null && (!Array.isArray(p.chains) || p.chains.some((x:any)=>typeof x!=='string'))) throw new SnapshotError(`Protocol ${p.slug} chains must be strings`);
    for (const k of ['change_7d','mcap_usd']) if (p[k] != null && !finite(p[k])) throw new SnapshotError(`Protocol ${p.slug} ${k} must be finite or null`);
    for (const k of ['listed_at','gecko_id','symbol']) if (p[k] != null && typeof p[k] !== 'string') throw new SnapshotError(`Protocol ${p.slug} ${k} must be a string or null`);
    return { slug:p.slug, name:p.name, category:p.category ?? null, chains:p.chains ?? [], tvl_usd:p.tvl_usd, change_7d:p.change_7d ?? null, mcap_usd:p.mcap_usd ?? null, listed_at:p.listed_at ?? null, gecko_id:p.gecko_id ?? null, symbol:p.symbol ?? null };
  });
  return { as_of:raw.as_of, source:raw.source, floor_usd:raw.floor_usd, protocols, watchlist:raw.watchlist.slice() };
}

export const isPreToken = (p:any) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
export const isRankable = (p:any) => isPreToken(p) && p.category !== 'CEX' && !/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name);

const templates: Record<string, Array<[string,string,string]>> = {
  Dexes:[['Swap a small amount in a core pool','gas only, about $1-5','10 min'],['Add liquidity to a deep pool','capital at risk: market exposure','15 min'],['Return later to make a second swap','gas only, about $1-5','10 min'],['Check the app for points and vote if eligible','no cost','5 min']],
  Lending:[['Supply a small amount of collateral','capital at risk: market exposure','10 min'],['Borrow a modest amount and repay it','fees and interest may apply','15 min'],['Repeat a supply action next week','capital at risk: market exposure','10 min'],['Check governance and vote if eligible','no cost','5 min']],
  Bridge:[['Bridge a small asset amount to a supported chain','network fees apply','15 min'],['Use the received funds in a supported app','capital at risk: market exposure','10 min'],['Bridge back after confirming settlement','network fees apply','15 min'],['Check for a bridge task or campaign','no cost','5 min']],
  'Liquid Staking':[['Stake a small amount of the chain asset','capital at risk: market exposure','10 min'],['Use the receipt token in a supported app','capital at risk: market exposure','15 min'],['Add or remove a small stake later','network fees apply','10 min'],['Check governance and vote if eligible','no cost','5 min']],
  Derivatives:[['Deposit a small margin balance','capital at risk: market exposure','10 min'],['Open and close a low-risk test position','capital at risk: liquidation possible','15 min'],['Repeat a small trade on another day','trading fees apply','10 min'],['Check the protocol task board','no cost','5 min']],
  Yield:[['Deposit a small amount into a vault','capital at risk: market exposure','10 min'],['Claim or compound once if available','network fees may apply','10 min'],['Make a second deposit action next week','capital at risk: market exposure','10 min'],['Check governance and vote if eligible','no cost','5 min']],
  CDP:[['Open a collateralized position with a small amount','capital at risk: liquidation possible','15 min'],['Review collateral ratio and add collateral','capital at risk: market exposure','10 min'],['Repay a portion of the debt','fees and interest may apply','10 min'],['Check protocol guidance and governance','no cost','5 min']],
  'Risk Curators':[['Deposit a small amount into a curated market','capital at risk: market exposure','10 min'],['Review the curator and market parameters','no cost','10 min'],['Return later to adjust or withdraw a position','network fees may apply','10 min'],['Check curator updates and governance','no cost','5 min']],
  default:[['Connect a wallet and complete the core app action','network fees may apply','10 min'],['Make a small supported transaction','capital at risk: market exposure','10 min'],['Return next week for another action','network fees may apply','10 min'],['Check governance or protocol tasks','no cost','5 min']]
};
function templateKey(c:string|null) { if (!c) return 'default'; const s=c.toLowerCase(); if (/dex|exchange|swap/.test(s)) return 'Dexes'; if (/lend|credit/.test(s)) return 'Lending'; if (/bridge/.test(s)) return 'Bridge'; if (/liquid staking|staking/.test(s)) return 'Liquid Staking'; if (/derivative|perpetual/.test(s)) return 'Derivatives'; if (/yield|farm|vault/.test(s)) return 'Yield'; if (/cdp|collateralized debt/.test(s)) return 'CDP'; if (/risk curator/.test(s)) return 'Risk Curators'; return 'default'; }
export function farmPlan(category:string|null) { return templates[templateKey(category)].map(([text,cost,time])=>({text,cost,time})); }
export function stepText(step:{text:string;cost:string;time:string}) { let s=`${step.text} Cost: ${step.cost}. Time: ${step.time}.`; if(s.length>600)s=s.slice(0,596)+'...'; if(s.length<20)s += " Hold the position and check the protocol's own page."; return s; }
function ageAt(listed:string|null, asOf:string):number|null { if(!listed)return null; const t=Date.parse(listed), a=Date.parse(asOf); return Number.isFinite(t)&&Number.isFinite(a)?Math.max(0,Math.floor((a-t)/86400000)):null; }
function fields(p:any) { return {slug:p.slug,name:p.name,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,change_7d:p.change_7d,mcap_usd:p.mcap_usd,listed_at:p.listed_at,gecko_id:p.gecko_id,symbol:p.symbol}; }
export function build(snapshot:any) {
  const live=snapshot.protocols.filter((p:any)=>p.mcap_usd!==null && p.tvl_usd>0);
  const global=clamp(live.length?median(live.map((p:any)=>p.mcap_usd/p.tvl_usd)):0.25,0.05,3);
  const categoryValues=new Map<string,number[]>(); live.forEach((p:any)=>{if(p.category!==null){const a=categoryValues.get(p.category)||[];a.push(p.mcap_usd/p.tvl_usd);categoryValues.set(p.category,a);}});
  const selected=new Map<string,any>(); snapshot.watchlist.forEach((s:string)=>{const p=snapshot.protocols.find((x:any)=>x.slug===s);if(p)selected.set(s,p);});
  const early=snapshot.protocols.filter((p:any)=>!selected.has(p.slug)&&isRankable(p)&&p.tvl_usd<snapshot.floor_usd).sort((a:any,b:any)=>b.tvl_usd-a.tvl_usd||a.slug.localeCompare(b.slug)).slice(0,160); early.forEach((p:any)=>selected.set(p.slug,p));
  const rows=Array.from(selected.values()).map((p:any)=>{const age=ageAt(p.listed_at,snapshot.as_of), vals=p.category===null?null:categoryValues.get(p.category); const multiple=vals&&vals.length>=3?clamp(median(vals),.05,3):global; const growth=clamp(p.change_7d??0,-60,120), gm=1+growth/100*.5, mm=.6+Math.min(age??365,1095)/1095*.4, value=Math.max(1,Math.round(p.tvl_usd*multiple*gm*mm)); return {...fields(p),token_status:'pre-token',age_days:age,implied_value_usd:value,model:{base_multiple:Number(multiple.toFixed(4)),growth_pct:growth,growth_multiplier:Number(gm.toFixed(4)),maturity_multiplier:Number(mm.toFixed(4)),age_days:age},farm_steps:farmPlan(p.category).map(stepText)};}).sort((a:any,b:any)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug)).map((p:any,i:number)=>({...p,rank:i+1}));
  const watch=new Set(snapshot.watchlist);
  const radarRows=rows.map((p:any)=>({rank:p.rank,slug:p.slug,name:p.name,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,change_7d:p.change_7d,mcap_usd:p.mcap_usd,listed_at:p.listed_at,age_days:p.age_days,implied_value_usd:p.implied_value_usd,growth_multiplier:p.model.growth_multiplier,maturity_multiplier:p.model.maturity_multiplier}));
  const liveRows=live.slice().sort((a:any,b:any)=>b.mcap_usd-a.mcap_usd||a.slug.localeCompare(b.slug)).slice(0,24).map((p:any)=>({slug:p.slug,name:p.name,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,mcap_usd:p.mcap_usd,change_7d:p.change_7d}));
  const radar={as_of:snapshot.as_of,source:snapshot.source,floor_usd:snapshot.floor_usd,model:MODEL,model_version:MODEL_VERSION,watchlist_size:snapshot.watchlist.length,board_size:rows.length,early_size:rows.filter((r:any)=>!watch.has(r.slug)).length,live_size:liveRows.length,rows:radarRows,live:liveRows};
  return {rows,radar};
}
export function boardIssue(board:any,snapshot:any) {
  if(!Array.isArray(board))return 'Board must be an array';
  for(const slug of snapshot.watchlist)if(!board.some((r:any)=>r.slug===slug))return 'Missing watchlist slug: '+slug;
  if(board.some((r:any,i:number)=>r.rank!==i+1))return 'Ranks must be exactly 1..n';
  if(board.some((r:any,i:number)=>i>0&&board[i-1].implied_value_usd<r.implied_value_usd))return 'Implied values must be descending';
  if(board.length>=2&&board.every((r:any)=>r.implied_value_usd===board[0].implied_value_usd))return 'All rows share one implied value';
  for(const r of board){if(!Number.isSafeInteger(r.implied_value_usd)||r.implied_value_usd<=0)return 'Implied value must be a positive safe integer';if(!Array.isArray(r.farm_steps)||r.farm_steps.length<3||r.farm_steps.length>12)return 'Farm step count outside 3..12';for(const s of r.farm_steps)if(typeof s!=='string'||s.length<20||s.length>600)return 'Farm step length outside 20..600';}
  return null;
}
export function dataScript(radar:any) { return 'window.RADAR='+JSON.stringify(radar)+';\n'; }
