export function buildPurgePlan(report, config) {
  const sessions = report.sessions || [];
  const actions = [];

  for (const session of sessions) {
    const retention = session.retentionClass || 'standard';
    const recommendation = recommendAction(session, retention, config);
    if (!recommendation) continue;

    actions.push({
      externalSessionId: session.externalSessionId,
      filePath: session.filePath,
      retentionClass: retention,
      promotionDecision: session.effectivePromotionDecision || session.promotionDecision,
      action: recommendation.action,
      reason: recommendation.reason,
      safeToDeleteNow: recommendation.safeToDeleteNow,
    });
  }

  return {
    enabled: config.purgeDryRun,
    mode: 'dry-run',
    counts: summarizeActions(actions),
    actions,
  };
}

function recommendAction(session, retentionClass, config) {
  if (!config.purgeDryRun) return null;

  if (retentionClass === 'promoted') {
    return {
      action: 'keep',
      reason: 'promoted memory source',
      safeToDeleteNow: false,
    };
  }

  if (retentionClass === 'standard') {
    return {
      action: 'keep',
      reason: 'standard retention window',
      safeToDeleteNow: false,
    };
  }

  if (retentionClass === 'ephemeral') {
    return {
      action: 'purge_candidate',
      reason: 'low-importance ephemeral session',
      safeToDeleteNow: false,
    };
  }

  const decision = session.effectivePromotionDecision || session.promotionDecision;

  if (decision === 'archive_only') {
    return {
      action: 'purge_candidate',
      reason: 'archive preserved; promotion skipped',
      safeToDeleteNow: false,
    };
  }

  return {
    action: 'review',
    reason: 'no explicit purge rule matched',
    safeToDeleteNow: false,
  };
}

function summarizeActions(actions) {
  return actions.reduce((acc, action) => {
    acc[action.action] = (acc[action.action] || 0) + 1;
    return acc;
  }, {});
}
