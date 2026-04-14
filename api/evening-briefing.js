// Evening summary — 7pm Pacific daily — sends to Karen and Michael
// Four contributors: Karen, Michael (approx. time), Aria, Claude (saved time)
// AI value = only Aria + Claude minutes / 60 * $25

export const config = { api: { bodyParser: true }, maxDuration: 30 };

import { getEveningBriefingData } from './_task-client.js';

const KAREN_PHONE = '+16048009630';
const MICHAEL_PHONE = '+16046180336';
const TZ = 'America/Vancouver';

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  return r.json();
}

function buildSummary(name, briefing) {
  const todayStr = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const c = briefing.contributors || {};
  const kS = c.karen || {};
  const mS = c.michael || {};
  const aS = c.aria || {};
  const cS = c.claude || {};

  function fmtMin(m) { return m >= 60 ? `~${(m / 60).toFixed(1)} hours` : `~${m} min`; }

  // Build contributor lines — only show contributors who completed tasks
  let taskLines = '';
  if (kS.completedToday > 0) taskLines += `Karen: ${kS.completedToday} tasks — approx. ${kS.minutesToday} min\n`;
  if (mS.completedToday > 0) taskLines += `Michael: ${mS.completedToday} tasks — approx. ${mS.minutesToday} min\n`;
  if (aS.completedToday > 0) taskLines += `Aria: ${aS.completedToday} tasks — saved ${fmtMin(aS.minutesToday)}\n`;
  if (cS.completedToday > 0) taskLines += `Claude: ${cS.completedToday} tasks — saved ${fmtMin(cS.minutesToday)}\n`;
  if (!taskLines) taskLines = 'No tasks completed today — fresh start tomorrow!\n';

  // AI value = only Aria + Claude (not Karen or Michael)
  const aiMinutes = (aS.minutesToday || 0) + (cS.minutesToday || 0);
  const aiDollars = Math.round(aiMinutes / 60 * 25);

  // Open task count
  const openCount = typeof briefing.stillOpen === 'number' ? briefing.stillOpen : 0;

  // Top pending tasks
  const pending = (briefing.tomorrowPriorities || []).slice(0, 3);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

  // Karen's priorities for tomorrow
  const karenPriorities = (briefing.tomorrowPriorities || []).filter(t => t.assigned_to === 'karen').slice(0, 3);

  let msg = `Good evening ${name}! 🌙\nLHS wrap-up for ${todayStr}:\n\n`;
  msg += `TASKS TODAY:\n${taskLines}`;
  if (aiDollars > 0) msg += `AI value today: $${aiDollars}\n`;
  msg += '\n';

  if (openCount > 0 && pending.length > 0) {
    msg += `STILL PENDING: ${openCount} tasks\n`;
    for (const t of pending) {
      const overdue = t.due_date && t.due_date < today;
      msg += `• ${t.description.substring(0, 50)}${overdue ? ' (overdue!)' : ''}\n`;
    }
    msg += '\n';
  } else if (openCount > 0) {
    msg += `STILL PENDING: ${openCount} tasks\n\n`;
  }

  if (karenPriorities.length > 0) {
    msg += `KAREN'S PRIORITIES TOMORROW:\n`;
    for (const t of karenPriorities) msg += `• ${t.description.substring(0, 50)}\n`;
    msg += '\n';
  }

  msg += `— Aria 🏠`;
  return msg;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const isCron = req.headers['x-vercel-cron'] === '1';
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!isCron && auth !== process.env.INTERNAL_SECRET && auth !== 'lhs-aria-internal-2026-secret-key') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Allow test mode: ?to=michael sends only to Michael
  const testTo = req.query?.to;

  try {
    const briefing = await getEveningBriefingData();

    const karenMsg = buildSummary('Karen', briefing);
    const michaelMsg = buildSummary('Michael', briefing);

    let karenSid = null, michaelSid = null;

    if (!testTo || testTo === 'karen') {
      const kr = await sendSMS(KAREN_PHONE, karenMsg);
      karenSid = kr.sid || null;
      console.log('[EVENING] Karen:', karenSid || 'failed');
    }
    if (!testTo || testTo === 'michael') {
      const mr = await sendSMS(MICHAEL_PHONE, michaelMsg);
      michaelSid = mr.sid || null;
      console.log('[EVENING] Michael:', michaelSid || 'failed');
    }

    const openCount = typeof briefing.stillOpen === 'number' ? briefing.stillOpen : 0;

    return res.status(200).json({
      ok: true,
      completedToday: briefing.completedToday?.length || 0,
      stillOpen: openCount,
      karenSid,
      michaelSid,
      message: testTo ? michaelMsg || karenMsg : undefined
    });

  } catch (err) {
    console.error('[EVENING] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
