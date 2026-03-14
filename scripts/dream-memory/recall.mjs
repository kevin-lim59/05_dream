#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseArgs, loadConfig } from './src/config.mjs';
import { planMemoryRecall } from './src/recall-planner.mjs';
import { buildSelectiveEmbeddingPayloads } from './src/embedding-payloads.mjs';
import { createSemanticRecallProvider } from './src/semantic-retriever.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args);
  const reportFile = path.resolve(args['report-file'] || path.join(config.workspaceRoot, 'tmp', 'dream-memory', `${config.date}.report.json`));
  const query = String(args.query || '').trim();
  const topK = Number.parseInt(String(args['top-k'] || 5), 10) || 5;
  const mode = String(args.mode || 'recall').trim().toLowerCase();
  const semanticProvider = createSemanticRecallProvider({
    provider: args['semantic-provider'] || args['embedding-provider'] || config.embeddingProvider || 'stub',
    model: args['semantic-model'] || args['embedding-model'] || config.embeddingModel || 'stub-v1',
  });

  if (!reportFile) {
    throw new Error('Missing --report-file');
  }

  const report = JSON.parse(await readFile(reportFile, 'utf8'));

  if (mode === 'embedding-preview') {
    const payloads = buildSelectiveEmbeddingPayloads(report);
    console.log(JSON.stringify({
      ok: true,
      mode,
      reportFile,
      count: payloads.length,
      payloads,
    }, null, 2));
    return;
  }

  if (!query) {
    throw new Error('Missing --query for recall mode');
  }

  const result = await planMemoryRecall({
    query,
    report,
    topK,
    knownProjects: config.knownProjects,
    semanticProvider,
  });

  console.log(JSON.stringify({
    ok: true,
    mode,
    reportFile,
    result,
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
