// Schedule context builder — merges HCP data + client preferences + patterns
// Extracted from incoming-sms.js lines 353–443

import { fetchWithTimeout, TIMEZONE } from '../shared/time.js';

// ─── Fetch client preferences from knowledge base ───────────────────────────

export async function fetchClientPreferences() {
  try {
    const clientsUrl = 'https://lhs-knowledge-base.vercel.app/api/clients';
    console.log('[CLIENTS] Fetching:', clientsUrl);
    const response = await fetchWithTimeout(clientsUrl);
    console.log('[CLIENTS] Response status:', response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error('[CLIENTS] Error response:', response.status, errText);
      return { clients: [], cleaners: [] };
    }
    const data = await response.json();
    console.log('[CLIENTS] Loaded:', data.clients?.length ?? 0, 'clients,', data.cleaners?.length ?? 0, 'cleaners');
    return { clients: data.clients || [], cleaners: data.cleaners || [] };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Request timed out after 8s' : err.message;
    console.error('[CLIENTS] Fetch exception:', reason, err.stack);
    return { clients: [], cleaners: [] };
  }
}

// ─── Build full schedule context string for Claude's system prompt ───────────

export function buildScheduleContext(hcpResult, clientData) {
  const { schedule, jobs, patterns } = hcpResult;
  const { clients, cleaners } = clientData;

  // Build a lookup of client preferences by name (lowercase for matching)
  const clientLookup = {};
  for (const c of clients) {
    clientLookup[c.name.toLowerCase()] = c;
  }

  // Merge: for each job today, find matching client preferences
  let mergedNotes = '';
  if (jobs.length > 0) {
    const matched = [];
    for (const job of jobs) {
      const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
      if (!custName) continue;

      // Try exact match, then partial match
      let prefs = clientLookup[custName.toLowerCase()];
      if (!prefs) {
        const lastN = (job.customer?.last_name || '').toLowerCase();
        prefs = clients.find(c => c.name.toLowerCase().includes(lastN) && lastN.length > 2);
      }

      if (prefs) {
        const notes = [];
        if (prefs.priority) notes.push(`Priority: ${prefs.priority}`);
        if (prefs.preferred_cleaner) notes.push(`Preferred cleaner: ${prefs.preferred_cleaner}`);
        if (prefs.preferred_day) notes.push(`Preferred day: ${prefs.preferred_day}`);
        if (prefs.frequency) notes.push(`Frequency: ${prefs.frequency}`);
        if (prefs.client_type) notes.push(`Type: ${prefs.client_type}`);
        if (notes.length > 0) {
          matched.push(`  ${prefs.name}: ${notes.join(' | ')}`);
        }
      }
    }
    if (matched.length > 0) {
      mergedNotes = `\n\nCLIENT PREFERENCES FOR TODAY'S JOBS:\n${matched.join('\n')}`;
    }
  }

  // Build cleaner availability summary
  const dayName = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long' });
  const availableToday = cleaners
    .filter(c => c.days.includes(dayName))
    .map(c => `${c.name} (${c.jobs} career jobs)`)
    .join(', ');
  const unavailableToday = cleaners
    .filter(c => !c.days.includes(dayName))
    .map(c => c.name)
    .join(', ');

  const cleanerSummary = `\n\nCLEANER AVAILABILITY TODAY (${dayName}):\nAvailable: ${availableToday || 'None'}\nNot scheduled: ${unavailableToday || 'None'}`;

  // High-priority clients summary (always useful context)
  const highPriority = clients
    .filter(c => c.priority === 'High')
    .map(c => `  ${c.name}: Preferred cleaner ${c.preferred_cleaner || 'not set'} | ${c.frequency} on ${c.preferred_day || 'flexible'}`)
    .join('\n');
  const highPrioritySummary = highPriority
    ? `\n\nHIGH-PRIORITY CLIENTS (never miss, always assign preferred cleaner):\n${highPriority}`
    : '';

  const patternsSummary = patterns
    ? `\n\nRECURRING CLIENT PATTERNS (detected from actual HCP bookings over next 30 days):\n${patterns}`
    : '';

  return `${schedule}${mergedNotes}${cleanerSummary}${highPrioritySummary}${patternsSummary}`;
}
