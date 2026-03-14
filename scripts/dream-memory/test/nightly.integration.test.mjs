import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function buildSessionJsonl() {
  const rows = [
    {
      type: 'session',
      id: 'nightly-embed-session',
      timestamp: '2026-03-13T00:00:00.000Z',
      cwd: '/Users/bini/.openclaw/workspace/05_dream',
    },
    {
      type: 'message',
      id: 'm1',
      timestamp: '2026-03-13T01:00:00.000Z',
      message: {
        role: 'user',
        content: [{ text: '05_dream 프로젝트에서 앞으로 nightly runner는 embeddings persistence를 반드시 남기고, 응답은 한국어로 유지해줘.' }],
      },
    },
    {
      type: 'message',
      id: 'm2',
      timestamp: '2026-03-13T01:05:00.000Z',
      message: {
        role: 'assistant',
        content: [{ text: '좋아요. project_state와 user_preference 후보로 정리하고 embedding payload도 준비할게요.' }],
      },
    },
  ];

  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

test('nightly runner persists embedding snapshot when --embeddings=true --embedding-store=file', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dream-memory-nightly-'));
  const sessionsDir = path.join(tempDir, 'sessions');
  const outputFile = path.join(tempDir, 'nightly.embeddings.json');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(path.join(sessionsDir, 'nightly-embed-session.jsonl'), buildSessionJsonl(), 'utf8');

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'dream-memory', 'nightly.mjs');

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    '--date', '2026-03-13',
    '--sessions-dir', sessionsDir,
    '--memory-root', tempDir,
    '--dry-run=false',
    '--embeddings=true',
    '--embedding-store=file',
    '--embedding-out-file', outputFile,
  ], {
    cwd: repoRoot,
  });

  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.embeddingsPersisted, true);
  assert.equal(result.embeddingArchive?.store, 'file');
  assert.equal(result.embeddingArchive?.outFile, outputFile);
  assert.ok((result.counts?.embeddingPayloadsPlanned || 0) >= 1);

  const saved = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.equal(saved.store, 'file');
  assert.ok(saved.documents.length >= 1);
  assert.ok(saved.embeddings.length >= 1);
});
