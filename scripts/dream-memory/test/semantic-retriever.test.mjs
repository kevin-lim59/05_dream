import test from 'node:test';
import assert from 'node:assert/strict';

import { createSemanticRecallProvider, retrieveSemanticCandidates } from '../src/semantic-retriever.mjs';

function buildReport() {
  return {
    sessions: [{
      externalSessionId: 'session-1',
      summaryShort: '[high] embedding layer 구현',
      candidates: [{
        contentFingerprint: 'cand-1',
        kind: 'project_state',
        title: 'project_state: embedding layer 1차 구현',
        summary: '05_dream embedding persistence 초안 구현',
        primaryProject: { slug: '05_dream', label: '05_dream' },
        projectLinks: [{ slug: '05_dream', confidence: 0.97 }],
        decision: 'promote',
        importanceScore: 90,
        confidenceScore: 0.93,
        sourceMessageIds: ['m1'],
        reasonCodes: ['explicitMemorySignal'],
      }],
    }],
    promotions: [],
  };
}

test('stub semantic provider keeps recall refs stable for future vector swap', async () => {
  const result = await retrieveSemanticCandidates({
    query: 'embedding layer',
    report: buildReport(),
    rankedItems: [{ ref: 'candidate:cand-1', title: 'project_state: embedding layer 1차 구현' }],
    topK: 3,
    provider: createSemanticRecallProvider({ provider: 'stub', model: 'stub-v1' }),
  });

  assert.equal(result.status, 'stub');
  assert.equal(result.provider, 'stub');
  assert.equal(result.model, 'stub-v1');
  assert.deepEqual(result.candidates.map((item) => item.ref), ['candidate:cand-1']);
});

test('unknown semantic provider reports reserved-but-unimplemented state', async () => {
  const result = await retrieveSemanticCandidates({
    query: 'embedding layer',
    report: buildReport(),
    rankedItems: [],
    provider: createSemanticRecallProvider({ provider: 'pgvector', model: 'text-embedding-3-small' }),
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.backend, 'pgvector');
  assert.match(result.nextStep, /not implemented yet/i);
});
