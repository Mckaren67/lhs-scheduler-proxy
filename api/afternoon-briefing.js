// 3:30 PM PT daily agenda email + SMS to Karen
// Sends a formatted HTML email via Gmail API AND an SMS summary via Twilio

export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getOpenTasks, getOverdueTasks } from './_task-store.js';
import { getCapacityData } from './capacity-check.js';
import { sendEmail } from './aria-email.js';

const KAREN_PHONE = '+16048009630';
const KAREN_EMAIL = process.env.GMAIL_USER_EMAIL || 'karen@lifestylehomeservice.com';
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
    console.log(`[AFTERNOON] SMS sent:`, result.sid ? `SID ${result.sid}` : 'failed');

    // Also send a formatted HTML email
    let emailSent = false;
    try {
      const topTasks5 = openTasks.slice(0, 5);
      const htmlBody = `
<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1a1a18">
  <div style="background:#2d6a4f;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
    <h1 style="margin:0;font-size:22px">Our Tomorrow at LHS</h1>
    <p style="margin:4px 0 0;opacity:0.8;font-size:14px">${tomorrowDay}, ${tomorrowDate}</p>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e0e0dc;border-top:0;border-radius:0 0 10px 10px">
    <h3 style="color:#2d6a4f;margin:0 0 8px">📅 Schedule</h3>
    <p>${tomorrowData.count} job${tomorrowData.count !== 1 ? 's' : ''} scheduled tomorrow</p>

    ${topTasks5.length > 0 ? `
    <h3 style="color:#2d6a4f;margin:16px 0 8px">🎯 Our Top Priorities</h3>
    <ul style="padding-left:20px">
      ${topTasks5.map(t => `<li>${t.description}${t.due_date ? ` <span style="color:#9b9b98;font-size:12px">(${t.due_date})</span>` : ''}</li>`).join('')}
    </ul>` : ''}

    ${overdue.length > 0 ? `
    <h3 style="color:#c0392b;margin:16px 0 8px">⚠️ Overdue</h3>
    <p>${overdue.length} item${overdue.length !== 1 ? 's' : ''} need attention</p>` : ''}

    ${capData && capData.capacity >= 70 ? `
    <h3 style="color:#b5631a;margin:16px 0 8px">📊 Capacity</h3>
    <p>Workforce at ${capData.capacity}%${capData.trend !== 0 ? ` (${capData.trend > 0 ? 'up' : 'down'} ${Math.abs(capData.trend)}% from last week)` : ''}</p>` : ''}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0dc;color:#6b6b68;font-size:13px">
      <p>Rest well tonight — I've got tomorrow covered! 🏠</p>
      <p style="margin-top:8px">— Aria, your LHS scheduling partner</p>
    </div>
  </div>
</div>`;

      await sendEmail({
        to: KAREN_EMAIL,
        subject: `Our Tomorrow at LHS — ${tomorrowDay}, ${tomorrowDate}`,
        body: htmlBody,
        isHtml: true
      });
      emailSent = true;
      console.log('[AFTERNOON] Email sent to Karen');
    } catch (emailErr) {
      console.error('[AFTERNOON] Email failed:', emailErr.message);
    }

    return res.status(200).json({
      ok: true,
      tomorrowJobs: tomorrowData.count,
      openTasks: openTasks.length,
      overdue: overdue.length,
      messageSid: result.sid || null,
      emailSent
    });

  } catch (err) {
    console.error('[AFTERNOON] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
