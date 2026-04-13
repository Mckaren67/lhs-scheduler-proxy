// Shared Pacific timezone utilities — single source of truth
// Handles PDT/PST transitions automatically via America/Vancouver

export const TIMEZONE = 'America/Vancouver';

export function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export function formatDateCA(d) {
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export function formatDateFriendly(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric' });
}

export function getPacificDateTime() {
  const now = new Date();

  const dateTime = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).format(now);

  const tzAbbr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, timeZoneName: 'short'
  }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'PT';

  const tom = new Date(now.getTime() + 86400000);
  const tomorrowDate = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }).format(tom);

  return { dateTime, tzAbbr, tomorrowDate };
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}
