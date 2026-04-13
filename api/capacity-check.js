export const config = { api: { bodyParser: false }, maxDuration: 30 };

import { saveTask } from './_task-store.js';

const KAREN_PHONE = '+16048009630';
const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const KB_CAPACITY_KEY = 'aria_capacity_history';
const STANDARD_DAY_HOURS = 8;
const BRANDI_DAY_HOURS = 5.5; // 9am–2:30pm

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

function getWeekRange() {
  // Current week: Monday to Friday (Pacific time)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 0);

  return {
    start: monday.toISOString(),
    end: friday.toISOString(),
    weekLabel: monday.toLocaleDateString('en-CA')
  };
}

function getPreviousWeekRange() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  const dayOfWeek = now.getDay();
  const prevMonday = new Date(now);
  prevMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7);
  prevMonday.setHours(0, 0, 0, 0);
  const prevFriday = new Date(prevMonday);
  prevFriday.setDate(prevMonday.getDate() + 4);
  prevFriday.setHours(23, 59, 59, 0);

  return { start: prevMonday.toISOString(), end: prevFriday.toISOString() };
}

async function fetchWeekJobs(start, end) {
  const apiKey = process.env.HCP_API_KEY;
  try {
    const response = await fetch(
      `https://api.housecallpro.com/jobs?scheduled_start_min=${start}&scheduled_start_max=${end}&page_size=200`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).filter(j => j.work_status !== 'pro canceled' && !j.deleted_at);
  } catch (err) {
    console.error('[CAPACITY] HCP fetch error:', err.message);
    return [];
  }
}

function calculateBookedHours(jobs) {
  let totalMinutes = 0;
  for (const job of jobs) {
    const start = job.schedule?.scheduled_start;
    const end = job.schedule?.scheduled_end;
    if (start && end) {
      const mins = (new Date(end) - new Date(start)) / (1000 * 60);
      if (mins > 0 && mins < 720) totalMinutes += mins; // Cap at 12hrs per job
    }
  }
  return totalMinutes / 60;
}

function calculateAvailableHours(cleaners) {
  let total = 0;
  for (const c of cleaners) {
    if (!c.days || c.days.length === 0) continue; // Inactive cleaners
    const daysPerWeek = c.days.length;
    const hoursPerDay = c.name === 'Brandi M' ? BRANDI_DAY_HOURS : STANDARD_DAY_HOURS;
    total += daysPerWeek * hoursPerDay;
  }
  return total;
}

async function fetchCleaners() {
  try {
    const response = await fetch('https://lhs-knowledge-base.vercel.app/api/clients');
    const data = await response.json();
    return data.cleaners || [];
  } catch (err) {
    console.error('[CAPACITY] KB fetch error:', err.message);
    return [];
  }
}

async function loadCapacityHistory() {
  try {
    const response = await fetch(`${KB_SAVE_URL}?key=${KB_CAPACITY_KEY}`);
    const data = await response.json();
    return data.value || [];
  } catch (err) {
    return [];
  }
}

async function saveCapacityHistory(history) {
  try {
    await fetch(KB_SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: KB_CAPACITY_KEY, value: history })
    });
  } catch (err) {
    console.error('[CAPACITY] History save failed:', err.message);
  }
}

export async function getCapacityData() {
  const week = getWeekRange();
  const prevWeek = getPreviousWeekRange();

  const [currentJobs, prevJobs, cleaners, history] = await Promise.all([
    fetchWeekJobs(week.start, week.end),
    fetchWeekJobs(prevWeek.start, prevWeek.end),
    fetchCleaners(),
    loadCapacityHistory()
  ]);

  const bookedHours = calculateBookedHours(currentJobs);
  const prevBookedHours = calculateBookedHours(prevJobs);
  const availableHours = calculateAvailableHours(cleaners);
  const capacity = availableHours > 0 ? Math.round((bookedHours / availableHours) * 100) : 0;
  const prevCapacity = availableHours > 0 ? Math.round((prevBookedHours / availableHours) * 100) : 0;
  const trend = capacity - prevCapacity;

  // Project weeks until full
  let weeksUntilFull = null;
  if (trend > 0 && capacity < 100) {
    weeksUntilFull = Math.ceil((100 - capacity) / trend);
  }

  return {
    weekLabel: week.weekLabel,
    bookedHours: Math.round(bookedHours * 10) / 10,
    availableHours: Math.round(availableHours * 10) / 10,
    capacity,
    prevCapacity,
    trend,
    weeksUntilFull,
    jobCount: currentJobs.length,
    cleanerCount: cleaners.filter(c => c.days && c.days.length > 0).length,
    history
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const hasToken = process.env.INTERNAL_SECRET && authHeader === `Bearer ${process.env.INTERNAL_SECRET}`;

  if (!isVercelCron && !hasToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const data = await getCapacityData();
    const { capacity, trend, weeksUntilFull, bookedHours, availableHours, jobCount, cleanerCount, weekLabel, history } = data;

    // Save this week's data to history
    const newEntry = { week: weekLabel, capacity, bookedHours, availableHours, jobCount, date: new Date().toISOString() };
    const updatedHistory = [...history.slice(-12), newEntry]; // Keep last 12 weeks
    await saveCapacityHistory(updatedHistory);

    console.log(`[CAPACITY] Week of ${weekLabel}: ${capacity}% (${bookedHours}h / ${availableHours}h), trend: ${trend > 0 ? '+' : ''}${trend}%, ${jobCount} jobs, ${cleanerCount} cleaners`);

    // Build message based on threshold
    const trendStr = trend > 0 ? `📈 up ${trend}%` : trend < 0 ? `📉 down ${Math.abs(trend)}%` : '➡️ flat';
    const projStr = weeksUntilFull ? `At this rate, full capacity in ~${weeksUntilFull} week${weeksUntilFull !== 1 ? 's' : ''}` : '';

    let msg = '';
    let taskCreated = false;

    if (capacity >= 90) {
      msg = `🔴 URGENT: Workforce at ${capacity}% capacity!\n\n`;
      msg += `${bookedHours}h booked / ${availableHours}h available this week\n`;
      msg += `${jobCount} jobs across ${cleanerCount} cleaners\n`;
      msg += `Trend: ${trendStr} from last week\n`;
      if (projStr) msg += `${projStr}\n`;
      msg += `\nKaren, we need to hire immediately. We're at risk of turning away clients or burning out the team. I've flagged this as critical. — Aria 🏠`;

      await saveTask({
        description: `🔴 CRITICAL: Workforce at ${capacity}% capacity — hire immediately`,
        priority: 'high', category: 'hiring',
        due_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }),
        assigned_to: 'karen', estimated_time_minutes: 60,
        notes: `${bookedHours}h booked of ${availableHours}h available. ${jobCount} jobs, ${cleanerCount} cleaners. Trend: ${trend > 0 ? '+' : ''}${trend}%`,
        source_message: 'Auto-generated by capacity check'
      });
      taskCreated = true;

    } else if (capacity >= 80) {
      msg = `🟠 Workforce at ${capacity}% capacity — time to start hiring.\n\n`;
      msg += `${bookedHours}h booked / ${availableHours}h available\n`;
      msg += `Trend: ${trendStr}\n`;
      if (projStr) msg += `${projStr}\n`;
      msg += `\nI'd recommend posting a job listing this week. Want me to save that as a task? — Aria 🏠`;

      await saveTask({
        description: `Start hiring process — workforce at ${capacity}% capacity`,
        priority: 'high', category: 'hiring',
        due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        assigned_to: 'karen', estimated_time_minutes: 45,
        notes: `${bookedHours}h of ${availableHours}h. Consider posting job listing.`,
        source_message: 'Auto-generated by capacity check'
      });
      taskCreated = true;

    } else if (capacity >= 70) {
      msg = `🟡 Workforce at ${capacity}% — heads up, hiring should be on your radar soon.\n\n`;
      msg += `${bookedHours}h booked / ${availableHours}h available\n`;
      msg += `Trend: ${trendStr}\n`;
      if (projStr) msg += `${projStr}\n`;
      msg += `\nNo rush yet, but good to plan ahead! — Aria 🏠`;

      await saveTask({
        description: `Consider hiring soon — workforce at ${capacity}% capacity`,
        priority: 'low', category: 'hiring',
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        assigned_to: 'karen', estimated_time_minutes: 20,
        notes: `Early warning. ${bookedHours}h of ${availableHours}h.`,
        source_message: 'Auto-generated by capacity check'
      });
      taskCreated = true;
    }

    // Always send on Mondays (even if below 70% — positive note)
    if (!msg) {
      msg = `💚 Workforce capacity: ${capacity}%\n\n`;
      msg += `${bookedHours}h booked / ${availableHours}h available\n`;
      msg += `${jobCount} jobs, ${cleanerCount} cleaners\n`;
      msg += `Trend: ${trendStr}\n`;
      msg += `\nLooking good! Plenty of room to grow. — Aria 🏠`;
    }

    const smsResult = await sendSMS(KAREN_PHONE, msg);
    console.log(`[CAPACITY] SMS sent:`, smsResult.sid ? `SID ${smsResult.sid}` : 'failed');

    return res.status(200).json({
      ok: true,
      capacity,
      trend,
      weeksUntilFull,
      bookedHours,
      availableHours,
      jobCount,
      cleanerCount,
      taskCreated,
      smsSent: !!smsResult.sid
    });

  } catch (err) {
    console.error('[CAPACITY] Error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
