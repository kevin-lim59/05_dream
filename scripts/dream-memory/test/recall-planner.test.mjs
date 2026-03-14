import test from 'node:test';
import assert from 'node:assert/strict';

import { planMemoryRecall } from '../src/recall-planner.mjs';
import { createSemanticRecallProvider } from '../src/semantic-retriever.mjs';

const knownProjects = [
  { slug: '05_dream', name: '05_dream', aliases: ['05_dream', '05-dream', 'dream'] },
  { slug: '03_supabase', name: '03_supabase', aliases: ['03_supabase', '03-supabase', 'supabase'] },
];

function buildReport() {
  return {
    sessions: [{
      externalSessionId: 'session-1',
      summaryShort: '[high] selective recall path 구현',
      candidates: [
        {
          contentFingerprint: 'cand-1',
          kind: 'project_state',
          title: 'project_state: selective recall path 구현',
          summary: 'Project state: 05_dream에 explainable recall path 추가',
          primaryProject: { slug: '05_dream', label: '05_dream' },
          projectLinks: [{ slug: '05_dream', confidence: 0.96 }],
          decision: 'promote',
          importanceScore: 80,
          confidenceScore: 0.95,
          sourceMessageIds: ['m1'],
          reasonCodes: ['explicitMemorySignal'],
        },
        {
          contentFingerprint: 'cand-2',
          kind: 'operation_rule',
          title: 'operation_rule: raw session 전체를 임베딩하지 말 것',
          summary: 'Operation rule: 후보/승격 메모만 selective embedding',
          primaryProject: null,
          projectLinks: [],
          decision: 'promote',
          importanceScore: 74,
          confidenceScore: 0.9,
          sourceMessageIds: ['m2'],
          reasonCodes: ['explicitMemorySignal'],
        },
      ],
    }],
    promotions: [{
      externalSessionId: 'session-1',
      entrySlug: '05-dream-operation-rule-selective-embedding',
      targetFile: '/memory/projects/05_dream.md',
      targetSection: '## Important Decisions',
      promotionMode: 'append',
      kind: 'operation_rule',
      title: 'operation_rule: raw session 전체를 임베딩하지 말 것',
      contentMarkdown: '### operation_rule\n- selective embedding only for candidates/promotions',
    }],
  };
}

test('prefers project-matched promoted memory and returns audit reasons', async () => {
  const result = await planMemoryRecall({
    query: '05_dream에서 selective recall path 어떻게 설계했지?',
    report: buildReport(),
    topK: 3,
    knownProjects,
  });

  assert.equal(result.items[0].sourceType, 'promotion');
  assert.equal(result.items[0].project, '05_dream');
  assert.ok(result.items[0].why.some((reason) => reason.startsWith('project_match:05_dream')));
  assert.ok(result.items[0].why.includes('promoted_memory_boost'));
  assert.equal(result.items[0].audit.targetSection, '## Important Decisions');
});

test('keeps non-project stable rules recallable when query is generic', async () => {
  const result = await planMemoryRecall({
    query: 'raw session 임베딩 정책이 뭐였지?',
    report: buildReport(),
    topK: 3,
    knownProjects,
  });

  assert.ok(result.items.some((item) => item.title.includes('raw session 전체를 임베딩하지 말 것')));
  assert.ok(result.trace.scoring.includes('audit trail preserved'));
});

test('returns semantic stub candidates aligned to explainable recall refs', async () => {
  const result = await planMemoryRecall({
    query: '05_dream selective recall path',
    report: buildReport(),
    topK: 2,
    knownProjects,
    semanticProvider: createSemanticRecallProvider({ provider: 'stub', model: 'stub-v1' }),
  });

  assert.equal(result.semantic.status, 'stub');
  assert.ok(result.semantic.readySourceCount >= 2);
  assert.ok(result.semantic.candidates.every((item) => item.sourceKey.includes(':')));
  assert.ok(result.trace.steps.includes('semantic_slot_reserved'));
  assert.deepEqual(result.vectorStub, result.semantic);
});
