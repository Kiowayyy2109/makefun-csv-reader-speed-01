// Driver: read every case from cases.json, answer each one with solve.js's
// run(), and write the answers in order. The harness mounts the case set at
// /input and expects answers.json under /output; MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR override those locations outside the container.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Match the house driver's GC posture before solve.js loads, so all parsing
// work runs with incremental marking off.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers = cases.map((c) => run(c.input));
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
