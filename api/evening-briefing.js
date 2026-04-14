export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getEveningBriefingData } from './_task-client.js';

const KAREN_PHONE = '+16048009630';

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

async function fetchTodayJobCount() {
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const response = await fetch(
      `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=1`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!response.ok) return 0;
    const data = await response.json();
    return data.total_items || 0;
  } catch (err) {
    console.error('[EVENING] HCP fetch error:', err.message);
    return 0;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth: accept Vercel cron header OR bearer token
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;

  if (!isVercelCron && !hasToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [briefing, jobCount] = await Promise.all([
      getEveningBriefingData(),
      fetchTodayJobCount()
    ]);

    // Fetch per-contributor stats
    const stats = briefing.ariaImpact || {};
    const contributors = briefing.contributors || {};
    const aiValue = briefing.aiValue || {};
    const todayStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/Vancouver', weekday: 'long', month: 'long', day: 'numeric' });

    // Build contributor lines
    function fmtMin(m) { return m >= 60 ? `~${(m/60).toFixed(1)} hrs` : `~${m} min`; }
    const kS = contributors.karen || {};
    const mS = contributors.michael || {};
    const aS = contributors.aria || {};
    const cS = contributors.claude || {};

    let taskLines = '';
    if (kS.completedToday) taskLines += `Karen: ${kS.completedToday} tasks — approx. ${kS.minutesToday} min\n`;
    if (mS.completedToday) taskLines += `Michael: ${mS.completedToday} tasks — approx. ${mS.minutesToday} min\n`;
    if (aS.completedToday) taskLines += `Aria: ${aS.completedToday} tasks — saved ${fmtMin(aS.minutesToday)}\n`;
    if (cS.completedToday) taskLines += `Claude: ${cS.completedToday} tasks — saved ${fmtMin(cS.minutesToday)}\n`;
    if (!taskLines) taskLines = 'No tasks completed today — fresh start tomorrow!\n';

    const aiDollars = aiValue.dollarsToday || 0;

    // Pending urgent tasks
    const open = briefing.stillOpen || 0;
    const urgent = (briefing.tomorrowPriorities || []).slice(0, 3);

    // Karen's priorities for tomorrow
    const karenTomorrow = (briefing.tomorrowPriorities || []).filter(t => t.assigned_to === 'karen').slice(0, 3);

    let msg = `Good evening NAME!\nLHS wrap-up for ${todayStr}:\n\n`;
    msg += `TASKS TODAY:\n${taskLines}`;
    if (aiDollars > 0) msg += `AI value today: $${aiDollars} at $25/hr\n`;
    msg += `\n${jobCount} jobs on schedule today.\n`;

    if (urgent.length > 0) {
      msg += `\nSTILL PENDING:\n`;
      for (const t of urgent) {
        const overdue = t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
        msg += `• ${t.description}${overdue ? ' (overdue!)' : ''}\n`;
      }
    }

    if (karenTomorrow.length > 0) {
      msg += `\nKAREN'S PRIORITIES TOMORROW:\n`;
      for (const t of karenTomorrow) msg += `• ${t.description}\n`;
    }

    msg += `\n— Aria 🏠`;

    // Send to both Karen and Michael with personalized greeting
    const MICHAEL_PHONE = '+16046180336';
    const [karenResult, michaelResult] = await Promise.all([
      sendSMS(KAREN_PHONE, msg.replace('NAME', 'Karen')),
      sendSMS(MICHAEL_PHONE, msg.replace('NAME', 'Michael'))
    ]);
    console.log(`[EVENING] Karen:`, karenResult.sid ? `SID ${karenResult.sid}` : 'failed');
    console.log(`[EVENING] Michael:`, michaelResult.sid ? `SID ${michaelResult.sid}` : 'failed');

    return res.status(200).json({
      ok: true,
      completedToday: briefing.completedToday.length,
      stillOpen: briefing.stillOpen.length,
      jobCount,
      karenSid: karenResult.sid || null,
      michaelSid: michaelResult.sid || null
    });

  } catch (err) {
    console.error('[EVENING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
