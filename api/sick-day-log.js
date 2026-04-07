// Permanent sick day tracking — HR documentation, pattern detection, payroll integration
// NEVER auto-deletes. Records are permanent.

export const config = { api: { bodyParser: true } };

const KB_SAVE_URL = 'https://lhs-knowledge-base.vercel.app/api/save';
const KB_KEY = 'aria_sick_days';
const TIMEZONE = 'America/Vancouver';

async function kbRead() {
  try {
    const res = await fetch(`${KB_SAVE_URL}?key=${KB_KEY}`);
    const data = await res.json();
    return (data.value && Array.isArray(data.value)) ? data.value : [];
  } catch (e) { return []; }
}

async function kbWrite(records) {
  await fetch(KB_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KB_KEY, value: records })
  });
}

function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// ─── Log a sick day ─────────────────────────────────────────────────────────

export async function logSickDay({
  cleanerName, cleanerPhone, date, timeReported, jobsAffected, affectedClients,
  replacements, clientsNotified, karenApproval, resolution, leaveType, notes
}) {
  const records = await kbRead();
  const entry = {
    id: `sick_${Date.now().toString(36)}`,
    cleanerName,
    cleanerPhone: cleanerPhone || '',
    date: date || todayPT(),
    timeReported: timeReported || new Date().toISOString(),
    jobsAffected: jobsAffected || 0,
    affectedClients: affectedClients || [],
    replacements: replacements || [],
    clientsNotified: clientsNotified || false,
    karenApproval: karenApproval || 'pending',
    resolution: resolution || 'pending',
    leaveType: leaveType || 'unconfirmed', // paid_sick, unpaid_sick, unconfirmed
    notes: notes || ''
  };
  records.push(entry);
  await kbWrite(records);
  console.log(`[SICK-LOG] Logged: ${cleanerName} on ${entry.date} — ${jobsAffected} jobs affected`);
  return entry;
}

export async function updateSickDay(id, fields) {
  const records = await kbRead();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  Object.assign(records[idx], fields);
  await kbWrite(records);
  return records[idx];
}

// ─── Query functions ────────────────────────────────────────────────────────

export async function getAllSickDays() {
  return await kbRead();
}

export async function getCleanerSickDays(cleanerName, daysBack = 365) {
  const records = await kbRead();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const nameLower = cleanerName.toLowerCase();
  return records.filter(r =>
    r.cleanerName.toLowerCase().includes(nameLower) && r.date >= cutoffStr
  );
}

export async function getSickDaysThisMonth() {
  const records = await kbRead();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return records.filter(r => r.date >= monthStart);
}

export async function getSickDaysThisYear() {
  const records = await kbRead();
  const yearStart = `${new Date().getFullYear()}-01-01`;
  return records.filter(r => r.date >= yearStart);
}

// ─── Pattern detection ──────────────────────────────────────────────────────

export async function detectPatterns(cleanerName) {
  const last30 = await getCleanerSickDays(cleanerName, 30);
  const last90 = await getCleanerSickDays(cleanerName, 90);
  const alerts = [];

  // Frequency alert: 3+ in last 30 days
  if (last30.length >= 3) {
    alerts.push({
      type: 'frequency',
      severity: last30.length >= 5 ? 'red' : 'orange',
      message: `${cleanerName} has had ${last30.length} sick days in the last 30 days.`
    });
  }

  // Day-of-week pattern
  if (last90.length >= 3) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayCounts = {};
    for (const r of last90) {
      const day = dayNames[new Date(r.date + 'T12:00:00').getDay()];
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
    const topDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
    if (topDay && topDay[1] >= 3) {
      alerts.push({
        type: 'day_pattern',
        severity: 'orange',
        message: `${cleanerName} has called in sick ${topDay[1]} times on ${topDay[0]}s in the last 90 days.`
      });
    }
  }

  return alerts;
}

// ─── Summary for briefings ──────────────────────────────────────────────────

export async function getSickDayBriefing() {
  const thisMonth = await getSickDaysThisMonth();
  const allRecords = await kbRead();

  // Per-cleaner counts this month
  const monthlyCounts = {};
  for (const r of thisMonth) {
    monthlyCounts[r.cleanerName] = (monthlyCounts[r.cleanerName] || 0) + 1;
  }

  // Check all cleaners for 30-day pattern alerts
  const uniqueCleaners = [...new Set(allRecords.map(r => r.cleanerName))];
  const patternAlerts = [];
  for (const name of uniqueCleaners) {
    const alerts = await detectPatterns(name);
    patternAlerts.push(...alerts);
  }

  return { monthlyCounts, patternAlerts, totalThisMonth: thisMonth.length };
}

// ─── HTTP handler for dashboard and direct access ───────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (!process.env.INTERNAL_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;

  try {
    if (action === 'all') {
      const records = await getAllSickDays();
      return res.status(200).json({ total: records.length, records });
    }
    if (action === 'month') {
      const records = await getSickDaysThisMonth();
      return res.status(200).json({ total: records.length, records });
    }
    if (action === 'year') {
      const records = await getSickDaysThisYear();
      return res.status(200).json({ total: records.length, records });
    }
    if (action === 'cleaner') {
      const records = await getCleanerSickDays(req.query.name || '', parseInt(req.query.days) || 365);
      const patterns = await detectPatterns(req.query.name || '');
      return res.status(200).json({ total: records.length, records, patterns });
    }
    if (action === 'briefing') {
      const briefing = await getSickDayBriefing();
      return res.status(200).json(briefing);
    }
    if (action === 'csv') {
      const records = await getAllSickDays();
      const header = 'Date,Cleaner,Jobs Affected,Leave Type,Resolution,Clients,Notes\n';
      const rows = records.map(r =>
        `${r.date},"${r.cleanerName}",${r.jobsAffected},${r.leaveType},${r.resolution},"${(r.affectedClients || []).join('; ')}","${(r.notes || '').replace(/"/g, '""')}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=lhs-sick-days.csv');
      return res.status(200).send(header + rows);
    }

    return res.status(200).json(await getSickDayBriefing());
  } catch (err) {
    console.error('[SICK-LOG] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
