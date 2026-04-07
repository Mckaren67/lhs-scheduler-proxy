export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getMorningBriefingData } from './task-store.js';

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
    console.error('[MORNING] HCP fetch error:', err.message);
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
    // Fetch data in parallel
    const [briefing, jobCount] = await Promise.all([
      getMorningBriefingData(),
      fetchTodayJobCount()
    ]);

    const now = new Date();
    const dayName = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', month: 'long', day: 'numeric' });

    // Build the morning message
    let msg = `Good morning, Karen! ☀️ Happy ${dayName}, ${dateStr}.\n\n`;
    msg += `${jobCount} job${jobCount !== 1 ? 's' : ''} on the schedule today.\n`;

    if (briefing.overdueCount > 0) {
      msg += `⚠️ ${briefing.overdueCount} overdue task${briefing.overdueCount !== 1 ? 's' : ''} need attention.\n`;
    }

    if (briefing.topFollowUps.length > 0) {
      msg += `\nTop follow-ups:\n`;
      for (const t of briefing.topFollowUps.slice(0, 3)) {
        const due = t.due_date ? ` (${t.due_date})` : '';
        msg += `• ${t.description}${due}\n`;
      }
    }

    if (briefing.delegatedToAria.length > 0) {
      msg += `\nAria is handling ${briefing.delegatedToAria.length} task${briefing.delegatedToAria.length !== 1 ? 's' : ''} for you today.\n`;
    }

    if (briefing.estimatedMinutesSaved > 0) {
      const hrs = Math.floor(briefing.estimatedMinutesSaved / 60);
      const mins = briefing.estimatedMinutesSaved % 60;
      const timeStr = hrs > 0 ? `~${hrs}h ${mins}m` : `~${mins} min`;
      msg += `Estimated time saved: ${timeStr} ⏱️\n`;
    }

    msg += `\nHave a great day! — Aria 🏠`;

    const result = await sendSMS(KAREN_PHONE, msg);
    console.log(`[MORNING] Briefing sent:`, result.sid ? `SID ${result.sid}` : 'failed');

    return res.status(200).json({
      ok: true,
      jobCount,
      openTasks: briefing.openCount,
      overdue: briefing.overdueCount,
      messageSid: result.sid || null
    });

  } catch (err) {
    console.error('[MORNING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
