// Voice cache builder — runs every 10 min via Vercel cron
// Does the slow HCP fetch in the background so voice-data.js responds instantly

export const config = { api: { bodyParser: false }, maxDuration: 25 };

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const KB_KEY = 'aria_voice_cache';
const TIMEZONE = 'America/Vancouver';

function nowPT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;
  if (!isVercelCron && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const apiKey = process.env.HCP_API_KEY;
    const hcpHeaders = { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' };
    const now = nowPT();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    // UTC boundaries for HCP queries
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59).toISOString();

    console.log(`[VOICE-CACHE] Building cache. Today: ${todayStr}, Tomorrow: ${tomorrowStr}`);
    console.log(`[VOICE-CACHE] HCP range: ${todayStart} to ${tomorrowEnd}`);

    // Fetch jobs + cleaners in parallel
    const [jobsResp, clientsResp] = await Promise.all([
      fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${todayStart}&scheduled_start_max=${tomorrowEnd}&page_size=200`, { headers: hcpHeaders }),
      fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
    ]);

    const allJobs = jobsResp.ok
      ? ((await jobsResp.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at)
      : [];

    // Cleaner roster from KB
    let cleanerRoster = [];
    if (clientsResp?.ok) {
      const cd = await clientsResp.json();
      cleanerRoster = (cd.cleaners || []).filter(c => c.days && c.days.length > 0);
    }

    // Split into today and tomorrow
    const todayJobs = [];
    const tomorrowJobs = [];
    for (const job of allJobs) {
      const jobDate = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE })
        : null;
      if (jobDate === todayStr) todayJobs.push(job);
      else if (jobDate === tomorrowStr) tomorrowJobs.push(job);
    }

    // Pre-format jobs into plain text for instant voice responses
    function formatJobs(jobs, label) {
      if (jobs.length === 0) return `${label}: No jobs scheduled.\n`;

      const inProgress = jobs.filter(j => j.work_status === 'in progress' || j.work_timestamps?.started_at).length;
      const scheduled = jobs.filter(j => j.work_status === 'scheduled' && !j.work_timestamps?.started_at).length;
      const completed = jobs.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated').length;
      const unassigned = jobs.filter(j => !j.assigned_employees || j.assigned_employees.length === 0).length;

      let text = `${label}: ${jobs.length} jobs.`;
      if (inProgress) text += ` ${inProgress} in progress.`;
      if (scheduled) text += ` ${scheduled} scheduled.`;
      if (completed) text += ` ${completed} completed.`;
      if (unassigned) text += ` WARNING: ${unassigned} UNASSIGNED!`;
      text += '\n';

      for (const job of jobs) {
        const client = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown';
        const emps = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim());
        const assigned = emps.length > 0 ? emps.join(' and ') : 'NO CLEANER ASSIGNED';
        const time = job.schedule?.scheduled_start
          ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
          : 'no time';
        const addr = job.address?.street || '';
        const city = job.address?.city || '';
        const status = job.work_status || 'scheduled';
        text += `- ${client} at ${time}, ${addr}${city ? ', ' + city : ''}, assigned to ${assigned}, ${status}.\n`;
      }
      return text;
    }

    let rosterText = '\nACTIVE CLEANER ROSTER (these are the ONLY employees — never invent names):\n';
    for (const c of cleanerRoster) {
      rosterText += `- ${c.name} — works ${c.days.join(', ')}`;
      if (c.availability_note) rosterText += ` (${c.availability_note})`;
      rosterText += '\n';
    }

    const scheduleText = formatJobs(todayJobs, `TODAY (${todayStr})`) + '\n' + formatJobs(tomorrowJobs, `TOMORROW (${tomorrowStr})`) + rosterText;

    // Save to KB
    const cache = {
      schedule: scheduleText,
      todayDate: todayStr,
      tomorrowDate: tomorrowStr,
      todayJobCount: todayJobs.length,
      tomorrowJobCount: tomorrowJobs.length,
      cleanerCount: cleanerRoster.length,
      cachedAt: new Date().toISOString()
    };

    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: KB_KEY, value: cache })
    });

    console.log(`[VOICE-CACHE] Cache saved: ${todayJobs.length} today, ${tomorrowJobs.length} tomorrow, ${cleanerRoster.length} cleaners`);

    // Ping voice-brain.js to keep it warm and pre-load cache into its memory
    fetch('https://lhs-scheduler-proxy.vercel.app/api/voice-brain', { method: 'GET' }).catch(() => {});

    return res.status(200).json({
      ok: true,
      todayDate: todayStr,
      tomorrowDate: tomorrowStr,
      todayJobs: todayJobs.length,
      tomorrowJobs: tomorrowJobs.length,
      cleaners: cleanerRoster.length,
      cachedAt: cache.cachedAt
    });

  } catch (err) {
    console.error('[VOICE-CACHE] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
