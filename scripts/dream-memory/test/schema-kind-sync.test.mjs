import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const EXPECTED_KINDS = [
  'project_state',
  'user_preference',
  'decision',
  'operation_rule',
  'fact',
  'relationship',
  'todo',
];

async function extractKindBlock(filePath) {
  const text = await readFile(filePath, 'utf8');
  const named = text.match(/dream_memory_candidates_kind_check[\s\S]*?kind\s+in\s*\(([^)]*)\)/i);
  if (named) return named[1];

  const inline = text.match(/create table if not exists public\.dream_memory_candidates[\s\S]*?kind\s+text\s+not null[\s\S]*?check\s*\([\s\S]*?kind\s+in\s*\(([^)]*)\)/i);
  assert.ok(inline, `kind check not found in ${filePath}`);
  return inline[1];
}

function parseKinds(block) {
  return Array.from(block.matchAll(/'([^']+)'/g)).map(([, kind]) => kind);
}

test('runtime candidate kinds stay aligned with primary Supabase schema', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const schemaFile = path.join(repoRoot, 'supabase', 'dream_memory.sql');
  const kinds = parseKinds(await extractKindBlock(schemaFile));

  assert.deepEqual(kinds, EXPECTED_KINDS);
});

test('v0 Supabase draft documents the same candidate kind set', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const docFile = path.join(repoRoot, 'docs', 'dream-memory-system-v0-supabase.sql');
  const kinds = parseKinds(await extractKindBlock(docFile));

  assert.deepEqual(kinds, EXPECTED_KINDS);
});
