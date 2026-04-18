// 3:30 PM PT daily agenda email + SMS to Karen
// Sends a formatted HTML email via Gmail API AND an SMS summary via Twilio

export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getOpenTasks, getOverdueTasks } from './_task-client.js';
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

// ─── Email rendering — The Bridge design system ─────────────────────────────
// Colors (The Bridge):
//   Header blue:    #2563EB   |  Page bg:       #F8F9FA
//   Card bg:        #FFFFFF   |  Body text:     #111827
//   Secondary:      #6B7280   |  Border:        #E5E7EB
//   Accent green:   #16A34A   |  Accent red:    #DC2626
//   Accent amber:   #D97706
// All special characters are HTML entities to avoid any charset ambiguity.

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatJobForEmail(job) {
  const client = `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() || 'Unknown client';
  const emps = (job.assigned_employees || []).map(e => `${e.first_name || ''} ${e.last_name || ''}`.trim()).filter(Boolean);
  const cleaner = emps.length > 0 ? emps.join(' &amp; ') : null;
  const time = job.schedule?.scheduled_start
    ? new Date(job.schedule.scheduled_start).toLocaleTimeString('en-CA', {
        timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true
      }).toUpperCase()
    : 'Time TBD';
  const street = job.address?.street || '';
  const city = job.address?.city || '';
  const address = street ? `${street}${city ? ', ' + city : ''}` : '';
  return { time, client: escapeHtml(client), cleaner, address: escapeHtml(address), unassigned: !cleaner };
}

function renderJobCard(job) {
  const cleanerLine = job.unassigned
    ? `<span style="color:#DC2626;font-weight:600;">NO CLEANER ASSIGNED</span>`
    : `<span style="color:#111827;">Cleaner: <strong>${job.cleaner}</strong></span>`;
  const addressLine = job.address
    ? `<div style="font-size:13px;color:#6B7280;margin-top:6px;">${job.address}</div>`
    : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8F9FA;border:1px solid #E5E7EB;border-radius:12px;margin:0 0 12px 0;">
    <tr>
      <td style="padding:14px 16px;">
        <div style="font-size:15px;font-weight:600;color:#111827;letter-spacing:0.2px;">
          ${escapeHtml(job.time)} &mdash; ${job.client}
        </div>
        <div style="font-size:13px;margin-top:6px;">${cleanerLine}</div>
        ${addressLine}
      </td>
    </tr>
  </table>`;
}

function renderFlagsSection(flags) {
  if (flags.length === 0) return '';
  const items = flags.map(f => `<li style="margin:4px 0;">${f}</li>`).join('');
  return `
  <tr>
    <td style="padding:4px 28px 16px 28px;">
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:12px;padding:14px 16px;">
        <div style="font-weight:700;color:#92400E;margin-bottom:6px;font-size:14px;letter-spacing:0.4px;text-transform:uppercase;">
          &#9888;&#65039; Flags &amp; Attention
        </div>
        <ul style="margin:0;padding-left:20px;color:#92400E;font-size:14px;line-height:1.5;">
          ${items}
        </ul>
      </div>
    </td>
  </tr>`;
}

function renderBriefingEmail({ tomorrowDay, tomorrowDate, jobs, openTasks, overdue, capData, holiday }) {
  const jobList = (jobs || []).map(formatJobForEmail);
  const count = jobList.length;

  // Build flags
  const flags = [];
  const unassigned = jobList.filter(j => j.unassigned);
  if (unassigned.length > 0) {
    flags.push(`<strong>${unassigned.length}</strong> unassigned job${unassigned.length !== 1 ? 's' : ''} &mdash; needs a cleaner before the morning.`);
  }
  if (overdue && overdue.length > 0) {
    flags.push(`<strong>${overdue.length}</strong> overdue task${overdue.length !== 1 ? 's' : ''} in your list.`);
  }
  if (capData && capData.capacity >= 90) {
    flags.push(`Workforce at <strong>${capData.capacity}%</strong> capacity &mdash; urgent, consider hiring.`);
  } else if (capData && capData.capacity >= 80) {
    flags.push(`Workforce at <strong>${capData.capacity}%</strong> capacity &mdash; watch closely.`);
  }
  if (holiday) {
    const daysUntil = Math.ceil((new Date(holiday.date) - new Date()) / 86400000);
    flags.push(`${escapeHtml(holiday.name)} is <strong>${daysUntil}</strong> day${daysUntil !== 1 ? 's' : ''} away (${holiday.date}).`);
  }

  // Jobs section
  const jobsHtml = count === 0
    ? `<p style="margin:0;color:#6B7280;font-size:14px;font-style:italic;">No jobs scheduled tomorrow &mdash; enjoy the quiet day.</p>`
    : jobList.map(renderJobCard).join('');

  // Top priorities (from open tasks)
  const top = (openTasks || []).slice(0, 5);
  const prioritiesHtml = top.length === 0 ? '' : `
  <tr>
    <td style="padding:4px 28px 8px 28px;">
      <h2 style="margin:0 0 12px 0;font-size:13px;color:#111827;text-transform:uppercase;letter-spacing:0.6px;">Top Priorities</h2>
      <ul style="margin:0 0 4px 0;padding-left:20px;color:#111827;font-size:14px;line-height:1.6;">
        ${top.map(t => {
          const due = t.due_date ? ` <span style="color:#6B7280;font-size:12px;">(due ${escapeHtml(t.due_date)})</span>` : '';
          return `<li>${escapeHtml(t.description)}${due}</li>`;
        }).join('')}
      </ul>
    </td>
  </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your Tomorrow at LHS</title>
</head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8F9FA;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="background:#2563EB;padding:24px 28px;text-align:center;">
              <div style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:0.3px;">Lifestyle Home Service</div>
              <div style="color:#BFDBFE;font-size:13px;margin-top:4px;letter-spacing:0.4px;">Powered by Aria</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 4px 28px;">
              <h1 style="margin:0;font-size:24px;color:#111827;font-weight:700;letter-spacing:-0.2px;">Your Tomorrow at LHS</h1>
              <p style="margin:6px 0 0 0;color:#6B7280;font-size:14px;">${escapeHtml(tomorrowDay)}, ${escapeHtml(tomorrowDate)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <h2 style="margin:0 0 12px 0;font-size:13px;color:#111827;text-transform:uppercase;letter-spacing:0.6px;">Schedule</h2>
              <p style="margin:0 0 14px 0;color:#6B7280;font-size:14px;">
                <strong style="color:#16A34A;">${count}</strong> job${count !== 1 ? 's' : ''} scheduled
              </p>
              ${jobsHtml}
            </td>
          </tr>
          ${renderFlagsSection(flags)}
          ${prioritiesHtml}
          <tr>
            <td style="padding:20px 28px 28px 28px;border-top:1px solid #E5E7EB;">
              <p style="margin:0;color:#111827;font-size:15px;line-height:1.5;">Rest well tonight &mdash; Aria has tomorrow covered.</p>
              <p style="margin:12px 0 0 0;color:#6B7280;font-size:13px;">
                &mdash; Aria, your LHS scheduling partner
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:600px;color:#6B7280;font-size:12px;text-align:center;margin:16px auto 0 auto;">
          Automated briefing &middot; Lifestyle Home Service
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
      const htmlBody = renderBriefingEmail({
        tomorrowDay,
        tomorrowDate,
        jobs: tomorrowData.jobs,
        openTasks,
        overdue,
        capData,
        holiday
      });

      await sendEmail({
        to: KAREN_EMAIL,
        subject: `Your Tomorrow at LHS — ${tomorrowDay}, ${tomorrowDate}`,
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
