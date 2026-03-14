import { inferProjectHints } from './project-detection.mjs';
import { normalizeText } from './text-cleaning.mjs';
import { retrieveSemanticCandidates } from './semantic-retriever.mjs';

export async function planMemoryRecall({
  query,
  report,
  topK = 5,
  knownProjects = [],
  semanticProvider = null,
} = {}) {
  const normalizedQuery = normalizeText(query || '');
  if (!normalizedQuery) {
    return {
      query: String(query || ''),
      parsed: { normalizedQuery: '', projectHints: [] },
      items: [],
      semantic: {
        status: 'skipped',
        backend: 'empty_query',
        provider: semanticProvider?.name || null,
        model: null,
        similarityMetric: 'cosine',
        readySourceCount: 0,
        candidates: [],
        nextStep: 'query required before semantic recall can run',
      },
      vectorStub: {
        status: 'skipped',
        backend: 'empty_query',
        provider: semanticProvider?.name || null,
        model: null,
        similarityMetric: 'cosine',
        readySourceCount: 0,
        candidates: [],
        nextStep: 'query required before vector stub can run',
      },
      trace: { steps: ['empty_query'], filters: [], scoring: [] },
    };
  }

  const queryProjectHints = inferProjectHints({
    messages: [{ role: 'user', text: normalizedQuery }],
    sampleUserText: normalizedQuery,
    knownProjects,
  }).projectHints;

  const corpus = buildRecallCorpus(report);
  const scored = corpus
    .map((item) => scoreRecallItem(item, normalizedQuery, queryProjectHints))
    .filter((item) => item.totalScore > 0)
    .sort((a, b) => b.totalScore - a.totalScore || b.keywordScore - a.keywordScore || a.ref.localeCompare(b.ref))
    .slice(0, topK);

  const items = scored.map((item) => ({
    ref: item.ref,
    sourceType: item.sourceType,
    title: item.title,
    project: item.project,
    totalScore: item.totalScore,
    metadataScore: item.metadataScore,
    keywordScore: item.keywordScore,
    why: item.why,
    audit: item.audit,
  }));

  const semantic = await retrieveSemanticCandidates({
    query: normalizedQuery,
    report,
    rankedItems: items,
    topK,
    provider: semanticProvider,
  });

  return {
    query: String(query || ''),
    parsed: {
      normalizedQuery,
      projectHints: queryProjectHints,
    },
    items,
    semantic,
    vectorStub: semantic,
    trace: {
      steps: ['project_detection', 'metadata_filter', 'keyword_overlap', 'score_and_rank', 'semantic_slot_reserved'],
      filters: [
        queryProjectHints.length > 0
          ? `project-aware filter active: ${queryProjectHints.map((hint) => hint.slug).join(', ')}`
          : 'no project filter',
      ],
      scoring: [
        'metadata(project/kind/source)',
        'lexical overlap(title/summary/content)',
        'semantic/vector provider slot reserved above lexical ranking',
        'audit trail preserved',
      ],
    },
  };
}

function buildRecallCorpus(report) {
  const rows = [];

  for (const session of report.sessions || []) {
    for (const candidate of session.candidates || []) {
      if (candidate.decision === 'reject') continue;
      rows.push({
        ref: `candidate:${candidate.contentFingerprint}`,
        sourceType: 'candidate',
        title: candidate.title,
        content: normalizeText(`${candidate.title}\n${candidate.summary}\n${session.summaryShort || ''}`),
        project: candidate.primaryProject?.slug || candidate.projectLinks?.[0]?.slug || null,
        kind: candidate.kind,
        importanceScore: candidate.importanceScore || 0,
        confidenceScore: candidate.confidenceScore || 0,
        audit: {
          externalSessionId: session.externalSessionId,
          sourceMessageIds: candidate.sourceMessageIds || [],
          reasonCodes: candidate.reasonCodes || [],
          decision: candidate.decision,
        },
      });
    }
  }

  for (const promotion of report.promotions || []) {
    rows.push({
      ref: `promotion:${promotion.entrySlug}`,
      sourceType: 'promotion',
      title: promotion.title,
      content: normalizeText(`${promotion.title}\n${promotion.contentMarkdown || ''}`),
      project: inferPromotionProject(promotion),
      kind: promotion.kind,
      importanceScore: 100,
      confidenceScore: 1,
      audit: {
        externalSessionId: promotion.externalSessionId,
        targetFile: promotion.targetFile,
        targetSection: promotion.targetSection,
        promotionMode: promotion.promotionMode,
      },
    });
  }

  return rows;
}

function scoreRecallItem(item, normalizedQuery, queryProjectHints) {
  const queryTokens = tokenize(normalizedQuery);
  const contentTokens = tokenize(item.content);
  const overlap = intersect(queryTokens, contentTokens);
  const projectMatch = queryProjectHints.some((hint) => hint.slug === item.project);
  const queryHasProject = queryProjectHints.length > 0;

  let metadataScore = 0;
  const why = [];

  if (projectMatch) {
    metadataScore += 40;
    why.push(`project_match:${item.project}`);
  } else if (queryHasProject && item.project) {
    metadataScore -= 10;
    why.push(`project_mismatch:${item.project}`);
  }

  if (item.sourceType === 'promotion') {
    metadataScore += 20;
    why.push('promoted_memory_boost');
  }

  if (item.kind === 'operation_rule' || item.kind === 'user_preference') {
    metadataScore += 10;
    why.push(`stable_kind:${item.kind}`);
  }

  metadataScore += Math.round((item.confidenceScore || 0) * 10);
  const keywordScore = Math.min(60, overlap.length * 12);
  if (overlap.length > 0) {
    why.push(`keyword_overlap:${overlap.join(',')}`);
  }

  const totalScore = Math.max(0, metadataScore + keywordScore);
  return {
    ...item,
    metadataScore,
    keywordScore,
    totalScore,
    why,
  };
}

function inferPromotionProject(promotion) {
  const match = String(promotion.targetFile || '').match(/memory\/projects\/([^/.]+)\.md$/);
  return match ? match[1] : null;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9가-힣_/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return Array.from(new Set(left.filter((token) => rightSet.has(token))));
}
