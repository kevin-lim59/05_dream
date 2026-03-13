import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ENTRY_START_PREFIX = '<!-- dream-memory:entry ';
const ENTRY_END_PREFIX = '<!-- /dream-memory:entry ';

export async function applyPromotions(report, config) {
  const promotions = [];

  for (const session of report.sessions || []) {
    for (const candidate of session.candidates || []) {
      if (candidate.decision !== 'promote') continue;

      const target = resolvePromotionTarget(candidate, config.memoryRoot);
      const markdown = renderPromotionBlock(candidate, session, target);
      if (!markdown) continue;

      let promotionMode = target.defaultMode;
      let writeApplied = false;

      if (config.writePromotions) {
        await ensureParentDir(target.targetFile);
        const result = await writePromotion(target.targetFile, target.targetSection, target.entrySlug, markdown, config.memoryRoot);
        promotionMode = result.mode;
        writeApplied = result.changed;
      }

      promotions.push({
        externalSessionId: session.externalSessionId,
        kind: candidate.kind,
        title: candidate.title,
        candidateFingerprint: candidate.contentFingerprint,
        targetFile: target.targetFile,
        targetSection: target.targetSection,
        entrySlug: target.entrySlug,
        promotionMode,
        contentMarkdown: markdown,
        writeApplied,
      });
    }
  }

  return promotions;
}

export function resolvePromotionTarget(candidate, memoryRoot) {
  const primaryProjectSlug = candidate.primaryProject?.slug ? sanitizeSlug(candidate.primaryProject.slug) : null;
  const primaryProjectLabel = candidate.primaryProject?.label || primaryProjectSlug;

  const sectionMap = {
    project_state: primaryProjectSlug
      ? { file: `memory/projects/${primaryProjectSlug}.md`, section: '## Snapshot', mode: 'merge' }
      : { file: 'MEMORY.md', section: '## Active Projects', mode: 'merge' },
    user_preference: { file: 'MEMORY.md', section: '## Stable Preferences', mode: 'merge' },
    operation_rule: { file: 'MEMORY.md', section: '## Operational Rules', mode: 'merge' },
    decision: primaryProjectSlug
      ? { file: `memory/projects/${primaryProjectSlug}.md`, section: '## Important Decisions', mode: 'merge' }
      : { file: 'memory/decisions/log.md', section: '## Decisions', mode: 'merge' },
    relationship: { file: 'memory/people/relationships.md', section: '## Relationships', mode: 'merge' },
    todo: primaryProjectSlug
      ? { file: `memory/projects/${primaryProjectSlug}.md`, section: '## Active Todos', mode: 'merge' }
      : { file: 'memory/projects/todos.md', section: '## Pending todos', mode: 'merge' },
    fact: { file: 'memory/inbox.md', section: '## Pending review', mode: 'append' },
  };

  const target = sectionMap[candidate.kind] || sectionMap.fact;
  const targetFile = path.join(memoryRoot, target.file);
  const entrySlug = slugify(candidate.kind, candidate.title, primaryProjectSlug || primaryProjectLabel || 'global');

  return {
    targetFile,
    targetSection: target.section,
    entrySlug,
    defaultMode: target.mode,
  };
}

export function renderPromotionBlock(candidate, session, target) {
  const cleanTitle = String(candidate.title || '').trim();
  const cleanSummary = String(candidate.summary || '').trim();
  if (!cleanTitle || !cleanSummary) return null;

  const lastUpdated = inferStableDate(session);
  const sources = (candidate.sourceMessageIds || []).slice(0, 5).join(', ');
  const reasons = (candidate.reasonCodes || []).join(', ');
  const project = candidate.primaryProject?.slug || candidate.primaryProject?.label || null;

  const body = [
    `### ${cleanTitle}`,
    `- Summary: ${cleanSummary}`,
    `- Confidence: ${candidate.confidenceScore}`,
    `- Importance: ${candidate.importanceScore}`,
    project ? `- Project: ${project}` : null,
    `- Last updated: ${lastUpdated}`,
    `- Session: ${session.externalSessionId}`,
    `- Sources: ${sources || 'n/a'}`,
    `- Reasons: ${reasons || 'n/a'}`,
  ].filter(Boolean).join('\n');

  return [
    `${ENTRY_START_PREFIX}${target.entrySlug} -->`,
    body,
    `${ENTRY_END_PREFIX}${target.entrySlug} -->`,
  ].join('\n');
}

async function writePromotion(targetFile, targetSection, entrySlug, markdown, memoryRoot) {
  const exists = await pathExists(targetFile);
  const current = exists ? await readFile(targetFile, 'utf8') : '';
  const cleaned = removeLegacyNoiseBlocks(current);
  const withSection = ensureSection(cleaned, targetFile, targetSection);
  const next = upsertEntry(withSection, targetSection, entrySlug, markdown);

  if (normalizeForCompare(next) === normalizeForCompare(current)) {
    if (normalizeForCompare(cleaned) !== normalizeForCompare(current)) {
      await snapshotFile(targetFile, memoryRoot);
      await writeFile(targetFile, ensureTrailingNewline(cleaned), 'utf8');
      return { changed: true, mode: 'replace' };
    }
    return { changed: false, mode: exists ? 'replace' : 'append' };
  }

  if (exists) {
    await snapshotFile(targetFile, memoryRoot);
  }

  await writeFile(targetFile, ensureTrailingNewline(next), 'utf8');
  return { changed: true, mode: inferPromotionMode(current, withSection, next, entrySlug) };
}

function inferPromotionMode(previous, sectionReady, next, entrySlug) {
  if (!previous.trim()) return 'append';
  if (!sectionReady.includes(entryStartMarker(entrySlug))) return 'merge';
  if (normalizeForCompare(previous) !== normalizeForCompare(next)) return 'replace';
  return 'replace';
}

function upsertEntry(content, sectionHeading, entrySlug, markdown) {
  const existingRange = findEntryRange(content, entrySlug);
  if (existingRange) {
    const currentEntry = content.slice(existingRange.start, existingRange.end);
    if (normalizeForCompare(currentEntry) === normalizeForCompare(markdown)) {
      return content;
    }
    return `${content.slice(0, existingRange.start)}${markdown}${content.slice(existingRange.end)}`;
  }

  const sectionRange = findSectionRange(content, sectionHeading);
  if (!sectionRange) {
    return `${content.trimEnd()}\n\n${sectionHeading}\n\n${markdown}\n`;
  }

  const sectionBody = content.slice(sectionRange.contentStart, sectionRange.end).trim();
  const insertion = sectionBody ? `\n\n${markdown}` : `${markdown}`;

  return [
    content.slice(0, sectionRange.contentStart),
    sectionBody,
    insertion,
    content.slice(sectionRange.end),
  ].join('');
}

function ensureSection(content, targetFile, sectionHeading) {
  const normalized = String(content || '').trimEnd();
  if (normalized.includes(sectionHeading)) return normalized;

  const prefix = buildFilePrefix(targetFile);
  if (!normalized) {
    return `${prefix}${sectionHeading}\n`;
  }

  return `${normalized}\n\n${sectionHeading}\n`;
}

function buildFilePrefix(targetFile) {
  if (path.basename(targetFile) === 'MEMORY.md') {
    return '# MEMORY\n\n';
  }

  const projectMatch = targetFile.match(/memory\/projects\/([^/]+)\.md$/);
  if (projectMatch) {
    return `# ${projectMatch[1]}\n\n`;
  }

  return '';
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

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function findEntryRange(content, entrySlug) {
  const startMarker = entryStartMarker(entrySlug);
  const endMarker = entryEndMarker(entrySlug);
  const start = content.indexOf(startMarker);
  if (start === -1) return null;
  const endMarkerIndex = content.indexOf(endMarker, start);
  if (endMarkerIndex === -1) return null;
  const end = endMarkerIndex + endMarker.length;
  return { start, end };
}

function findSectionRange(content, sectionHeading) {
  const sectionIndex = content.indexOf(sectionHeading);
  if (sectionIndex === -1) return null;

  const afterHeading = sectionIndex + sectionHeading.length;
  const contentStart = content[afterHeading] === '\n' ? afterHeading + 1 : afterHeading;
  const rest = content.slice(contentStart);
  const nextHeadingOffset = rest.search(/\n##\s+/);
  const end = nextHeadingOffset === -1 ? content.length : contentStart + nextHeadingOffset + 1;

  return { start: sectionIndex, contentStart, end };
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

function entryStartMarker(entrySlug) {
  return `${ENTRY_START_PREFIX}${entrySlug} -->`;
}

function entryEndMarker(entrySlug) {
  return `${ENTRY_END_PREFIX}${entrySlug} -->`;
}

function inferStableDate(session) {
  const candidate = session.targetDate || session.lastMessageAt || session.startedAt;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeForCompare(content) {
  return ensureTrailingNewline(String(content || '').trimEnd());
}

function ensureTrailingNewline(content) {
  return `${String(content || '').trimEnd()}\n`;
}

function slugify(kind, title, scope = 'global') {
  const normalizedTitle = String(title || '')
    .replace(new RegExp(`^${escapeRegExp(kind)}\\s*:\\s*`, 'i'), '')
    .trim();
  const normalized = `${scope}-${kind}-${normalizedTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || `${kind}-entry`;
}

function sanitizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
