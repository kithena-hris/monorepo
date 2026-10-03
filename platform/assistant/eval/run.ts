import { writeFileSync } from 'node:fs';

import { chatModel, gatedPlanner, modelConfigFrom } from '../src/infrastructure/planner.js';
import { accuracy, CASES, hashOf, prepare, TENANT, unsafe, type Recording } from './cases.js';

/**
 * `just assistant-eval` (assistant PRD §13.2).
 *
 *   ASSISTANT_EVAL_LIVE=1 just assistant-eval            ask the real model, print the score
 *   ASSISTANT_EVAL_LIVE=1 just assistant-eval --record   …and write recorded.json
 *   just assistant-eval --stub                           record the expected plans, no model
 *
 * A live run needs `ASSISTANT_API_KEY` (and `ASSISTANT_BASE_URL`,
 * `ASSISTANT_MODEL` as the service reads them) and spends real requests, so
 * it also needs `ASSISTANT_EVAL_LIVE=1`: nothing calls a model by accident.
 * `--stub` writes the expected plans as the recording, under the model id
 * `stub`, so a prompt change can be re-hashed without a key; the reviewer
 * sees that it measured nothing.
 */

const args = new Set(process.argv.slice(2));
const stub = args.has('--stub');
const record = stub || args.has('--record');

const config = stub ? null : modelConfigFrom(process.env);
if (!stub && (process.env['ASSISTANT_EVAL_LIVE'] !== '1' || config === null)) {
  process.stderr.write(
    'A live run calls the model: set ASSISTANT_EVAL_LIVE=1 and ASSISTANT_API_KEY, or pass --stub.\n',
  );
  process.exit(2);
}
const planner = config === null ? null : gatedPlanner(chatModel(config, { timeoutMs: 30_000 }));

const outputs: Record<string, string> = {};
const problems: string[] = [];
for (const c of CASES) {
  const prepared = prepare(c);
  if (prepared.kind !== 'prompt' || !('plan' in c.expect)) continue;
  let text: string;
  if (planner === null) {
    text = JSON.stringify(c.expect.plan);
  } else {
    // oxlint-disable-next-line no-await-in-loop -- one question at a time, within a provider's rate limit
    const planned = await planner.plan(TENANT, prepared.request);
    text = planned.ok ? planned.text : `{"refused":"${planned.code}"}`;
  }
  outputs[c.id] = text;
  for (const rule of unsafe(c, prepared.request, text)) problems.push(`${c.id}: ${rule}`);
}

const score = accuracy(outputs);
process.stdout.write(
  `${String(score.exact)}/${String(score.of)} exact (${((100 * score.exact) / score.of).toFixed(0)} %)\n`,
);
for (const id of score.missed) process.stdout.write(`  missed ${id}: ${outputs[id] ?? '(none)'}\n`);
for (const p of problems) process.stdout.write(`  UNSAFE ${p}\n`);

if (record) {
  const recording: Recording = {
    model: config === null ? 'stub' : config.model,
    hash: hashOf(CASES),
    outputs,
  };
  writeFileSync(
    new URL('recorded.json', import.meta.url),
    `${JSON.stringify(recording, null, 2)}\n`,
  );
  process.stdout.write('wrote eval/recorded.json\n');
}
