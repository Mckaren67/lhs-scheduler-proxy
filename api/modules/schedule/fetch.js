// Schedule fetching — today's jobs, specific date jobs, date parsing
// Extracted from incoming-sms.js lines 121–281

import { fetchWithTimeout, TIMEZONE, formatDateCA, formatDateFriendly } from '../shared/time.js';
import { hcpHeaders } from '../shared/hcp.js';

const HCP_BASE = 'https://api.housecallpro.com';

// ─── Fetch today's jobs ─────────────────────────────────────────────────────

export async function fetchTodaysJobs() {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const fetchUrl = `${HCP_BASE}/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${endOfDay}&page_size=200`;
    console.log('[HCP] Fetching today:', fetchUrl);
    const response = await fetchWithTimeout(fetchUrl, { headers: hcpHeaders() });
    console.log('[HCP] Response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[HCP] Error response:', response.status, errText);
      return { schedule: `Schedule fetch failed (HTTP ${response.status}).`, jobs: [] };
    }
    const data = await response.json();
    console.log('[HCP] Jobs returned:', data.jobs?.length ?? 0);

    if (!data.jobs || data.jobs.length === 0) return { schedule: 'No jobs scheduled for today.', jobs: [] };

    const lines = data.jobs.map(job => {
      const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown';
      const addr = job.address?.street || 'No address';
      const city = job.address?.city || '';
      const status = job.work_status || 'unknown';
      const desc = job.description || 'No description';
      const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', ') || 'Unassigned';

      const start = job.schedule?.scheduled_start;
      const end = job.schedule?.scheduled_end;
      const startTime = start ? new Date(start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }) : '?';
      const endTime = end ? new Date(end).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }) : '?';

      const amount = job.total_amount ? `$${(job.total_amount / 100).toFixed(2)}` : '';

      return `• ${startTime}–${endTime} | ${name} | ${addr}, ${city} | ${desc} | Assigned: ${employees} | Status: ${status} | ${amount}`;
    });

    return {
      schedule: `${data.total_items} job(s) today:\n${lines.join('\n')}`,
      jobs: data.jobs
    };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Request timed out after 8s' : err.message;
    console.error('[HCP] Fetch exception:', reason, err.stack);
    return { schedule: `Schedule data temporarily unavailable (${reason}).`, jobs: [] };
  }
}

// ─── Parse a specific date from a user message ──────────────────────────────

export function parseDateFromMessage(message) {
  const msg = message.toLowerCase();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const todayDow = now.getDay(); // 0=Sun

  // "today"
  if (/\btoday\b/.test(msg)) return formatDateCA(now);

  // "tomorrow"
  if (/\btomorrow\b/.test(msg)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return formatDateCA(d);
  }

  // Explicit date like "April 13", "april 13th", "Apr 13"
  const monthNames = { jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11 };
  const explicitMatch = msg.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (explicitMatch) {
    const month = monthNames[explicitMatch[1]];
    const day = parseInt(explicitMatch[2]);
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), month, day);
      // If the date is in the past by more than 7 days, assume next year
      if (d < now && (now - d) > 7 * 86400000) d.setFullYear(d.getFullYear() + 1);
      return formatDateCA(d);
    }
  }

  // Day name like "Monday", "next Tuesday", "this Wednesday"
  const dayNames = { sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6 };
  const dayMatch = msg.match(/\b(?:next|this|coming)?\s*(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)\b/);
  if (dayMatch) {
    const targetDow = dayNames[dayMatch[1]];
    if (targetDow !== undefined) {
      let daysAhead = (targetDow - todayDow + 7) % 7;
      if (daysAhead === 0) daysAhead = 0; // Same day = today
      if (/\bnext\b/.test(msg) && daysAhead < 7) daysAhead += 7; // "next Monday" = next week
      if (daysAhead === 0 && !/\btoday\b/.test(msg) && !/\bthis\b/.test(msg)) daysAhead = 7; // Bare "Monday" = next Monday if today is Monday
      const d = new Date(now); d.setDate(d.getDate() + daysAhead);
      return formatDateCA(d);
    }
  }

  return null; // No specific date found
}

// ─── Fetch jobs for a specific date ─────────────────────────────────────────

export async function fetchJobsForDate(dateStr) {
  try {
    const startOfDay = new Date(dateStr + 'T00:00:00-07:00').toISOString();
    const endOfDay = new Date(dateStr + 'T23:59:59-07:00').toISOString();

    const fetchUrl = `${HCP_BASE}/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${endOfDay}&page_size=200`;
    console.log(`[HCP] Fetching specific date ${dateStr}:`, fetchUrl);
    const response = await fetchWithTimeout(fetchUrl, { headers: hcpHeaders() }, 10000);

    if (!response.ok) return { schedule: `Could not fetch schedule for ${dateStr}.`, jobs: [], dateStr };
    const data = await response.json();
    const jobs = (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
    const friendly = formatDateFriendly(dateStr);

    if (jobs.length === 0) return { schedule: `No jobs scheduled for ${friendly}.`, jobs: [], dateStr };

    // Sort by start time
    jobs.sort((a, b) => new Date(a.schedule?.scheduled_start || 0) - new Date(b.schedule?.scheduled_start || 0));

    const lines = jobs.map(job => {
      const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown';
      const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(' and ') || 'Unassigned';
      const start = job.schedule?.scheduled_start;
      const startTime = start ? new Date(start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }) : '?';
      const status = job.work_status || 'scheduled';
      const addr = job.address?.street || '';
      return `• ${startTime} — ${name} — ${employees} — ${status}${addr ? ' — ' + addr : ''}`;
    });

    return {
      schedule: `${friendly}: ${jobs.length} job(s) scheduled:\n${lines.join('\n')}`,
      jobs,
      dateStr
    };
  } catch (err) {
    console.error(`[HCP] Fetch for ${dateStr} failed:`, err.message);
    return { schedule: `Schedule data unavailable for ${dateStr}.`, jobs: [], dateStr };
  }
}
