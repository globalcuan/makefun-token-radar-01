import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSnapshot, build, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function args(argv:string[]) { let input='/input', output=process.env.MAKEFUN_OUTPUT_DIR || '/output'; for(let i=0;i<argv.length;i++){if(argv[i]==='--input'&&argv[i+1])input=argv[++i];else if(argv[i]==='--output'&&argv[i+1])output=argv[++i];} return {input,output}; }
function fail(message:string, code:number): never { console.error(message); process.exit(code); }
const {input,output}=args(process.argv.slice(2));
let source=resolve(input);
if (!existsSync(source)) fail(`snapshot missing: ${source}`,2);
if (statSync(source).isDirectory()) source=join(source,'snapshot.json');
if (!existsSync(source)) fail(`snapshot missing: ${source}`,2);
let snapshot:any;
try { snapshot=parseSnapshot(JSON.parse(readFileSync(source,'utf8'))); } catch(e) { fail(`invalid snapshot: ${String(e)}`,1); }
const result=build(snapshot);
const issue=boardIssue(result.rows,snapshot.watchlist.filter((slug:string)=>snapshot.protocols.some((p:any)=>p.slug===slug&&p.mcap_usd===null&&p.gecko_id===null&&p.symbol===null)));
if(issue) fail(`board validation failed: ${issue}`,1);
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'board.json'),JSON.stringify(result.rows,null,2)+'\n');
writeFileSync(join(output,'data.js'),dataScript(result.rows,result.radar,result.live,result.meta));
const dashSource=resolve('dashboard'); if(!existsSync(dashSource)) fail('dashboard directory missing',1);
cpSync(dashSource,join(output,'dashboard'),{recursive:true});
const shotSource=resolve('screenshots'); if(existsSync(shotSource)) cpSync(shotSource,join(output,'screenshots'),{recursive:true}); else mkdirSync(join(output,'screenshots'),{recursive:true});
const shots=readdirSync(join(output,'screenshots')).filter((n:string)=>statSync(join(output,'screenshots',n)).isFile()&&!n.startsWith('.'));
if(shots.length>4) fail('screenshot cap exceeded: maximum 4 files',1);
for(const n of shots) if(statSync(join(output,'screenshots',n)).size>524288) fail(`screenshot cap exceeded: ${n}`,1);
try { writeFileSync(join(output,'dossier.json'),buildDossier(output,{text_max_bytes:65536,screenshots:{max:4,max_bytes:524288}})); } catch(e) { fail(`dossier failed: ${String(e)}`,1); }
console.log(`Token Radar: ${result.rows.length} rows, ${result.radar.length} early, ${result.live.length} live; output ${resolve(output)}`);
