#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, loadConfig } from './src/config.mjs';
import { persistEmbeddingReport } from './src/embedding-store.mjs';
import { planMemoryRecall } from './src/recall-planner.mjs';
import { createSemanticRecallProvider } from './src/semantic-retriever.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const reportFile = path.resolve(args['report-file'] || path.join(scriptDir, 'fixtures', 'sample-report.json'));
  const query = String(args.query || '05_dream recall path 뭐였지?').trim();
  const topK = Number.parseInt(String(args['top-k'] || 5), 10) || 5;

  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  const embeddingArchive = await persistEmbeddingReport(report, {
    ...config,
    embeddingStoreMode: args['embedding-store'] || 'file',
  }, {
    provider: args['embedding-provider'] || config.embeddingProvider || 'local',
    model: args['embedding-model'] || config.embeddingModel || 'stub-v1',
    store: args['embedding-store'] || 'file',
  });

  const recall = await planMemoryRecall({
    query,
    report,
    topK,
    knownProjects: config.knownProjects,
    semanticProvider: createSemanticRecallProvider({
      provider: args['semantic-provider'] || 'stub',
      model: args['semantic-model'] || 'stub-v1',
    }),
  });

  console.log(JSON.stringify({
    ok: true,
    reportFile,
    query,
    embeddingArchive,
    recall,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    stack: error?.stack || null,
  }, null, 2));
  process.exitCode = 1;
});
