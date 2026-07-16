// Compiles n8n/workflows/src/*.workflow.mjs into importable JSON in n8n/dist/.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = resolve('n8n/workflows/src');
const DIST = resolve('n8n/dist');
mkdirSync(DIST, { recursive: true });

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.workflow.mjs'))) {
  const mod = await import(pathToFileURL(join(SRC, file)).href);
  const wf = mod.default;
  writeFileSync(join(DIST, `${wf.id}.json`), JSON.stringify(wf, null, 2));
  console.log('built', wf.id);
}
