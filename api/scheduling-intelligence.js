// Proactive scheduling analysis — spots problems before Karen does
// Returns plain English briefing for SMS and voice conversations

export const config = { api: { bodyParser: true }, maxDuration: 20 };

const TIMEZONE = 'America/Vancouver';

async function fetchWeekSchedule() {
  const apiKey = process.env.HCP_API_KEY;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 7);
  const end = endDate.toISOString();

  const response = await fetch(
    `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
    { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
  );
  if (!response.ok) return [];
  const data = await response.json();
  return (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
}

async function fetchClientData() {
  try {
    const response = await fetch('https://lhs-knowledge-base.vercel.app/api/clients');
    const data = await response.json();
    return { clients: data.clients || [], cleaners: data.cleaners || [] };
  } catch (e) {
    return { clients: [], cleaners: [] };
  }
}

export async function analyzeSchedule() {
  const [jobs, clientData] = await Promise.all([fetchWeekSchedule(), fetchClientData()]);
  const { clients, cleaners } = clientData;

  const clientLookup = {};
  for (const c of clients) clientLookup[c.name.toLowerCase()] = c;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

  // Group jobs by day
  const jobsByDay = {};
  for (const job of jobs) {
    const dateStr = job.schedule?.scheduled_start
      ? new Date(job.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE })
      : null;
    if (!dateStr) continue;
    if (!jobsByDay[dateStr]) jobsByDay[dateStr] = [];
    jobsByDay[dateStr].push(job);
  }

  const insights = [];
  const recommendations = [];

  // 1. Check daily job counts — flag light or heavy days
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const dayName = dayNames[d.getDay()];
    const dayJobs = jobsByDay[dateStr] || [];

    if (d.getDay() === 0) continue; // Skip Sunday

    if (dayJobs.length === 0 && d.getDay() !== 6) {
      insights.push(`${dayName} ${dateStr} has no jobs scheduled.`);
    } else if (dayJobs.length > 20) {
      insights.push(`${dayName} ${dateStr} is very heavy with ${dayJobs.length} jobs.`);
    }
  }

  // 2. Check cleaner workload distribution
  const cleanerJobCount = {};
  for (const job of jobs) {
    for (const emp of (job.assigned_employees || [])) {
      const name = `${emp.first_name} ${emp.last_name}`.trim();
      cleanerJobCount[name] = (cleanerJobCount[name] || 0) + 1;
    }
  }

  const counts = Object.values(cleanerJobCount);
  if (counts.length > 0) {
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    for (const [name, count] of Object.entries(cleanerJobCount)) {
      if (count > avg * 1.5) {
        insights.push(`${name} has ${count} jobs this week — well above the team average of ${Math.round(avg)}. Consider redistributing.`);
      }
    }
  }

  // 3. Check preferred cleaner mismatches
  for (const job of jobs) {
    const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
    const prefs = clientLookup[custName.toLowerCase()];
    if (!prefs || !prefs.preferred_cleaner) continue;
    if (prefs.priority !== 'High') continue;

    const assigned = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim());
    const prefNames = prefs.preferred_cleaner.split(',').map(n => n.trim());
    const hasPreferred = prefNames.some(pn => assigned.some(a => a.toLowerCase().includes(pn.split(' ')[0].toLowerCase())));

    if (!hasPreferred) {
      const dateStr = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE })
        : '';
      recommendations.push(`High-priority client ${custName} on ${dateStr} is assigned to ${assigned.join(', ')} but prefers ${prefs.preferred_cleaner}. Consider swapping.`);
    }
  }

  // 4. Check for double-bookings (same cleaner, overlapping times)
  const cleanerSlots = {};
  for (const job of jobs) {
    for (const emp of (job.assigned_employees || [])) {
      const name = `${emp.first_name} ${emp.last_name}`.trim();
      if (!cleanerSlots[name]) cleanerSlots[name] = [];
      const s = job.schedule?.scheduled_start ? new Date(job.schedule.scheduled_start).getTime() : 0;
      const e = job.schedule?.scheduled_end ? new Date(job.schedule.scheduled_end).getTime() : 0;
      if (s && e) {
        for (const existing of cleanerSlots[name]) {
          if (s < existing.end && e > existing.start) {
            const dateStr = new Date(s).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
            insights.push(`${name} has overlapping jobs on ${dateStr}. Potential scheduling conflict.`);
            break;
          }
        }
        cleanerSlots[name].push({ start: s, end: e });
      }
    }
  }

  // 5. Check for cleaners working on their unavailable days
  const cleanerAvail = {};
  for (const c of cleaners) {
    cleanerAvail[c.name.toLowerCase()] = c.days || [];
  }

  for (const job of jobs) {
    const dateObj = job.schedule?.scheduled_start ? new Date(job.schedule.scheduled_start) : null;
    if (!dateObj) continue;
    const dayName = dayNames[dateObj.getUTCDay()];

    for (const emp of (job.assigned_employees || [])) {
      const name = `${emp.first_name} ${emp.last_name}`.trim();
      const avail = cleanerAvail[name.toLowerCase()];
      if (avail && avail.length > 0 && !avail.includes(dayName)) {
        const dateStr = dateObj.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
        recommendations.push(`${name} is scheduled on ${dayName} ${dateStr} but is marked unavailable that day.`);
      }
    }
  }

  // Build the briefing
  let briefing = `Schedule Intelligence — Next 7 Days (${jobs.length} jobs total):\n\n`;

  if (insights.length > 0) {
    briefing += 'Things I noticed:\n';
    for (const i of insights.slice(0, 5)) briefing += `• ${i}\n`;
    briefing += '\n';
  }

  if (recommendations.length > 0) {
    briefing += 'Recommendations:\n';
    for (const r of recommendations.slice(0, 5)) briefing += `• ${r}\n`;
    briefing += '\n';
  }

  if (insights.length === 0 && recommendations.length === 0) {
    briefing += 'Everything looks good! No conflicts, gaps, or mismatches spotted this week.\n';
  }

  return {
    briefing,
    jobCount: jobs.length,
    insights,
    recommendations,
    jobsByDay: Object.fromEntries(Object.entries(jobsByDay).map(([k, v]) => [k, v.length]))
  };
}

// HTTP handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await analyzeSchedule();
    return res.status(200).json(result);
  } catch (err) {
    console.error('[SCHED-INTEL] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
