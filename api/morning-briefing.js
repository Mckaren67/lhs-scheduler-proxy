export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { getMorningBriefingData } from './task-store.js';
import { getCapacityData } from './capacity-check.js';
import { getSickDayBriefing } from './sick-day-log.js';
import { makeCall } from './aria-call.js';

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

    // Capacity — daily if 70%+, Mondays always
    try {
      const cap = await getCapacityData();
      if (cap.capacity >= 70 || dayName === 'Monday') {
        const trendStr = cap.trend > 0 ? `up ${cap.trend}%` : cap.trend < 0 ? `down ${Math.abs(cap.trend)}%` : 'flat';
        if (cap.capacity >= 90) {
          msg += `\n🔴 URGENT: Workforce at ${cap.capacity}% — we need to hire immediately!\n`;
        } else if (cap.capacity >= 80) {
          msg += `\n🟠 Workforce at ${cap.capacity}% — I recommend starting hiring this week.\n`;
        } else if (cap.capacity >= 70) {
          msg += `\n🟡 Workforce at ${cap.capacity}% — good time to think about hiring.\n`;
        } else {
          msg += `\n📊 Workforce: ${cap.capacity}% capacity (${trendStr})\n`;
        }
      }
    } catch (err) {
      console.error('[MORNING] Capacity check error:', err.message);
    }

    // Stat holiday advance warning (3 weeks)
    const STAT_HOLIDAYS = [
      { date: '2026-05-18', name: 'Victoria Day' }, { date: '2026-06-21', name: 'Indigenous Peoples Day' },
      { date: '2026-07-01', name: 'Canada Day' }, { date: '2026-08-03', name: 'BC Day' },
      { date: '2026-09-07', name: 'Labour Day' }, { date: '2026-09-30', name: 'Truth & Reconciliation' },
      { date: '2026-10-12', name: 'Thanksgiving' }, { date: '2026-11-11', name: 'Remembrance Day' },
      { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-26', name: 'Boxing Day' }
    ];
    const todayISO = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
    const cutoff21 = new Date(now); cutoff21.setDate(cutoff21.getDate() + 21);
    const upcoming = STAT_HOLIDAYS.find(h => h.date >= todayISO && h.date <= cutoff21.toISOString().split('T')[0]);
    if (upcoming) {
      const daysUntil = Math.ceil((new Date(upcoming.date) - now) / 86400000);
      msg += `\n📅 ${upcoming.name} is ${daysUntil} days away (${upcoming.date}). Want me to review the schedule?\n`;
    }

    // Sick day pattern alerts (Mondays especially)
    if (dayName === 'Monday') {
      try {
        const sickBriefing = await getSickDayBriefing();
        if (sickBriefing.patternAlerts.length > 0) {
          msg += '\n';
          for (const alert of sickBriefing.patternAlerts.slice(0, 2)) {
            msg += `⚠️ ${alert.message} Want me to flag this for a review?\n`;
          }
        }
        if (sickBriefing.totalThisMonth > 0) {
          msg += `📋 ${sickBriefing.totalThisMonth} sick day${sickBriefing.totalThisMonth !== 1 ? 's' : ''} logged this month.\n`;
        }
      } catch (e) {}
    }

    {
    }

    msg += `\nHave a great day! — Aria 🏠`;

    const result = await sendSMS(KAREN_PHONE, msg);
    console.log(`[MORNING] SMS sent:`, result.sid ? `SID ${result.sid}` : 'failed');

    // Make outbound morning call to Karen via Twilio
    let callResult = null;
    try {
      // Build a concise voice message from the briefing data
      let voiceMsg = `Good morning Karen! It's Aria with your daily briefing. `;
      voiceMsg += `You have ${jobCount} jobs on the schedule today. `;
      if (briefing.overdueCount > 0) voiceMsg += `${briefing.overdueCount} tasks are overdue and need attention. `;
      if (briefing.topFollowUps.length > 0) {
        voiceMsg += `Your top priority today is ${briefing.topFollowUps[0].description}. `;
      }
      if (briefing.delegatedToAria.length > 0) {
        voiceMsg += `I'm handling ${briefing.delegatedToAria.length} tasks for you automatically. `;
      }
      voiceMsg += `I also sent you the full details by text. Have an amazing day Karen! Text me anytime if you need anything.`;

      callResult = await makeCall({ to: KAREN_PHONE, message: voiceMsg, callerName: 'Karen' });
      console.log(`[MORNING] Call initiated:`, callResult.called ? `SID ${callResult.callSid}` : callResult.error);
    } catch (callErr) {
      console.error('[MORNING] Call failed:', callErr.message);
    }

    // On Mondays, also trigger the stat holiday check
    let statHolidayResult = null;
    if (dayName === 'Monday') {
      try {
        console.log('[MORNING] Monday — triggering stat holiday check...');
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://lhs-scheduler-proxy.vercel.app';
        // Use internal secret since we can't self-call reliably
        // Instead, run the check inline
        const { default: statCheck } = await import('./stat-holiday-check.js');
        const mockRes = {
          status: () => mockRes,
          json: (data) => { statHolidayResult = data; return mockRes; },
          setHeader: () => {}
        };
        const mockReq = { headers: { authorization: `Bearer ${process.env.INTERNAL_SECRET}` } };
        await statCheck(mockReq, mockRes);
        console.log('[MORNING] Stat holiday check result:', JSON.stringify(statHolidayResult));
      } catch (err) {
        console.error('[MORNING] Stat holiday check failed:', err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      jobCount,
      openTasks: briefing.openCount,
      overdue: briefing.overdueCount,
      messageSid: result.sid || null,
      callInitiated: callResult?.called || false,
      callSid: callResult?.callSid || null,
      statHolidayCheck: statHolidayResult
    });

  } catch (err) {
    console.error('[MORNING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
