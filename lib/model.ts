// radar-2 estimates pre-token value from snapshot-only live-token category medians.
// Momentum, listing age, and chain reach adjust TVL times the category multiple.
// Categories with fewer than three live peers use the clamped global median.
export const MODEL_VERSION = 'radar-2';
export const MODEL = { growth_floor: -60, growth_cap: 120, growth_weight: 0.5, maturity_floor: 0.6, maturity_days: 1095, maturity_range: 0.4, unknown_age_days: 365, category_method: 'Median live-token mcap/TVL by category (at least 3 peers), clamped to 0.05–3; otherwise global median.' };

const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
export function parseSnapshot(raw: any) {
  if (!raw || typeof raw !== 'object' || typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist) || !finite(raw.floor_usd)) throw new Error('Invalid snapshot shape');
  const protocols = raw.protocols.map((p: any) => {
    if (!p || typeof p.slug !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.chains) || !finite(p.tvl_usd)) throw new Error('Invalid protocol row');
    for (const k of ['change_7d','mcap_usd']) if (p[k] !== null && p[k] !== undefined && !finite(p[k])) throw new Error('Invalid numeric field: '+k);
    return { ...p, category: p.category ?? null, change_7d: p.change_7d ?? null, mcap_usd: p.mcap_usd ?? null, listed_at: p.listed_at ?? null, gecko_id: p.gecko_id ?? null, symbol: p.symbol ?? null };
  });
  return { as_of: raw.as_of, source: raw.source ?? '', floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist };
}
const median = (xs: number[]) => { xs.sort((a,b)=>a-b); const n=xs.length; return n%2 ? xs[(n-1)/2] : (xs[n/2-1]+xs[n/2])/2; };
const clamp = (n:number,a:number,b:number) => Math.min(b,Math.max(a,n));
const ageAt = (listed: any, asof:string): number|null => { if (!listed) return null; const d=(Date.parse(asof)-Date.parse(listed))/86400000; return Number.isFinite(d)?Math.max(0,Math.floor(d)):null; };
function hash(s:string) { let h=2166136261; for(let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619); return h>>>0; }
function farm(p:any) {
  const plans: Record<string,string[]> = {
    dexes:['Swap a small amount in a core pool','Add liquidity to a deep pool','Return later to make a second swap','Check the app for points and vote if eligible'],
    lending:['Supply a small amount of collateral','Borrow a modest amount and repay it','Repeat a supply action next week','Check governance and vote if eligible'],
    bridge:['Bridge a small asset amount to a supported chain','Use the received funds in a supported app','Bridge back after confirming settlement','Check for a bridge task or campaign'],
    'liquid staking':['Stake a small amount of the chain asset','Use the receipt token in a supported app','Add or remove a small stake later','Check governance and vote if eligible'],
    derivatives:['Deposit a small margin balance','Open and close a low-risk test position','Repeat a small trade on another day','Check the protocol task board'],
    yield:['Deposit a small amount into a vault','Claim or compound once if available','Make a second deposit action next week','Check governance and vote if eligible'],
    nft:['Mint or list a low-cost item','Complete a collection or marketplace action','Return to trade or list another item','Check community tasks and vote if eligible'],
    gaming:['Complete the first playable task','Complete a second in-game activity','Return on another day for a daily task','Check the game task board'],
    infrastructure:['Complete an available testnet task','Run a supported test transaction','Repeat a documented task on another day','Record the transaction and check task status'],
    default:['Connect a wallet and complete the core app action','Make a small supported transaction','Return next week for another action','Check governance or testnet tasks']
  };
  const c=String(p.category||'').toLowerCase(); let key='default';
  if(/dex|exchange|swap/.test(c))key='dexes'; else if(/lend|credit/.test(c))key='lending'; else if(/bridge/.test(c))key='bridge'; else if(/liquid staking|staking/.test(c))key='liquid staking'; else if(/derivative|perpetual/.test(c))key='derivatives'; else if(/yield|farm|vault/.test(c))key='yield'; else if(/nft|collectible/.test(c))key='nft'; else if(/gaming|game/.test(c))key='gaming'; else if(/infrastructure|oracle|developer|data/.test(c))key='infrastructure';
  const arr=plans[key].slice(), offset=hash(p.slug)%arr.length, ordered=arr.slice(offset).concat(arr.slice(0,offset));
  return ordered.map((text,i)=>({text, cost:i===0?'gas only, about $1-5':i===1?'capital at risk: market exposure':'gas only, about $1-5', time:i===2?'weekly, 5 min':'10 min'}));
}
export function build(snapshot:any) {
  const live=snapshot.protocols.filter((p:any)=>p.mcap_usd!==null&&p.tvl_usd>0);
  const ratios=live.map((p:any)=>p.mcap_usd/p.tvl_usd).filter(finite);
  const global=clamp(ratios.length?median(ratios):0.5,.05,3);
  const cats=new Map<string,number[]>(); live.forEach((p:any)=>{if(p.category){const a=cats.get(p.category)||[];a.push(p.mcap_usd/p.tvl_usd);cats.set(p.category,a);}});
  const multiples=new Map<string,number>(); cats.forEach((xs,k)=>multiples.set(k,xs.length>=3?clamp(median(xs),.05,3):global));
  const pre=snapshot.protocols.filter((p:any)=>p.mcap_usd===null&&p.gecko_id===null&&p.symbol===null);
  const watch=new Set(snapshot.watchlist); const selected=pre.filter((p:any)=>watch.has(p.slug));
  const early=pre.filter((p:any)=>!watch.has(p.slug)&&p.tvl_usd<snapshot.floor_usd).sort((a:any,b:any)=>b.tvl_usd-a.tvl_usd||a.slug.localeCompare(b.slug)).slice(0,160);
  const score=(p:any)=>{const age=ageAt(p.listed_at,snapshot.as_of), mult=p.category?multiples.get(p.category)??global:global, growth=clamp(p.change_7d??0,-60,120), momentum=1+growth/100*.5, maturity=.6+Math.min(age??365,1095)/1095*.4, reach=Math.min(1.25,1+.05*Math.max(0,p.chains.length-1)); return {age,mult,momentum,maturity,reach,value:Math.max(1,Math.round(p.tvl_usd*mult*momentum*maturity*reach))};};
  const rows=selected.concat(early).map((p:any)=>{const s=score(p);return {...p,token_status:'pre-token',age_days:s.age,implied_value_usd:s.value,model_breakdown:{category_multiple:s.mult,momentum:s.momentum,maturity:s.maturity,reach:s.reach},farm_steps:farm(p)}}).sort((a:any,b:any)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug)).map((p:any,i:number)=>({...p,rank:i+1}));
  const radar=early.map((p:any)=>({...p,age_days:ageAt(p.listed_at,snapshot.as_of)}));
  const liveRows=live.slice().sort((a:any,b:any)=>b.mcap_usd-a.mcap_usd||a.slug.localeCompare(b.slug)).slice(0,24);
  return {rows,radar,live:liveRows,meta:{as_of:snapshot.as_of,source:snapshot.source,floor_usd:snapshot.floor_usd,watchlist_size:selected.length,early_size:early.length,board_size:rows.length,live_size:liveRows.length,model_version:MODEL_VERSION,model:MODEL}};
}
export function boardIssue(board:any, watchlist:string[]) {
  if(!Array.isArray(board)||board.some((r:any,i:number)=>r.rank!==i+1))return 'Ranks must be contiguous from 1';
  for(const slug of watchlist){if(!board.some((r:any)=>r.slug===slug&&r.token_status==='pre-token')) return 'Missing watchlist pre-token: '+slug;}
  for(let i=1;i<board.length;i++)if(board[i-1].implied_value_usd<board[i].implied_value_usd||(board[i-1].implied_value_usd===board[i].implied_value_usd&&board[i-1].slug.localeCompare(board[i].slug)>0))return 'Board order is invalid';
  return null;
}
export function dataScript(board:any[],radar:any[],live:any[],meta:any) { return 'window.RADAR_DATA = '+JSON.stringify({...meta,rows:board,radar,live})+';\nwindow.RADAR = window.RADAR_DATA;\n'; }
