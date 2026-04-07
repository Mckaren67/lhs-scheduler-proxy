// 3:30 PM PT daily agenda email to Karen
// Sends a formatted email with tomorrow's schedule, priorities, and what Aria handles
// Uses Twilio SMS as delivery (Gmail OAuth not available on Vercel — email sent via scheduled task)

export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getOpenTasks, getOverdueTasks } from './task-store.js';
import { getCapacityData } from './capacity-check.js';

const KAREN_PHONE = '+16048009630';
const TIMEZONE = 'America/Vancouver';

// Stat holidays for advance warning
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

async function fetchTomorrowJobs() {
  try {
    const apiKey = process.env.HCP_API_KEY;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();
    const end = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59).toISOString();

    const response = await fetch(
      `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!response.ok) return { count: 0, jobs: [] };
    const data = await response.json();
    const jobs = (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
    return { count: jobs.length, jobs };
  } catch (e) {
    return { count: 0, jobs: [] };
  }
}

function getUpcomingHoliday() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const todayStr = now.toLocaleDateString('en-CA');
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 21);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  return STAT_HOLIDAYS.find(h => h.date >= todayStr && h.date <= cutoffStr) || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;
  if (!isVercelCron && !hasToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [tomorrowData, openTasks, overdue, capData] = await Promise.all([
      fetchTomorrowJobs(),
      getOpenTasks(),
      getOverdueTasks(),
      getCapacityData().catch(() => null)
    ]);

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE, weekday: 'long' });
    const tomorrowDate = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

    // Build the briefing
    let msg = `Our Tomorrow at LHS — ${tomorrowDay}, ${tomorrowDate} 📋\n\n`;

    // Schedule
    msg += `📅 ${tomorrowData.count} job${tomorrowData.count !== 1 ? 's' : ''} scheduled tomorrow\n`;

    // Top priorities
    const topTasks = openTasks.slice(0, 10);
    if (topTasks.length > 0) {
      msg += `\n🎯 Our top priorities:\n`;
      for (const t of topTasks.slice(0, 5)) {
        const dueFlag = t.due_date && t.due_date <= tomorrow.toLocaleDateString('en-CA') ? ' ⚠️' : '';
        msg += `• ${t.description}${dueFlag}\n`;
      }
      if (topTasks.length > 5) msg += `...and ${topTasks.length - 5} more\n`;
    }

    // What Aria handles
    const ariaHandled = openTasks.filter(t => t.assigned_to === 'aria');
    if (ariaHandled.length > 0) {
      msg += `\n🤖 I'll handle these automatically:\n`;
      for (const t of ariaHandled.slice(0, 3)) msg += `• ${t.description}\n`;
    }

    // Karen's attention needed
    if (overdue.length > 0) {
      msg += `\n⚠️ ${overdue.length} overdue item${overdue.length !== 1 ? 's' : ''} need your attention\n`;
    }

    // Capacity
    if (capData && capData.capacity >= 70) {
      const emoji = capData.capacity >= 90 ? '🔴' : capData.capacity >= 80 ? '🟠' : '🟡';
      msg += `\n${emoji} Workforce at ${capData.capacity}% capacity`;
      if (capData.trend !== 0) msg += ` (${capData.trend > 0 ? 'up' : 'down'} ${Math.abs(capData.trend)}% from last week)`;
      msg += '\n';
    }

    // Stat holiday warning
    const holiday = getUpcomingHoliday();
    if (holiday) {
      const daysUntil = Math.ceil((new Date(holiday.date) - now) / 86400000);
      msg += `\n📅 ${holiday.name} is ${daysUntil} days away (${holiday.date}). Want me to review the schedule?\n`;
    }

    // Estimated time saved
    const savedMin = ariaHandled.reduce((sum, t) => sum + (t.estimated_time_minutes || 15), 0) + 30; // base 30 min for briefings
    const savedStr = savedMin >= 60 ? `~${(savedMin / 60).toFixed(1)} hrs` : `~${savedMin} min`;
    msg += `\n⏱️ Estimated time I'm saving you tomorrow: ${savedStr}\n`;

    msg += `\nRest well tonight — I've got tomorrow covered! — Aria 🏠`;

    const result = await sendSMS(KAREN_PHONE, msg);
    console.log(`[AFTERNOON] Briefing sent:`, result.sid ? `SID ${result.sid}` : 'failed');

    return res.status(200).json({
      ok: true,
      tomorrowJobs: tomorrowData.count,
      openTasks: openTasks.length,
      overdue: overdue.length,
      messageSid: result.sid || null
    });

  } catch (err) {
    console.error('[AFTERNOON] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
