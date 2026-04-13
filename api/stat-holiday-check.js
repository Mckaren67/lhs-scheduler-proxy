export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { saveTask } from './_task-client.js';

const KAREN_PHONE = '+16048009630';

// Remaining 2026 BC statutory holidays
const STAT_HOLIDAYS = [
  { date: '2026-05-18', name: 'Victoria Day' },
  { date: '2026-06-21', name: 'National Indigenous Peoples Day' },
  { date: '2026-07-01', name: 'Canada Day' },
  { date: '2026-08-03', name: 'BC Day' },
  { date: '2026-09-07', name: 'Labour Day' },
  { date: '2026-09-30', name: 'National Day for Truth and Reconciliation' },
  { date: '2026-10-12', name: 'Thanksgiving' },
  { date: '2026-11-11', name: 'Remembrance Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' }
];

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
    }
  );
  return response.json();
}

function getUpcomingHolidays(withinDays = 28) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  const cutoff = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  cutoff.setDate(cutoff.getDate() + withinDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  return STAT_HOLIDAYS.filter(h => h.date >= today && h.date <= cutoffStr);
}

async function fetchJobsForDate(dateStr) {
  const apiKey = process.env.HCP_API_KEY;
  const start = `${dateStr}T00:00:00Z`;
  const end = `${dateStr}T23:59:59Z`;

  try {
    const response = await fetch(
      `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
  } catch (err) {
    console.error(`[STAT-CHECK] HCP fetch error for ${dateStr}:`, err.message);
    return [];
  }
}

async function fetchClientPreferences() {
  try {
    const response = await fetch('https://lhs-knowledge-base.vercel.app/api/clients');
    const data = await response.json();
    return { clients: data.clients || [], cleaners: data.cleaners || [] };
  } catch (err) {
    console.error('[STAT-CHECK] KB fetch error:', err.message);
    return { clients: [], cleaners: [] };
  }
}

function analyzeAffectedJobs(jobs, clients) {
  // Build client lookup
  const clientLookup = {};
  for (const c of clients) {
    clientLookup[c.name.toLowerCase()] = c;
  }

  const commercial = [];
  const residential = [];

  for (const job of jobs) {
    const custName = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim();
    const employees = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`).join(', ') || 'Unassigned';

    // Match to KB client
    const prefs = clientLookup[custName.toLowerCase()];
    const clientType = prefs?.client_type || 'Residential';
    const isCommercial = clientType === 'Commercial';

    const entry = {
      jobId: job.id,
      client: custName,
      address: job.address?.street || '',
      employees,
      clientType,
      priority: prefs?.priority || 'Standard',
      preferredDay: prefs?.preferred_day || null,
      isCommercial
    };

    if (isCommercial) {
      commercial.push(entry);
    } else {
      residential.push(entry);
    }
  }

  return { commercial, residential };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth: Vercel cron header OR bearer token
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;

  if (!isVercelCron && !hasToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const upcoming = getUpcomingHolidays(21);

    if (upcoming.length === 0) {
      console.log('[STAT-CHECK] No stat holidays in next 21 days');
      return res.status(200).json({ ok: true, holidays: [], message: 'No upcoming stat holidays' });
    }

    console.log(`[STAT-CHECK] Found ${upcoming.length} upcoming holiday(s):`, upcoming.map(h => h.name).join(', '));

    const results = [];

    for (const holiday of upcoming) {
      // Fetch jobs and client prefs in parallel
      const [jobs, clientData] = await Promise.all([
        fetchJobsForDate(holiday.date),
        fetchClientPreferences()
      ]);

      if (jobs.length === 0) {
        console.log(`[STAT-CHECK] No jobs on ${holiday.name} (${holiday.date})`);
        results.push({ holiday: holiday.name, date: holiday.date, jobCount: 0 });
        continue;
      }

      const { commercial, residential } = analyzeAffectedJobs(jobs, clientData.clients);
      const dayName = new Date(holiday.date + 'T12:00:00Z').toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long' });
      const dateFormatted = new Date(holiday.date + 'T12:00:00Z').toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', month: 'long', day: 'numeric' });

      // Build Karen's message
      let msg = `📅 Heads up, Karen! ${holiday.name} is coming up on ${dayName}, ${dateFormatted}.\n\n`;
      msg += `${jobs.length} job${jobs.length !== 1 ? 's' : ''} scheduled that day:\n`;

      if (commercial.length > 0) {
        msg += `\n🏢 Commercial (${commercial.length}) — need your approval to reschedule:\n`;
        for (const j of commercial.slice(0, 3)) {
          msg += `• ${j.client} (${j.employees})\n`;
        }
        if (commercial.length > 3) msg += `  ...and ${commercial.length - 3} more\n`;
      }

      if (residential.length > 0) {
        msg += `\n🏠 Residential (${residential.length}):\n`;
        for (const j of residential.slice(0, 3)) {
          const flex = j.preferredDay ? `prefers ${j.preferredDay}s` : 'flexible';
          msg += `• ${j.client} (${j.employees}) — ${flex}\n`;
        }
        if (residential.length > 3) msg += `  ...and ${residential.length - 3} more\n`;
      }

      msg += `\nWant me to build a full rescheduling plan? Just reply "yes build the plan for ${holiday.name}" and I'll work out the best options for each client. — Aria 🏠`;

      const smsResult = await sendSMS(KAREN_PHONE, msg);
      console.log(`[STAT-CHECK] SMS for ${holiday.name}:`, smsResult.sid ? `sent (${smsResult.sid})` : 'failed');

      // Save a task so it shows in the briefing
      await saveTask({
        description: `Review ${holiday.name} rescheduling plan — ${jobs.length} jobs affected on ${dateFormatted}`,
        priority: 'high',
        category: 'stat_holiday',
        due_date: new Date(new Date(holiday.date + 'T12:00:00Z').getTime() - 7 * 86400000).toISOString().split('T')[0],
        assigned_to: 'karen',
        estimated_time_minutes: 30,
        notes: `${commercial.length} commercial, ${residential.length} residential jobs on ${holiday.name}`,
        source_message: 'Auto-generated by stat holiday check'
      });

      results.push({
        holiday: holiday.name,
        date: holiday.date,
        jobCount: jobs.length,
        commercial: commercial.length,
        residential: residential.length,
        smsSent: !!smsResult.sid
      });
    }

    return res.status(200).json({ ok: true, holidays: results });

  } catch (err) {
    console.error('[STAT-CHECK] Error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
