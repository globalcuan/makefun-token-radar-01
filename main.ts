import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSnapshot, build, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function parseArguments(argv: string[]) {
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR || '/output';

  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--input' && argv[index + 1]) input = argv[++index];
    else if (argv[index] === '--output' && argv[index + 1]) output = argv[++index];
  }

  return { input, output };
}

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function loadSnapshot(input: string) {
  let source = resolve(input);
  if (!existsSync(source)) fail(`snapshot missing: ${source}`, 2);
  if (statSync(source).isDirectory()) source = join(source, 'snapshot.json');
  if (!existsSync(source)) fail(`snapshot missing: ${source}`, 2);

  try {
    return parseSnapshot(JSON.parse(readFileSync(source, 'utf8')));
  } catch (error) {
    fail(`invalid snapshot: ${String(error)}`, 1);
  }
}

function getWatchlistPreTokens(snapshot: any) {
  return snapshot.watchlist.filter((slug: string) =>
    snapshot.protocols.some((protocol: any) =>
      protocol.slug === slug &&
      protocol.mcap_usd === null &&
      protocol.gecko_id === null &&
      protocol.symbol === null));
}

function validateBoard(rows: any[], snapshot: any) {
  const issue = boardIssue(rows, getWatchlistPreTokens(snapshot));
  if (issue) fail(`board validation failed: ${issue}`, 1);
}

function copyAssets(output: string) {
  const dashboardSource = resolve('dashboard');
  if (!existsSync(dashboardSource)) fail('dashboard directory missing', 1);
  cpSync(dashboardSource, join(output, 'dashboard'), { recursive: true });

  const screenshotsSource = resolve('screenshots');
  const screenshotsOutput = join(output, 'screenshots');
  if (existsSync(screenshotsSource)) cpSync(screenshotsSource, screenshotsOutput, { recursive: true });
  else mkdirSync(screenshotsOutput, { recursive: true });
  return screenshotsOutput;
}

function validateScreenshots(directory: string) {
  const screenshots = readdirSync(directory).filter((name: string) =>
    statSync(join(directory, name)).isFile() && !name.startsWith('.'));
  if (screenshots.length > 4) fail('screenshot cap exceeded: maximum 4 files', 1);

  for (const name of screenshots) {
    if (statSync(join(directory, name)).size > 524288) {
      fail(`screenshot cap exceeded: ${name}`, 1);
    }
  }
}

function writeDossier(output: string) {
  try {
    writeFileSync(join(output, 'dossier.json'), buildDossier(output, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 }
    }));
  } catch (error) {
    fail(`dossier failed: ${String(error)}`, 1);
  }
}

function writeOutputs(output: string, result: any) {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), JSON.stringify(result.rows, null, 2) + '\n');
  writeFileSync(join(output, 'data.js'), dataScript(result.rows, result.radar, result.live, result.meta));

  const screenshotsDirectory = copyAssets(output);
  validateScreenshots(screenshotsDirectory);
  writeDossier(output);
}

function main() {
  const { input, output } = parseArguments(process.argv.slice(2));
  const snapshot = loadSnapshot(input);
  const result = build(snapshot);

  validateBoard(result.rows, snapshot);
  writeOutputs(output, result);
  console.log(`Token Radar: ${result.rows.length} rows, ${result.radar.length} early, ${result.live.length} live; output ${resolve(output)}`);
}

main();
