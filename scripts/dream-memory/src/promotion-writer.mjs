import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function applyPromotions(report, config) {
  const promotions = [];

  for (const session of report.sessions) {
    for (const candidate of session.candidates || []) {
      if (candidate.decision !== 'promote') continue;

      const target = resolvePromotionTarget(candidate, config.memoryRoot);
      const markdown = renderPromotionBlock(candidate, session);
      if (!markdown) continue;

      promotions.push({
        externalSessionId: session.externalSessionId,
        kind: candidate.kind,
        title: candidate.title,
        candidateFingerprint: candidate.contentFingerprint,
        targetFile: target.targetFile,
        targetSection: target.targetSection,
        entrySlug: target.entrySlug,
        promotionMode: 'append',
        contentMarkdown: markdown,
      });

      if (!config.writePromotions) continue;

      await ensureParentDir(target.targetFile);
      await snapshotFile(target.targetFile, config.memoryRoot);
      await appendPromotion(target.targetFile, markdown);
    }
  }

  return promotions;
}

function resolvePromotionTarget(candidate, memoryRoot) {
  const sectionMap = {
    project_state: { file: 'memory/projects/active.md', section: '## Active project state' },
    user_preference: { file: 'memory/preferences/user.md', section: '## Stable user preferences' },
    operation_rule: { file: 'memory/operations/rules.md', section: '## Operating rules' },
    decision: { file: 'memory/decisions/log.md', section: '## Decisions' },
    relationship: { file: 'memory/people/relationships.md', section: '## Relationships' },
    todo: { file: 'memory/projects/todos.md', section: '## Pending todos' },
    fact: { file: 'memory/inbox.md', section: '## Pending review' },
  };

  const target = sectionMap[candidate.kind] || sectionMap.fact;
  return {
    targetFile: path.join(memoryRoot, target.file),
    targetSection: target.section,
    entrySlug: slugify(candidate.kind, candidate.title),
  };
}

function renderPromotionBlock(candidate, session) {
  const cleanTitle = String(candidate.title || '').trim();
  const cleanSummary = String(candidate.summary || '').trim();
  if (!cleanTitle || !cleanSummary) return null;

  const sources = (candidate.sourceMessageIds || []).slice(0, 5).join(', ');
  const reasons = (candidate.reasonCodes || []).join(', ');

  return [
    `### ${cleanTitle}`,
    `- Summary: ${cleanSummary}`,
    `- Confidence: ${candidate.confidenceScore}`,
    `- Importance: ${candidate.importanceScore}`,
    `- Last updated: ${new Date().toISOString()}`,
    `- Session: ${session.externalSessionId}`,
    `- Sources: ${sources || 'n/a'}`,
    `- Reasons: ${reasons || 'n/a'}`,
    '',
  ].join('\n');
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function snapshotFile(targetFile, memoryRoot) {
  const exists = await pathExists(targetFile);
  if (!exists) return;

  const snapshotRoot = path.join(memoryRoot, 'memory', '.snapshots');
  await mkdir(snapshotRoot, { recursive: true });
  const name = `${path.basename(targetFile)}.${Date.now()}.bak`;
  await copyFile(targetFile, path.join(snapshotRoot, name));
}

async function appendPromotion(targetFile, markdown) {
  const exists = await pathExists(targetFile);
  if (!exists) {
    await writeFile(targetFile, `${markdown}\n`, 'utf8');
    return;
  }

  const current = await readFile(targetFile, 'utf8');
  const cleaned = removeLegacyNoiseBlocks(current);
  if (cleaned.includes(markdown.trim())) {
    if (cleaned !== current) {
      await writeFile(targetFile, cleaned, 'utf8');
    }
    return;
  }

  const nextBase = cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
  await writeFile(targetFile, `${nextBase}${markdown}\n`, 'utf8');
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function removeLegacyNoiseBlocks(content) {
  return String(content || '')
    .split(/\n{2,}/)
    .filter((block) => !block.includes('[Thread starter - for context]'))
    .filter((block) => !block.includes('Conversation info (untrusted metadata):'))
    .filter((block) => !block.includes('Sender (untrusted metadata):'))
    .join('\n\n')
    .trimEnd();
}

function slugify(kind, title) {
  const normalized = `${kind}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || `${kind}-entry`;
}
