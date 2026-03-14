import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSelectiveEmbeddingPayloads, shouldEmbedCandidate } from '../src/embedding-payloads.mjs';

function buildCandidate(overrides = {}) {
  return {
    kind: 'project_state',
    title: 'project_state: selective recall path 설계',
    summary: 'Project state: selective recall path 설계 중',
    decision: 'promote',
    confidenceScore: 0.92,
    importanceScore: 83,
    reasonCodes: ['explicitMemorySignal'],
    sourceMessageIds: ['m1'],
    projectLinks: [{ slug: '05_dream', confidence: 0.96, sources: ['cwd'] }],
    contentFingerprint: 'cand-1',
    primaryProject: { slug: '05_dream', label: '05_dream' },
    ...overrides,
  };
}

test('embeds only selective candidate kinds and promoted entries', () => {
  const report = {
    sessions: [{
      externalSessionId: 'session-1',
      targetDate: '2026-03-13',
      summaryShort: '[high] recall path',
      candidates: [
        buildCandidate(),
        buildCandidate({ contentFingerprint: 'cand-2', kind: 'fact', decision: 'archive_only' }),
      ],
    }],
    promotions: [{
      externalSessionId: 'session-1',
      entrySlug: '05-dream-project-state-selective-recall',
      targetFile: '/tmp/memory/projects/05_dream.md',
      targetSection: '## Snapshot',
      promotionMode: 'append',
      kind: 'project_state',
      title: 'project_state: selective recall path 설계',
      contentMarkdown: '### project_state: selective recall path 설계\n- Summary: explainable recall',
    }],
  };

  const payloads = buildSelectiveEmbeddingPayloads(report);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads.map((item) => item.objectType), ['candidate', 'promotion']);
  assert.ok(payloads[0].audit.selectedBecause.includes('project_linked'));
  assert.equal(payloads[1].project, '05_dream');
});

test('rejects archive-only fact candidates from embedding set', () => {
  const candidate = buildCandidate({ kind: 'fact', decision: 'archive_only' });
  assert.equal(shouldEmbedCandidate(candidate), false);
});
