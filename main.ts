// Dustline Yard — the handoff program for the threejs-fps-02 entry.
//
// The game itself is plain static files under game/ (three.js from an import map,
// ES modules, no build step). This program is what hands it in: it copies game/
// and screenshots/ from beside this file into the output directory and writes
// output/dossier.json, the summary the judge reads, using the vendored make.fun
// library. The grader runs it inside its own container, where the output
// directory is /output; anywhere else, MAKEFUN_OUTPUT_DIR stands in for it.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the game locally while developing with `node serve.ts`, then open
// http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, from the competition gate: the dossier text the judge
// reads is capped at 163,840 bytes; at most 4 screenshots, each at most 256 KiB;
// game/ holds at most 993 files and 48 MiB in all. game/, screenshots/ and
// dossier.json share the platform's own 1,000-entry / 64 MiB output cap, so
// these limits refuse an entry the scorer would refuse.
const dossierOptions = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function copyIntoOutput() {
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  const shotsDir = join(repoRoot, 'screenshots');
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
  }
}

copyIntoOutput();
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, dossierOptions));
