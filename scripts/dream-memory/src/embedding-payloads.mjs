import { normalizeText } from './text-cleaning.mjs';

const DEFAULT_SELECTABLE_DECISIONS = new Set(['promote', 'defer']);
const DEFAULT_SELECTABLE_KINDS = new Set([
  'project_state',
  'user_preference',
  'operation_rule',
  'decision',
  'todo',
  'relationship',
]);

export function buildSelectiveEmbeddingPayloads(report, options = {}) {
  const includeDecisions = new Set(options.includeDecisions || Array.from(DEFAULT_SELECTABLE_DECISIONS));
  const includeKinds = new Set(options.includeKinds || Array.from(DEFAULT_SELECTABLE_KINDS));
  const payloads = [];

  for (const session of report.sessions || []) {
    for (const candidate of session.candidates || []) {
      if (!shouldEmbedCandidate(candidate, includeDecisions, includeKinds)) continue;

      const text = buildCandidateEmbeddingText(candidate, session);
      if (!text) continue;

      payloads.push({
        objectType: 'candidate',
        objectId: candidate.contentFingerprint,
        source: {
          externalSessionId: session.externalSessionId,
          candidateKind: candidate.kind,
          candidateTitle: candidate.title,
        },
        project: candidate.primaryProject?.slug || null,
        decision: candidate.decision,
        text,
        metadata: {
          targetDate: session.targetDate,
          importanceScore: candidate.importanceScore,
          confidenceScore: candidate.confidenceScore,
          reasonCodes: candidate.reasonCodes || [],
          sourceMessageIds: candidate.sourceMessageIds || [],
          projectLinks: (candidate.projectLinks || []).map((link) => ({
            slug: link.slug,
            confidence: link.confidence,
            source: link.sources || [],
          })),
        },
        audit: {
          selectedBecause: explainCandidateSelection(candidate),
          excludedRawSession: true,
        },
      });
    }
  }

  for (const promotion of report.promotions || []) {
    if (!promotion.entrySlug || !promotion.contentMarkdown) continue;
    payloads.push({
      objectType: 'promotion',
      objectId: promotion.entrySlug,
      source: {
        externalSessionId: promotion.externalSessionId,
        targetFile: promotion.targetFile,
        targetSection: promotion.targetSection,
      },
      project: inferProjectFromPromotion(promotion),
      decision: 'promote',
      text: normalizeText(promotion.contentMarkdown),
      metadata: {
        promotionMode: promotion.promotionMode,
        kind: promotion.kind,
        title: promotion.title,
      },
      audit: {
        selectedBecause: ['promoted_memory_entry'],
        excludedRawSession: true,
      },
    });
  }

  return payloads;
}

export function shouldEmbedCandidate(candidate, includeDecisions = DEFAULT_SELECTABLE_DECISIONS, includeKinds = DEFAULT_SELECTABLE_KINDS) {
  if (!candidate?.contentFingerprint) return false;
  if (!includeDecisions.has(candidate.decision)) return false;
  if (!includeKinds.has(candidate.kind)) return false;
  const summary = normalizeText(candidate.summary || '');
  if (!summary || summary.length < 12) return false;
  return true;
}

export function buildCandidateEmbeddingText(candidate, session = {}) {
  const lines = [
    candidate.title,
    candidate.summary,
    candidate.primaryProject?.slug ? `Project: ${candidate.primaryProject.slug}` : null,
    session.summaryShort ? `Session summary: ${session.summaryShort}` : null,
    (candidate.reasonCodes || []).length > 0 ? `Reasons: ${(candidate.reasonCodes || []).join(', ')}` : null,
  ].filter(Boolean);

  const text = normalizeText(lines.join('\n'));
  return text || null;
}

function explainCandidateSelection(candidate) {
  const reasons = ['candidate_memory_unit'];
  if (candidate.decision === 'promote') reasons.push('promotion_candidate');
  if (candidate.decision === 'defer') reasons.push('review_later_candidate');
  if (candidate.primaryProject?.slug) reasons.push('project_linked');
  if (candidate.kind === 'user_preference' || candidate.kind === 'operation_rule') reasons.push('stable_memory_kind');
  return reasons;
}

function inferProjectFromPromotion(promotion) {
  const match = String(promotion.targetFile || '').match(/memory\/projects\/([^/.]+)\.md$/);
  return match ? match[1] : null;
}
