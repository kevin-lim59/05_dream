import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureMemoryBootstrap } from '../src/memory-bootstrap.mjs';
import { applyPromotions, resolvePromotionTarget } from '../src/promotion-writer.mjs';

function buildSession(overrides = {}) {
  return {
    externalSessionId: 'session-1',
    lastMessageAt: '2026-03-13T08:00:00.000Z',
    startedAt: '2026-03-13T07:30:00.000Z',
    candidates: [],
    ...overrides,
  };
}

function buildCandidate(overrides = {}) {
  return {
    kind: 'project_state',
    title: 'project_state: promotion path 연결',
    summary: 'Project state: promotion path 연결 완료',
    confidenceScore: 0.92,
    importanceScore: 84,
    decision: 'promote',
    reasonCodes: ['explicitMemorySignal'],
    sourceMessageIds: ['m1'],
    contentFingerprint: 'cand-1',
    primaryProject: { slug: '05_dream', label: '05_dream' },
    ...overrides,
  };
}

test('memory bootstrap creates MEMORY.md baseline', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-bootstrap-'));
  await ensureMemoryBootstrap(memoryRoot, { dryRun: false });
  const content = await readFile(path.join(memoryRoot, 'MEMORY.md'), 'utf8');
  assert.match(content, /## Active Projects/);
  assert.match(content, /## Stable Preferences/);
});

test('project promotion writes project-scoped markdown and stays idempotent on rerun', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-project-'));
  await ensureMemoryBootstrap(memoryRoot, { dryRun: false });

  const candidate = buildCandidate();
  const session = buildSession({ candidates: [candidate] });
  const config = { memoryRoot, writePromotions: true };

  const first = await applyPromotions({ sessions: [session] }, config);
  assert.equal(first.length, 1);
  assert.equal(first[0].promotionMode, 'append');
  assert.equal(first[0].writeApplied, true);

  const target = resolvePromotionTarget(candidate, memoryRoot);
  const firstContent = await readFile(target.targetFile, 'utf8');
  assert.match(firstContent, /# 05_dream/);
  assert.match(firstContent, /## Snapshot/);
  assert.match(firstContent, /dream-memory:entry 05-dream-project-state-promotion-path-연결/);

  const second = await applyPromotions({ sessions: [session] }, config);
  assert.equal(second[0].writeApplied, false);

  const secondContent = await readFile(target.targetFile, 'utf8');
  assert.equal(secondContent, firstContent);
  assert.equal((secondContent.match(/dream-memory:entry/g) || []).length, 2);
});

test('updated candidate replaces existing entry instead of appending duplicate', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-replace-'));
  await ensureMemoryBootstrap(memoryRoot, { dryRun: false });

  const baseCandidate = buildCandidate();
  const updatedCandidate = buildCandidate({ summary: 'Project state: promotion path merge/replace 보강' });
  const config = { memoryRoot, writePromotions: true };

  await applyPromotions({ sessions: [buildSession({ candidates: [baseCandidate] })] }, config);
  const result = await applyPromotions({ sessions: [buildSession({ candidates: [updatedCandidate] })] }, config);
  assert.equal(result[0].promotionMode, 'replace');
  assert.equal(result[0].writeApplied, true);

  const target = resolvePromotionTarget(updatedCandidate, memoryRoot);
  const content = await readFile(target.targetFile, 'utf8');
  assert.match(content, /merge\/replace 보강/);
  assert.equal((content.match(/### project_state: promotion path 연결/g) || []).length, 1);
});

test('user preference promotion routes into MEMORY.md stable preferences section', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-memorymd-'));
  await ensureMemoryBootstrap(memoryRoot, { dryRun: false });

  const candidate = buildCandidate({
    kind: 'user_preference',
    title: 'user_preference: 사용자는 한국어 응답을 선호한다',
    summary: 'User preference: 사용자는 한국어 응답을 선호한다',
    primaryProject: null,
  });

  const session = buildSession({ candidates: [candidate] });
  await applyPromotions({ sessions: [session] }, { memoryRoot, writePromotions: true });

  const content = await readFile(path.join(memoryRoot, 'MEMORY.md'), 'utf8');
  assert.match(content, /## Stable Preferences/);
  assert.match(content, /사용자는 한국어 응답을 선호한다/);
});
