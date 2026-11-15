import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSnapshot, build, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function args(argv:string[]) { let input='/input', output=process.env.MAKEFUN_OUTPUT_DIR||'/output'; for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--input'&&argv[i+1])input=argv[++i];else if(a.startsWith('--input='))input=a.slice(8);else if(a==='--output'&&argv[i+1])output=argv[++i];else if(a.startsWith('--output='))output=a.slice(9);} return {input,output}; }
function fail(message:string,code:number):never { console.error(message); process.exit(code); }
function copyTree(src:string,dst:string) { mkdirSync(dst,{recursive:true}); for(const name of readdirSync(src)){if(name.startsWith('.'))continue;const from=join(src,name),to=join(dst,name),st=statSync(from);if(st.isDirectory())copyTree(from,to);else if(st.isFile())copyFileSync(from,to);} }
function main(){
  const {input,output}=args(process.argv.slice(2)); let source=resolve(input);
  if(!existsSync(source))fail(`snapshot missing: ${source}`,2);
  if(statSync(source).isDirectory())source=join(source,'snapshot.json');
  if(!existsSync(source))fail(`snapshot missing: ${source}`,2);
  let snapshot:any; try{snapshot=parseSnapshot(readFileSync(source,'utf8'));}catch(e){fail(`invalid snapshot: ${e instanceof Error?e.message:String(e)}`,1);}
  const result=build(snapshot); const issue=boardIssue(result.rows,snapshot);if(issue)fail(`board validation failed: ${issue}`,1);
  const out=resolve(output);mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'board.json'),JSON.stringify({rows:result.rows})+'\n');
  writeFileSync(join(out,'data.js'),dataScript(result.radar));
  const dash=resolve('dashboard');if(!existsSync(dash)||!statSync(dash).isDirectory())fail('dashboard directory missing',1);copyTree(dash,join(out,'dashboard'));
  const shots=resolve('screenshots');if(!existsSync(shots)||!statSync(shots).isDirectory())fail('screenshots directory missing',1);
  const screenshotNames=readdirSync(shots).filter((n:string)=>!n.startsWith('.')&&statSync(join(shots,n)).isFile());
  if(screenshotNames.length<3)fail('fewer than 3 screenshots',1);
  for(const n of screenshotNames)if(!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n))fail(`invalid screenshot name: ${n}`,1);
  copyTree(shots,join(out,'screenshots'));
  try{const dossier=buildDossier(out,{text_max_bytes:65536,screenshots:{max:4,max_bytes:524288},dashboard:{max_files:400,max_bytes:4194304}});writeFileSync(join(out,'dossier.json'),dossier);}catch(e){fail(`dossier failed: ${e instanceof Error?e.message:String(e)}`,1);}
  console.log(`Token Radar: ${result.rows.length} rows, ${result.radar.early_size} early, ${result.radar.live_size} live`);
  console.log(`Wrote ${out}`);
}
main();
