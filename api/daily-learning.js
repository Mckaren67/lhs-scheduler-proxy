// Daily Learning Review — runs at 7pm PT (2am UTC)
// Collects day's interactions, sends to Claude for analysis,
// texts Karen/Michael for approval, saves approved learnings

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const KAREN_PHONE = '+16048009630';
const TIMEZONE = 'America/Vancouver';
const KB = 'https://lhs-knowledge-base.vercel.app/api/save';

async function kbRead(key) {
  try { const r = await fetch(`${KB}?key=${key}`); const d = await r.json(); return d.value || []; }
  catch (e) { return []; }
}

async function kbWrite(key, val) {
  await fetch(KB, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: val }) });
}

async function sendSMS(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_PHONE_NUMBER;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return r.json();
}

async function buildEveningSummary(today, todayTasks, todayConvos) {
  const dayName = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

  // Fetch today's and tomorrow's job data
  let todayJobs = 0, tomorrowJobs = 0, firstJob = '';
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

    const resp = await fetch(`https://api.housecallpro.com/jobs?scheduled_start_min=${todayStart}&scheduled_start_max=${tomorrowEnd}&page_size=200`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } });
    if (resp.ok) {
      const data = await resp.json();
      const jobs = (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
      const tom = new Date(now); tom.setDate(tom.getDate() + 1);
      const tomStr = tom.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
      const tomDay = tom.toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric' });

      const tj = jobs.filter(j => j.schedule?.scheduled_start && new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) === todayStr);
      const tmj = jobs.filter(j => j.schedule?.scheduled_start && new Date(j.schedule.scheduled_start).toLocaleDateString('en-CA', { timeZone: TIMEZONE }) === tomStr);
      todayJobs = tj.length;
      tomorrowJobs = tmj.length;

      const completed = tj.filter(j => j.work_status === 'complete' || j.work_status === 'complete unrated').length;
      const inProgress = tj.filter(j => j.work_status === 'in progress').length;
      const cancelled = tj.filter(j => j.work_status === 'user canceled').length;

      // First job tomorrow
      const sorted = tmj.filter(j => j.work_status === 'scheduled').sort((a, b) => a.schedule.scheduled_start.localeCompare(b.schedule.scheduled_start));
      if (sorted.length > 0) {
        const fj = sorted[0];
        const client = `${fj.customer?.first_name || ''} ${fj.customer?.last_name || ''}`.trim();
        const cleaner = (fj.assigned_employees || []).map(e => `${e.first_name} ${e.last_name}`.trim()).join(' and ') || 'unassigned';
        const time = new Date(fj.schedule.scheduled_start).toLocaleTimeString('en-CA', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' });
        firstJob = `First job: ${time} — ${client} with ${cleaner}`;
      }

      // Build the summary
      const tasksCompleted = (Array.isArray(todayTasks) ? todayTasks : []).filter(t => t.status === 'completed').length;
      const pendingKaren = (Array.isArray(todayTasks) ? todayTasks : []).filter(t => t.status === 'open' && t.assigned_to === 'karen').length;

      let msg = `Good evening Karen! Here's your end of day wrap-up — ${dayName}, ${dateStr}:\n\n`;
      msg += `📋 TODAY'S SUMMARY:\n`;
      msg += `${completed} jobs completed | ${inProgress} in progress | ${cancelled} cancelled\n`;
      msg += `${tasksCompleted} tasks completed today\n`;
      msg += `\n⏰ TOMORROW — ${tomDay}:\n`;
      msg += `${tomorrowJobs} jobs scheduled\n`;
      if (firstJob) msg += `${firstJob}\n`;
      if (pendingKaren > 0) msg += `\n📌 PENDING FOR KAREN: ${pendingKaren} task${pendingKaren !== 1 ? 's' : ''} still open`;

      return msg;
    }
  } catch (e) {
    console.error('[DAILY-LEARNING] Evening summary HCP error:', e.message);
  }

  return `Good evening Karen! Here's your end of day wrap-up — ${dayName}, ${dateStr}:\n\n📋 TODAY'S SUMMARY:\nSchedule data unavailable for tonight's summary.`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;
  if (!isVercelCron && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  console.log(`[DAILY-LEARNING] Running for ${today}`);

  try {
    // Step 1: Collect today's interactions
    const [conversations, learnings, sickDays, tasks] = await Promise.all([
      kbRead('aria_memory_conversations'),
      kbRead('aria_memory_learnings'),
      kbRead('aria_sick_days'),
      kbRead('aria_tasks')
    ]);

    const todayConvos = conversations.filter(c => c.date === today);
    const todayLearnings = learnings.filter(l => l.date === today);
    const todaySick = (Array.isArray(sickDays) ? sickDays : []).filter(s => s.date === today);
    const todayTasks = (Array.isArray(tasks) ? tasks : []).filter(t =>
      (t.created_at && t.created_at.startsWith(today)) || (t.completed_at && t.completed_at.startsWith(today))
    );

    const summary = `Today's activity (${today}):
Conversations: ${todayConvos.length}
${todayConvos.map(c => `- ${c.contactName}: ${c.summary}`).join('\n')}

Learnings saved today: ${todayLearnings.length}
${todayLearnings.map(l => `- ${l.subject}: ${l.fact}`).join('\n')}

Sick days reported: ${todaySick.length}
${todaySick.map(s => `- ${s.cleanerName}: ${s.jobsAffected} jobs affected`).join('\n')}

Tasks created/completed today: ${todayTasks.length}
${todayTasks.slice(0, 10).map(t => `- [${t.status}] ${t.description}`).join('\n')}`;

    console.log(`[DAILY-LEARNING] Collected: ${todayConvos.length} convos, ${todayLearnings.length} learnings, ${todaySick.length} sick, ${todayTasks.length} tasks`);

    // Step 2: Send to Claude for analysis
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You are reviewing Aria's interactions for Lifestyle Home Service today. Extract key learnings that will make Aria smarter tomorrow.

Focus on:
1. CORRECTIONS — anything Aria got wrong and what is right
2. CLIENT DISCOVERIES — new preferences or personality notes
3. CLEANER DISCOVERIES — new availability, strengths or patterns
4. MANAGEMENT PATTERNS — how Karen or Michael made decisions
5. SCHEDULING PATTERNS — rhythms or recurring requests

Format each as a single line: CATEGORY | SUBJECT | LEARNING
Maximum 8 learnings. Only include genuinely new information.
If nothing new was learned today, say "NO_NEW_LEARNINGS".`,
        messages: [{ role: 'user', content: summary }]
      })
    });

    const claudeData = await claudeResp.json();
    const analysis = claudeData.content?.[0]?.text || 'NO_NEW_LEARNINGS';

    console.log(`[DAILY-LEARNING] Claude analysis: ${analysis.substring(0, 200)}`);

    if (analysis.includes('NO_NEW_LEARNINGS') || analysis.trim().length < 20) {
      // Nothing new — still update morning context with date
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
      await kbWrite('aria_morning_context', {
        date: today, tomorrow: tomorrowStr,
        learnings: [], pending_corrections: [],
        updated_at: new Date().toISOString()
      });

      const eveningSummary = await buildEveningSummary(today, todayTasks, todayConvos);
      await sendSMS(KAREN_PHONE, eveningSummary + `\n\n🧠 WHAT I LEARNED TODAY:\nNo new corrections today.\n\n— Aria 🏠`);
      return res.status(200).json({ ok: true, learnings: 0, message: 'No new learnings today' });
    }

    // Parse learnings
    const parsedLearnings = analysis.split('\n')
      .filter(l => l.includes('|'))
      .map((l, i) => {
        const parts = l.split('|').map(p => p.trim());
        return { id: i + 1, category: parts[0] || '', subject: parts[1] || '', learning: parts[2] || '', raw: l };
      })
      .filter(l => l.learning.length > 5);

    // Save as pending
    await kbWrite('aria_pending_learnings', { date: today, learnings: parsedLearnings, status: 'pending' });

    // Step 3: Build evening summary + learnings
    const eveningSummary = await buildEveningSummary(today, todayTasks, todayConvos);

    let smsText = eveningSummary;
    smsText += `\n\n🧠 WHAT I LEARNED TODAY:\n`;
    for (const l of parsedLearnings) {
      smsText += `${l.id}. ${l.learning}\n`;
    }
    smsText += `\nReply CONFIRM to save all.\nReply a NUMBER to correct one.\nReply SKIP to discard.\n— Aria 🏠`;

    const smsResult = await sendSMS(KAREN_PHONE, smsText);
    console.log(`[DAILY-LEARNING] SMS sent: ${smsResult.sid ? 'OK' : 'FAILED'}`);

    // Step 6: Update morning context
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    // Get recent learnings for context
    const recentLearnings = learnings.slice(-20).map(l => `${l.subject}: ${l.fact}`);

    await kbWrite('aria_morning_context', {
      date: today,
      tomorrow: tomorrowStr,
      learnings: recentLearnings.slice(-10),
      pending_learnings: parsedLearnings,
      pending_corrections: [],
      updated_at: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true,
      learnings: parsedLearnings.length,
      analysis,
      smsSent: !!smsResult.sid,
      smsText
    });

  } catch (err) {
    console.error('[DAILY-LEARNING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
