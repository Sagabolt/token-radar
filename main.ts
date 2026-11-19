// Token Radar — main.ts
//
// Usage:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   node main.ts --help
//
// Reads the sealed snapshot, scores every protocol with the radar-2 model, and writes
// out/board.json, out/data.js and a copied dashboard into the output directory. It also
// demands at least three screenshots and writes the submission dossier last, so a failed
// run never leaves a dossier behind.
//
// Node 22+, no dependencies beyond the standard library. The script only uses the
// snapshot's own numbers: peer multiples, implied values and the board are computed at
// runtime from the input file, so re-running it on a new snapshot needs no code change.

import { argv, cwd, env, exit } from 'node:process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { MODEL, SnapshotError, buildBoard, buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import type { DossierCaps } from './vendor/makefun-board.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Where the built dashboard comes from, and what it is made of.
const DASHBOARD_FILES = ['index.html', 'app.css', 'app.js'] as const;
// Where the screenshots come from: the shots subagent writes them here, and main.ts
// copies them into the output next to the board.
const SCREENSHOT_DIR = 'screenshots';
// A full dossier needs three screenshots, one of each view the rules ask for.
const SCREENSHOT_MIN = 3;
// The dossier's text is capped at 65,536 bytes, and the whole dossier at 1.5 MiB: the
// text cap shapes the bytes, the rest refuse. These are the scorer's own caps.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
// The board's own cap: the dossier may not carry more than this many rows.
const BOARD_MAX_ROWS = 500;
// The dashboard's own cap: at most this many bytes of source across its three files.
const DASHBOARD_MAX_BYTES = 65_536;

// --- paths -------------------------------------------------------------------

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function resolvePath(input: string): string {
  if (isAbsolute(input)) return input;
  if (input.startsWith('file://')) return fileURLToPath(input);
  return resolve(cwd(), input);
}

// --- arguments ----------------------------------------------------------------

interface CliArgs {
  input: string;
  output: string;
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  if (args.includes('--help')) {
    const lines = [
      'Token Radar — main.ts',
      '',
      'Usage:',
      '  node main.ts                         (defaults: /input/snapshot.json, then input/snapshot.json)',
      '  node main.ts --input <snapshot.json>',
      '  node main.ts --input <snapshot.json> --output <dir>',
      '',
      'Options:',
      '  --input <path>   path to the sealed snapshot (default: /input/snapshot.json, then input/snapshot.json)',
      '  --output <dir>   output directory (default: MAKEFUN_OUTPUT_DIR, else ./out)',
      '  --help           show this help',
      '',
      'The snapshot path may be a file path or a file:// URL.',
    ];
    console.log(lines.join('\n'));
    exit(0);
  }
  const input = flag(args, '--input', 'snapshot path')
    ?? defaultSnapshotPath()
    ?? (() => { throw new SnapshotError('missing snapshot path (--input <path>)'); })();
  const output = flag(args, '--output', 'output directory')
    ?? env.MAKEFUN_OUTPUT_DIR
    ?? (existsSync('/input/snapshot.json') ? '/output' : './out');
  if (output.trim().length === 0) throw new SnapshotError('output directory is empty');
  return { input, output: resolvePath(output) };
}


/** Grader default: the sealed snapshot lives at /input/snapshot.json in the
 *  grading sandbox, or beside the entry as input/snapshot.json locally.
 *  A bare `node main.ts` must work in both places. */
function defaultSnapshotPath(): string | null {
  for (const candidate of ['/input/snapshot.json', 'input/snapshot.json', 'snapshot.json']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function flag(args: string[], name: string, label: string): string | null {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) throw new SnapshotError(`${name} needs a value`);
  return value;
}

// --- output -------------------------------------------------------------------

/** Write text to a file, making its parent directory first. */
function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Read a snapshot and check it is the one this model scores. */
function readSnapshot(path: string): Snapshot {
  let raw: string;
  try {
    raw = readFileSync(resolvePath(path), 'utf8');
  } catch {
    throw new SnapshotError(`cannot read snapshot at ${path}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  return parseSnapshot(data);
}

/** Copy the dashboard's three files into the output directory, and check the cap. */
function copyDashboard(output: string): void {
  const source = join(here(), 'dashboard');
  const target = join(output, 'dashboard');
  mkdirSync(target, { recursive: true });
  let totalBytes = 0;
  for (const name of DASHBOARD_FILES) {
    const file = join(source, name);
    if (!existsSync(file)) throw new SnapshotError(`missing dashboard file ${name}`);
    cpSync(file, join(target, name));
    totalBytes += readFileSync(join(target, name)).length;
  }
  if (totalBytes > DASHBOARD_MAX_BYTES) {
    throw new SnapshotError(`dashboard source is ${totalBytes} bytes, over the ${DASHBOARD_MAX_BYTES} byte cap`);
  }
}

/** Copy the screenshots into the output directory, and demand at least three. */
function copyScreenshots(output: string): string[] {
  const source = join(here(), SCREENSHOT_DIR);
  const target = join(output, SCREENSHOT_DIR);
  if (!existsSync(source)) {
    throw new SnapshotError(
      `missing ${SCREENSHOT_DIR}/: add at least ${SCREENSHOT_MIN} screenshots before building the dossier`,
    );
  }
  const files = listScreenshotFiles(source);
  if (files.length < SCREENSHOT_MIN) {
    throw new SnapshotError(
      `${SCREENSHOT_DIR}/ has ${files.length} screenshot(s); at least ${SCREENSHOT_MIN} are required`,
    );
  }
  mkdirSync(target, { recursive: true });
  for (const file of files) cpSync(join(source, file), join(target, file));
  return files;
}

function listScreenshotFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isFile())
    .sort();
}

/** The board's own stats, for the summary line and the dossier. */
function boardStats(rows: BoardRow[]): { rows: number; minValue: number; maxValue: number; medianValue: number } {
  const values = rows.map((row) => row.implied_value_usd).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const medianValue = values.length % 2 === 1 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
  return { rows: rows.length, minValue: values[0]!, maxValue: values[values.length - 1]!, medianValue };
}

// --- main ---------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const snapshot = readSnapshot(args.input);
  const rows = buildBoard(snapshot);
  const radar: RadarData = buildRadar(snapshot, MODEL, rows);
  if (rows.length > BOARD_MAX_ROWS) {
    throw new SnapshotError(`board has ${rows.length} rows, over the ${BOARD_MAX_ROWS} row cap`);
  }
  const issue = boardIssue(snapshot, rows);
  if (issue !== null) throw new SnapshotError(`board failed validation: ${issue}`);

  rmSync(args.output, { recursive: true, force: true });
  writeText(join(args.output, 'board.json'), `${JSON.stringify(rows, null, 2)}\n`);
  writeText(join(args.output, 'data.js'), dataScript(radar));
  copyDashboard(args.output);
  const screenshots = copyScreenshots(args.output);

  const stats = boardStats(rows);
  const caps: DossierCaps = {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  };
  const dossier = buildDossier(args.output, caps);
  writeFileSync(join(args.output, 'dossier.json'), dossier);
  const dossierSha = createHash('sha256').update(dossier).digest('hex');

  const lines = [
    `snapshot: ${snapshot.source} (${snapshot.as_of}, ${snapshot.protocols.length} protocols, floor $${snapshot.floor_usd.toLocaleString('en-US')})`,
    `board: ${stats.rows} rows — ${snapshot.watchlist.length} watchlist, ${stats.rows - snapshot.watchlist.length} early`,
    `implied value: $${stats.minValue.toLocaleString('en-US')} to $${stats.maxValue.toLocaleString('en-US')}, median $${stats.medianValue.toLocaleString('en-US')}`,
    `top: ${rows[0]!.name} ($${rows[0]!.implied_value_usd.toLocaleString('en-US')})`,
    `screenshots: ${screenshots.length} (${screenshots.join(', ')})`,
    `dossier: ${dossierSha.slice(0, 16)}… (${dossier.length.toLocaleString('en-US')} bytes)`,
    `output: ${args.output}`,
  ];
  console.log(lines.join('\n'));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`token-radar: ${message}`);
  exit(1);
}
