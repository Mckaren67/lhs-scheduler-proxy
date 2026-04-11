// Recurring pattern analysis and cache management
// Extracted from incoming-sms.js lines 72–119 (cache) and 283–351 (analysis)

import { fetchWithTimeout } from '../shared/time.js';
import { hcpHeaders } from '../shared/hcp.js';

const HCP_BASE = 'https://api.housecallpro.com';

// ─── In-memory pattern cache (persists across warm Vercel invocations) ──────
const PATTERN_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
let cachedPatterns = { data: '', fetchedAt: 0 };
let patternFetchInProgress = false;

export async function refreshPatternCache() {
  if (patternFetchInProgress) return;
  patternFetchInProgress = true;
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const thirtyDaysOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30, 23, 59, 59).toISOString();

    const fetchUrl = `${HCP_BASE}/jobs?scheduled_start_min=${startOfDay}&scheduled_start_max=${thirtyDaysOut}&page_size=200`;
    console.log('[PATTERNS] Refreshing 30-day cache...');
    const response = await fetchWithTimeout(fetchUrl, { headers: hcpHeaders() }, 15000);

    if (response.ok) {
      const data = await response.json();
      const patterns = analyzeRecurringPatterns(data.jobs || []);
      cachedPatterns = { data: patterns, fetchedAt: Date.now() };
      console.log(`[PATTERNS] Cache refreshed — ${(data.jobs || []).length} jobs analyzed`);
    } else {
      console.error('[PATTERNS] Refresh failed:', response.status);
    }
  } catch (err) {
    console.error('[PATTERNS] Refresh exception:', err.message);
  } finally {
    patternFetchInProgress = false;
  }
}

export function getCachedPatterns() {
  const age = Date.now() - cachedPatterns.fetchedAt;
  if (age > PATTERN_CACHE_TTL) {
    // Trigger background refresh — don't block the current request
    refreshPatternCache();
  }
  return cachedPatterns.data;
}

// ─── Recurring pattern analysis ─────────────────────────────────────────────

export function analyzeRecurringPatterns(jobs) {
  if (!jobs || jobs.length === 0) return '';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Group jobs by customer name
  const customerJobs = {};
  for (const job of jobs) {
    const name = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
    if (!name || job.work_status === 'pro canceled' || job.deleted_at) continue;

    if (!customerJobs[name]) customerJobs[name] = [];

    const start = job.schedule?.scheduled_start;
    if (start) {
      const d = new Date(start);
      customerJobs[name].push({
        date: d,
        day: dayNames[d.getUTCDay()],
        cleaner: (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', '),
        status: job.work_status
      });
    }
  }

  // Analyze each customer's pattern
  const lines = [];
  for (const [name, visits] of Object.entries(customerJobs)) {
    if (visits.length < 2) continue; // Need 2+ visits to detect a pattern

    // Sort by date
    visits.sort((a, b) => a.date - b.date);

    // Count which days they're booked on
    const dayCounts = {};
    for (const v of visits) {
      dayCounts[v.day] = (dayCounts[v.day] || 0) + 1;
    }
    const primaryDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Calculate average gap between visits in days
    let totalGap = 0;
    for (let i = 1; i < visits.length; i++) {
      totalGap += (visits[i].date - visits[i - 1].date) / (1000 * 60 * 60 * 24);
    }
    const avgGap = totalGap / (visits.length - 1);

    // Determine frequency from actual gaps
    let frequency;
    if (avgGap <= 8) frequency = 'Weekly';
    else if (avgGap <= 16) frequency = 'Biweekly';
    else if (avgGap <= 35) frequency = 'Monthly';
    else frequency = `Every ~${Math.round(avgGap)} days`;

    // Who cleans most often
    const cleanerCounts = {};
    for (const v of visits) {
      if (v.cleaner) cleanerCounts[v.cleaner] = (cleanerCounts[v.cleaner] || 0) + 1;
    }
    const usualCleaner = Object.entries(cleanerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Varies';

    lines.push(`  ${name}: ${frequency} ${primaryDay}s | Usually cleaned by: ${usualCleaner} | ${visits.length} visits in 30 days`);
  }

  if (lines.length === 0) return '';

  console.log(`[HCP] Patterns detected for ${lines.length} clients`);
  return lines.join('\n');
}
