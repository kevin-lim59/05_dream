import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

import { persistEmbeddingReport } from '../src/embedding-store.mjs';

function buildReport() {
  return {
    targetDate: '2026-03-13',
    sessions: [{
      externalSessionId: 'session-1',
      targetDate: '2026-03-13',
      summaryShort: '[high] embedding MVP path',
      candidates: [{
        contentFingerprint: 'cand-1',
        kind: 'project_state',
        title: 'project_state: embedding persistence MVP path',
        summary: '05_dream nightly에서 selective embedding payload를 persistence path로 흘린다.',
        primaryProject: { slug: '05_dream', label: '05_dream' },
        projectLinks: [{ slug: '05_dream', confidence: 0.98, sources: ['text'] }],
        decision: 'promote',
        importanceScore: 90,
        confidenceScore: 0.94,
        sourceMessageIds: ['m1'],
        reasonCodes: ['explicitMemorySignal'],
      }],
    }],
    promotions: [],
  };
}

test('persistEmbeddingReport can snapshot local file store for MVP dry-run', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-embed-file-'));
  const outFile = path.join(tempDir, 'embeddings.json');

  const result = await persistEmbeddingReport(buildReport(), {
    workspaceRoot: tempDir,
    embeddingStoreMode: 'file',
    embeddingOutFile: outFile,
  }, {
    provider: 'local',
    model: 'stub-v1',
    store: 'file',
  });

  assert.equal(result.store, 'file');
  assert.equal(result.rowsReturned.embeddingDocuments, 1);
  assert.equal(result.rowsReturned.embeddings, 1);
  assert.equal(result.outFile, outFile);

  const saved = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(saved.store, 'file');
  assert.equal(saved.documents.length, 1);
  assert.equal(saved.embeddings.length, 1);
  assert.equal(saved.documents[0].source_key, 'cand-1');
  assert.equal(saved.embeddings[0].document_id, 'cand-1');
});
