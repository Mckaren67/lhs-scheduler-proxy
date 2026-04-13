// Voice data endpoint for ElevenLabs agent tools
// THREE-TIER CACHE: 1) in-memory (instant) 2) KB save.js 3) live HCP fetch
// live_data action is PUBLIC — no auth. ElevenLabs calls without headers.

export const config = { api: { bodyParser: true }, maxDuration: 15 };

const TIMEZONE = 'America/Vancouver';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const KB_KEY = 'aria_voice_cache';

// ─── In-memory cache (survives across warm invocations) ─────────────────────
let memCache = null;
let memCacheAge = 0;
const MEM_TTL = 10 * 60 * 1000; // 10 minutes

function nowPT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

// ─── Build schedule text from HCP jobs ──────────────────────────────────────
function formatSchedule(todayJobs, tomorrowJobs, cleanerRoster, todayStr, tomorrowStr) {
  function formatDay(jobs, label) {
    if (jobs.length === 0) return `${label}: No jobs scheduled.\n`;
    const ip = jobs.filter(j => j.work_status === 'in progress' || j.work_timestamps?.started_at).length;
    const sc = jobs.filter(j => j.work_status === 'scheduled' && !j.work_timestamps?.started_at).length;
    const co = jobs.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated').length;
    let t = `${label}: ${jobs.length} jobs.`;
    if (ip) t += ` ${ip} in progress.`;
    if (sc) t += ` ${sc} scheduled.`;
    if (co) t += ` ${co} completed.`;
    t += '\n';
    for (const job of jobs) {
      const client = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown';
      const emps = (job.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim());
      const assigned = emps.length > 0 ? emps.join(' and ') : 'NO CLEANER ASSIGNED';
      const time = job.schedule?.scheduled_start
        ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
        : 'no time';
      const addr = job.address?.street || '';
      const city = job.address?.city || '';
      t += `- ${client} at ${time}, ${addr}${city ? ', ' + city : ''}, assigned to ${assigned}, ${job.work_status || 'scheduled'}.\n`;
    }
    return t;
  }

  let text = formatDay(todayJobs, `TODAY (${todayStr})`) + '\n' + formatDay(tomorrowJobs, `TOMORROW (${tomorrowStr})`);
  text += '\nACTIVE CLEANER ROSTER (these are the ONLY employees — never invent names):\n';
  for (const c of cleanerRoster) {
    text += `- ${c.name} — works ${c.days.join(', ')}`;
    if (c.availability_note) text += ` (${c.availability_note})`;
    text += '\n';
  }
  return text;
}

// ─── Fetch fresh data from HCP + KB ────────────────────────────────────────
async function fetchFreshSchedule() {
  const apiKey = process.env.HCP_API_KEY;
  const hcpHeaders = { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' };
  const now = nowPT();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tomorrowEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59).toISOString();

  console.log(`[VOICE-DATA] Fetching fresh from HCP: ${todayStr} to ${tomorrowStr}`);

  const [jobsResp, clientsResp] = await Promise.all([
    fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${todayStart}&scheduled_start_max=${tomorrowEnd}&page_size=200`, { headers: hcpHeaders }),
    fetch('https://lhs-knowledge-base.vercel.app/api/clients').catch(() => null)
  ]);

  const allJobs = jobsResp.ok
    ? ((await jobsResp.json()).jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at)
    : [];

  let cleanerRoster = [];
  if (clientsResp?.ok) {
    const cd = await clientsResp.json();
    cleanerRoster = (cd.cleaners || []).filter(c => c.days && c.days.length > 0);
  }

  const todayJobs = allJobs.filter(j => {
    const d = j.schedule?.scheduled_start ? new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) : null;
    return d === todayStr;
  });
  const tomorrowJobs = allJobs.filter(j => {
    const d = j.schedule?.scheduled_start ? new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) : null;
    return d === tomorrowStr;
  });

  const schedule = formatSchedule(todayJobs, tomorrowJobs, cleanerRoster, todayStr, tomorrowStr);

  const result = {
    schedule,
    todayDate: todayStr,
    tomorrowDate: tomorrowStr,
    todayJobCount: todayJobs.length,
    tomorrowJobCount: tomorrowJobs.length,
    cleanerCount: cleanerRoster.length,
    cachedAt: new Date().toISOString()
  };

  // Save to memory
  memCache = result;
  memCacheAge = Date.now();

  // Save to KB (fire and forget — don't block response)
  fetch(KB_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KB_KEY, value: result })
  }).catch(() => {});

  console.log(`[VOICE-DATA] Fresh data: ${todayJobs.length} today, ${tomorrowJobs.length} tomorrow, ${cleanerRoster.length} cleaners`);
  return result;
}

// ─── Get cached data — three-tier fallback ──────────────────────────────────
async function getScheduleData() {
  // Tier 1: In-memory cache (instant — same Vercel instance)
  if (memCache && (Date.now() - memCacheAge) < MEM_TTL) {
    console.log('[VOICE-DATA] Tier 1: memory cache hit');
    return memCache;
  }

  // Tier 2: KB save.js cache
  try {
    const resp = await fetch(`${KB_SAVE_URL}?key=${KB_KEY}`);
    const data = await resp.json();
    if (data.value && data.value.schedule) {
      console.log('[VOICE-DATA] Tier 2: KB cache hit');
      memCache = data.value;
      memCacheAge = Date.now();
      return data.value;
    }
  } catch (e) {
    console.log('[VOICE-DATA] Tier 2: KB read failed');
  }

  // Tier 3: Live HCP fetch (slow but guaranteed accurate)
  console.log('[VOICE-DATA] Tier 3: fetching from HCP directly');
  return await fetchFreshSchedule();
}

// ─── HTTP Handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // live_data is PUBLIC — ElevenLabs calls without auth
  if (action !== 'live_data' && action) {
    const authHeader = req.headers.authorization || '';
    if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    if (action === 'live_data' || !action) {
      const data = await getScheduleData();
      return res.status(200).json({
        schedule: data.schedule,
        todayJobCount: data.todayJobCount || 0,
        tomorrowJobCount: data.tomorrowJobCount || 0,
        cleanerCount: data.cleanerCount || 0,
        cachedAt: data.cachedAt,
        timestamp: new Date().toLocaleString('en-CA', { timeZone: TIMEZONE })
      });
    }

    if (action === 'caller_history') {
      const { getCallerHistory } = await import('./aria-memory.js');
      const phone = req.query.phone || req.body?.phone || '';
      const history = await getCallerHistory(phone, 5);
      if (history.length === 0) return res.status(200).json({ text: 'No previous conversations found with this caller.' });
      let text = `I found ${history.length} previous conversation${history.length !== 1 ? 's' : ''} with this caller:\n`;
      for (const c of history) { text += `On ${c.date}: ${c.summary}${c.actionTaken ? ' Action: ' + c.actionTaken + '.' : ''}\n`; }
      return res.status(200).json({ text, history });
    }

    if (action === 'save_learning' && req.method === 'POST') {
      const { saveLearning } = await import('./aria-memory.js');
      const entry = await saveLearning(req.body);
      return res.status(201).json({ text: `Got it, I've noted that down about ${entry.subject}.`, entry });
    }

    if (action === 'search_knowledge') {
      const { searchLearnings } = await import('./aria-memory.js');
      const q = req.query.q || req.body?.q || '';
      const results = await searchLearnings(q, 5);
      if (results.length === 0) return res.status(200).json({ text: `I don't have any specific notes about "${q}" yet.` });
      let text = `Here's what I know about "${q}":\n`;
      for (const l of results) text += `${l.date}: ${l.fact}\n`;
      return res.status(200).json({ text, results });
    }

    if (action === 'task_list') {
      const { getOpenTasks, getOverdueTasks } = await import('./_task-store.js');
      const tasks = await getOpenTasks();
      const overdue = await getOverdueTasks();
      if (tasks.length === 0) return res.status(200).json({ text: 'No open tasks right now. Your slate is clean!' });
      let text = `Karen has ${tasks.length} open task${tasks.length !== 1 ? 's' : ''}.`;
      if (overdue.length > 0) text += ` ${overdue.length} overdue!`;
      text += '\n\nTop priorities:\n';
      for (const t of tasks.slice(0, 8)) {
        const flag = t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }) ? ' OVERDUE' : '';
        text += `• ${t.description}${t.due_date ? ' (due ' + t.due_date + ')' : ''}${flag}\n`;
      }
      return res.status(200).json({ text, total: tasks.length, overdueCount: overdue.length });
    }

    if (action === 'capacity') {
      try {
        const { getCapacityData } = await import('./capacity-check.js');
        const cap = await getCapacityData();
        const trendStr = cap.trend > 0 ? `up ${cap.trend}%` : cap.trend < 0 ? `down ${Math.abs(cap.trend)}%` : 'flat';
        let text = `Workforce at ${cap.capacity}% capacity. ${cap.bookedHours}h booked of ${cap.availableHours}h. Trend: ${trendStr}.`;
        if (cap.capacity >= 90) text += ' Urgent — hire immediately.';
        else if (cap.capacity >= 80) text += ' Recommend starting hiring.';
        return res.status(200).json({ text, ...cap });
      } catch (e) { return res.status(200).json({ text: 'Could not load capacity data.' }); }
    }

    if (action === 'add_task' && req.method === 'POST') {
      const { saveTask } = await import('./_task-store.js');
      const task = await saveTask({ description: req.body.description || 'Task from voice', priority: req.body.priority || 'medium', category: req.body.category || 'administrative', due_date: req.body.due_date || null, assigned_to: 'karen', source_message: 'Voice conversation' });
      return res.status(201).json({ text: `Got it! Saved "${task.description}".`, task });
    }

    return res.status(400).json({ error: 'Use: live_data, task_list, capacity, caller_history, save_learning, add_task' });
  } catch (err) {
    console.error('[VOICE-DATA] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
