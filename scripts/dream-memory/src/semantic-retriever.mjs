import { buildSelectiveEmbeddingPayloads } from './embedding-payloads.mjs';

const DEFAULT_TOP_K = 5;

export async function retrieveSemanticCandidates({
  query,
  report,
  rankedItems = [],
  topK = DEFAULT_TOP_K,
  provider = null,
} = {}) {
  const effectiveProvider = provider || createSemanticRecallProvider();
  const result = await effectiveProvider.retrieve({ query, report, rankedItems, topK });

  return {
    status: result?.status || 'stub',
    backend: result?.backend || effectiveProvider.name || 'unknown',
    provider: result?.provider || effectiveProvider.name || null,
    model: result?.model || null,
    similarityMetric: result?.similarityMetric || 'cosine',
    readySourceCount: Number.isFinite(result?.readySourceCount) ? result.readySourceCount : countReadySources(report),
    candidates: Array.isArray(result?.candidates) ? result.candidates : [],
    nextStep: result?.nextStep || null,
  };
}

export function createSemanticRecallProvider(options = {}) {
  const mode = String(options.mode || options.provider || 'stub').trim().toLowerCase();

  if (mode === 'stub' || mode === 'local' || mode === 'none') {
    return createStubSemanticRecallProvider(options);
  }

  return {
    name: mode,
    async retrieve() {
      return {
        status: 'unavailable',
        backend: mode,
        provider: mode,
        model: options.model || null,
        similarityMetric: 'cosine',
        readySourceCount: 0,
        candidates: [],
        nextStep: `provider \"${mode}\" is reserved but not implemented yet`,
      };
    },
  };
}

export function createStubSemanticRecallProvider(options = {}) {
  const providerName = String(options.provider || 'stub').trim() || 'stub';
  const model = options.model || null;

  return {
    name: providerName,
    async retrieve({ report, rankedItems = [], topK = DEFAULT_TOP_K }) {
      const payloads = buildSelectiveEmbeddingPayloads(report);
      const payloadByRef = new Map(payloads.map((payload) => [toRecallRef(payload), payload]));

      const candidates = rankedItems
        .filter((item) => payloadByRef.has(item.ref))
        .slice(0, topK)
        .map((item, index) => {
          const payload = payloadByRef.get(item.ref);
          return {
            ref: item.ref,
            sourceKey: `${payload.objectType}:${payload.objectId}`,
            objectType: payload.objectType,
            objectId: payload.objectId,
            project: payload.project || null,
            vectorScore: null,
            rankHint: index + 1,
            reason: 'lexical_rank_seed',
          };
        });

      return {
        status: 'stub',
        backend: 'not_configured',
        provider: providerName,
        model,
        similarityMetric: 'cosine',
        readySourceCount: payloads.length,
        candidates,
        nextStep: 'replace candidates with persisted dream_embeddings vector search when provider/model is configured',
      };
    },
  };
}

function countReadySources(report) {
  return buildSelectiveEmbeddingPayloads(report).length;
}

function toRecallRef(payload) {
  return `${payload.objectType}:${payload.objectId}`;
}
