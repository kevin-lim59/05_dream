import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILES = {
  'MEMORY.md': `# MEMORY

## Active Projects

## Stable Preferences

## Current Priorities

## Operational Rules

## Recent Promoted Memories
`,
  'memory/README.md': `# Dream Memory

이 폴더는 Dream Memory System이 장기 기억을 정리하는 공간입니다.

## Rules
- raw transcript 전체를 여기에 복붙하지 않는다.
- 중요한 사실/선호/결정만 승격한다.
- 각 항목에는 가능한 한 Sources와 Last updated를 남긴다.
- 확신이 낮으면 memory/inbox.md로 보낸다.
- 같은 entry slug가 이미 있으면 append 대신 해당 블록을 replace/update 한다.
`,
  'memory/inbox.md': `# Dream Memory Inbox

자동 승격하기 애매한 후보를 임시로 쌓는 곳입니다.

## Pending review
`,
  'memory/projects/README.md': '# Project memories\n',
  'memory/preferences/README.md': '# Preference memories\n',
  'memory/people/README.md': '# People memories\n',
  'memory/operations/README.md': '# Operations memories\n',
  'memory/decisions/README.md': '# Decision memories\n',
};

export async function ensureMemoryBootstrap(memoryRoot, { dryRun = true } = {}) {
  const directories = [
    'memory',
    'memory/projects',
    'memory/preferences',
    'memory/people',
    'memory/operations',
    'memory/decisions',
    'tmp/dream-memory',
  ];

  if (dryRun) return;

  for (const dir of directories) {
    await mkdir(path.join(memoryRoot, dir), { recursive: true });
  }

  for (const [relativePath, content] of Object.entries(FILES)) {
    const absolutePath = path.join(memoryRoot, relativePath);
    const exists = await pathExists(absolutePath);
    if (!exists) {
      await writeFile(absolutePath, content, 'utf8');
    }
  }
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
