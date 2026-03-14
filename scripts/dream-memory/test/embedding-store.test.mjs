import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmbeddingDocumentRows, buildEmbeddingRows, buildPayloadFingerprint } from '../src/embedding-store.mjs';

function buildPayload(overrides = {}) {
  return {
    objectType: 'candidate',
    objectId: 'cand-1',
    project: '05_dream',
    decision: 'promote',
    text: 'Project: 05_dream\nSelective embedding persistence path',
    source: {
      externalSessionId: 'session-1',
      candidateKind: 'project_state',
      candidateTitle: 'project_state: embedding layer 1차 구현',
    },
    metadata: {
      importanceScore: 88,
    },
    audit: {
      selectedBecause: ['candidate_memory_unit', 'project_linked'],
    },
    ...overrides,
  };
}

test('buildEmbeddingDocumentRows is idempotent by source key and content hash', () => {
  const rowsA = buildEmbeddingDocumentRows([buildPayload()], { provider: 'local', model: 'stub-v1', targetDate: '2026-03-13' });
  const rowsB = buildEmbeddingDocumentRows([buildPayload()], { provider: 'local', model: 'stub-v1', targetDate: '2026-03-13' });

  assert.equal(rowsA[0].source_type, 'candidate');
  assert.equal(rowsA[0].source_key, 'cand-1');
  assert.equal(rowsA[0].content_hash, rowsB[0].content_hash);
  assert.equal(rowsA[0].payload_fingerprint, rowsB[0].payload_fingerprint);
  assert.equal(rowsA[0].source_ref_json.externalSessionId, 'session-1');
  assert.equal(rowsA[0].status, 'prepared');
});

test('buildEmbeddingRows creates replayable pending rows for candidate and promotion sources', () => {
  const documentIdBySource = new Map([
    ['candidate:cand-1', 'doc-candidate'],
    ['promotion:entry-1', 'doc-promotion'],
  ]);

  const rows = buildEmbeddingRows([
    buildPayload(),
    buildPayload({ objectType: 'promotion', objectId: 'entry-1', source: { externalSessionId: 'session-1', targetFile: 'MEMORY.md' } }),
  ], { provider: 'local', model: 'stub-v1', documentIdBySource });

  assert.deepEqual(rows.map((row) => `${row.source_type}:${row.source_key}`), ['candidate:cand-1', 'promotion:entry-1']);
  assert.deepEqual(rows.map((row) => row.document_id), ['doc-candidate', 'doc-promotion']);
  assert.ok(rows.every((row) => row.status === 'pending'));
  assert.ok(rows.every((row) => row.vector_json === null));
  assert.ok(rows.every((row) => row.payload_fingerprint));
});

test('buildPayloadFingerprint changes when embed-worthy payload text changes', () => {
  const base = buildPayloadFingerprint(buildPayload());
  const changed = buildPayloadFingerprint(buildPayload({ text: 'Project: 05_dream\nSelective embedding persistence path v2' }));

  assert.notEqual(base, changed);
});
