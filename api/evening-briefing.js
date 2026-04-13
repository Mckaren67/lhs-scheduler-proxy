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

    // Build the evening message
    let msg = `Good evening, Karen! 🌙\n\n`;

    // Completed today
    if (briefing.completedToday.length > 0) {
      msg += `Completed today: ${briefing.completedToday.length} task${briefing.completedToday.length !== 1 ? 's' : ''} ✅\n`;
      for (const t of briefing.completedToday.slice(0, 3)) {
        msg += `• ${t.description} ✓\n`;
      }
      if (briefing.completedToday.length > 3) {
        msg += `...and ${briefing.completedToday.length - 3} more\n`;
      }
    } else {
      msg += `No tasks completed today — fresh start tomorrow!\n`;
    }

    // Still open
    msg += `\nStill open: ${briefing.stillOpen.length} task${briefing.stillOpen.length !== 1 ? 's' : ''}\n`;

    // Tomorrow priorities
    if (briefing.tomorrowPriorities.length > 0) {
      msg += `\nTop priorities for tomorrow:\n`;
      for (const t of briefing.tomorrowPriorities.slice(0, 5)) {
        const overdue = t.due_date && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
        const flag = overdue ? ' (overdue!)' : '';
        msg += `• ${t.description}${flag}\n`;
      }
    }

    // Jobs summary
    msg += `\n${jobCount} job${jobCount !== 1 ? 's' : ''} on the schedule today.\n`;

    // Time saved
    if (briefing.estimatedMinutesSaved > 0) {
      const hrs = briefing.estimatedMinutesSaved / 60;
      const timeStr = hrs >= 1 ? `~${hrs.toFixed(1)} hrs` : `~${briefing.estimatedMinutesSaved} min`;
      msg += `Aria saved you ${timeStr} today! 🎉\n`;
    }

    msg += `\nRest up tonight — I've got the overnight covered! — Aria 🏠`;

    const result = await sendSMS(KAREN_PHONE, msg);
    console.log(`[EVENING] Briefing sent:`, result.sid ? `SID ${result.sid}` : 'failed');

    return res.status(200).json({
      ok: true,
      completedToday: briefing.completedToday.length,
      stillOpen: briefing.stillOpen.length,
      jobCount,
      messageSid: result.sid || null
    });

  } catch (err) {
    console.error('[EVENING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
