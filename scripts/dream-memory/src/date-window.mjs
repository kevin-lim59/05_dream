export function getTargetDateWindow({ date = 'yesterday', timeZone = 'Asia/Seoul' } = {}) {
  const now = new Date();
  const todayLocal = formatYmd(now, timeZone);

  let targetDate;
  if (date === 'yesterday') {
    targetDate = shiftYmd(todayLocal, -1, timeZone);
  } else if (date === 'today') {
    targetDate = todayLocal;
  } else {
    assertYmd(date);
    targetDate = date;
  }

  const startMs = zonedDateTimeToUtcMs(targetDate, timeZone, 0, 0, 0, 0);
  const endDate = shiftYmd(targetDate, 1, timeZone);
  const endMs = zonedDateTimeToUtcMs(endDate, timeZone, 0, 0, 0, 0) - 1;

  return {
    date: targetDate,
    startMs,
    endMs,
  };
}

function assertYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${value}`);
  }
}

function formatYmd(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftYmd(ymd, days, timeZone) {
  const startMs = zonedDateTimeToUtcMs(ymd, timeZone, 12, 0, 0, 0);
  const shifted = new Date(startMs + days * 24 * 60 * 60 * 1000);
  return formatYmd(shifted, timeZone);
}

function zonedDateTimeToUtcMs(ymd, timeZone, hour, minute, second, millisecond) {
  const [year, month, day] = ymd.split('-').map(Number);
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offsetMs = getTimeZoneOffsetMs(new Date(approxUtc), timeZone);
  return approxUtc - offsetMs;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
    0,
  );

  return asUtc - date.getTime();
}
