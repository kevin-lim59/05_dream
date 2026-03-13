const NOISE_PATTERNS = [
  /^\[Thread starter - for context\]/i,
  /^dream$/i,
  /^__cron$/i,
  /^cron$/i,
  /^\[cron:/i,
  /^Conversation info \(untrusted metadata\):/i,
  /^Sender \(untrusted metadata\):/i,
  /^```json$/i,
  /^```$/i,
  /^\{\s*$/,
  /^\}\s*$/,
  /^"message_id":/i,
  /^"sender_id":/i,
  /^"conversation_label":/i,
  /^"sender":/i,
  /^"timestamp":/i,
  /^"group_subject":/i,
  /^"group_channel":/i,
  /^"group_space":/i,
  /^"thread_label":/i,
  /^"topic_id":/i,
  /^"is_group_chat":/i,
  /^"label":/i,
  /^"id":/i,
  /^"name":/i,
  /^"username":/i,
  /^"tag":/i,
  /^\[Fri .* GMT\+9\]/i,
  /^\[Thu .* GMT\+9\]/i,
  /^\[Wed .* GMT\+9\]/i,
  /^\[Tue .* GMT\+9\]/i,
  /^\[Mon .* GMT\+9\]/i,
  /^\[Sun .* GMT\+9\]/i,
  /^\[Sat .* GMT\+9\]/i,
];

const LOW_SIGNAL_PATTERNS = [
  /^응+$/u,
  /^응응+$/u,
  /^ㅇㅇ$/u,
  /^좋아요?$/u,
  /^해봐$/u,
  /^진행해봐$/u,
  /^그렇게 해봐$/u,
  /^좋다$/u,
  /^일단 대기해$/u,
  /^응응 좋다 일단 대기해$/u,
  /^여기있는거양$/u,
  /^이거 맞아\??$/u,
];

export function extractMeaningfulUserText(messages) {
  const userTexts = (messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => normalizeText(message.text))
    .filter(Boolean)
    .filter((text) => !isMostlyNoise(text));

  const strong = userTexts.filter((text) => !isLowSignal(text));
  const selected = strong.length > 0 ? strong : userTexts;
  return selected.slice(-3);
}

export function summarizeMeaningfulText(messages, fallback = '') {
  const texts = extractMeaningfulUserText(messages);
  if (texts.length === 0) return fallback;
  return texts.join(' | ').slice(0, 280);
}

export function normalizeText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line)))
    .map((line) => line
      .replace(/\[Thread starter - for context\]/ig, ' ')
      .replace(/Conversation info \(untrusted metadata\):/ig, ' ')
      .replace(/Sender \(untrusted metadata\):/ig, ' ')
      .replace(/\[cron:[^\]]+\]/ig, ' ')
      .replace(/__cron/ig, ' ')
      .replace(/\bdream\b/ig, ' ')
    );

  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

export function isLowSignal(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  return LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMostlyNoise(text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (looksLikeTemporaryContext(normalized)) return true;
  const tokens = normalized.split(/\s+/);
  const shortTokenRatio = tokens.filter((token) => token.length <= 2).length / Math.max(tokens.length, 1);
  return normalized.length < 8 && shortTokenRatio > 0.8;
}

export function looksLikeTemporaryContext(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  if (lower.includes('/users/')) return true;
  if (lower.includes('.jsonl')) return true;
  if (lower.includes('/workspace')) return true;
  if (lower.includes('/sessions')) return true;
  if (lower.includes('tmp/')) return true;
  if (lower.includes('file path')) return true;
  if (/(^|\s)(session|sessions|workspace|jsonl|path)(\s|$)/i.test(normalized)) return true;
  return false;
}
